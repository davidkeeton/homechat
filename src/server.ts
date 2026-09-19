import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { bearer, requireAuth } from './auth.js';
import { randomStoredName, verifyPassword } from './security.js';
import {
  conversationMemberIds, conversationSummaries, createGroup, createMessage, createSession, createUser,
  findOrCreateDirect, getFile, getUserById, getUserForLogin, history, insertFile, isMember, listUsers,
  markReceipt, messageById, revokeToken, userCount, userFromToken, addGroupMember, removeGroupMember, renameGroup, fileIsReferencedForUser
} from './db.js';

const app = express();
app.use(cors({origin:true,credentials:true}));
app.use(express.json({limit:'1mb'}));
const publicDir = path.resolve(process.env.PUBLIC_DIR ?? './public');
app.get('/health', (_req,res)=>res.json({ok:true,version:'0.1.0'}));

app.post('/api/setup', (req,res)=>{
  if (userCount() > 0) return res.status(409).json({error:'setup_complete'});
  const {username,displayName,password} = req.body ?? {};
  if (!username || !displayName || typeof password !== 'string' || password.length < 8) return res.status(400).json({error:'invalid_input'});
  const user = createUser(username,displayName,password,true);
  const token = createSession(user.id);
  res.status(201).json({token,user});
});

app.post('/api/auth/login',(req,res)=>{
  const {username,password} = req.body ?? {};
  const row = typeof username === 'string' ? getUserForLogin(username) : null;
  if (!row || row.disabled || typeof password !== 'string' || !verifyPassword(password,row.password_hash)) return res.status(401).json({error:'invalid_credentials'});
  const user = getUserById(Number(row.id))!;
  res.json({token:createSession(user.id),user});
});
app.post('/api/auth/logout',requireAuth,(req,res)=>{ revokeToken(req.token!); res.status(204).end(); });
app.get('/api/me',requireAuth,(req,res)=>res.json(req.user));
app.get('/api/users',requireAuth,(_req,res)=>res.json(listUsers()));
app.post('/api/users',requireAuth,(req,res)=>{
  if (!req.user!.isAdmin) return res.status(403).json({error:'admin_required'});
  const {username,displayName,password,isAdmin=false}=req.body ?? {};
  if (!username || !displayName || typeof password!=='string' || password.length<8) return res.status(400).json({error:'invalid_input'});
  try { res.status(201).json(createUser(username,displayName,password,Boolean(isAdmin))); }
  catch { res.status(409).json({error:'username_exists'}); }
});

app.get('/api/conversations',requireAuth,(req,res)=>res.json(conversationSummaries(req.user!.id)));
app.post('/api/conversations/direct',requireAuth,(req,res)=>{
  const otherId=Number(req.body?.userId); if (!getUserById(otherId) || otherId===req.user!.id) return res.status(400).json({error:'invalid_user'});
  const id=findOrCreateDirect(req.user!.id,otherId); res.status(201).json({id});
});
app.post('/api/conversations/group',requireAuth,(req,res)=>{
  const name=String(req.body?.name??'').trim(); const members=Array.isArray(req.body?.memberIds)?req.body.memberIds.map(Number):[];
  if (!name || members.length<1) return res.status(400).json({error:'invalid_group'});
  if (members.some((id:number)=>!getUserById(id))) return res.status(400).json({error:'invalid_member'});
  res.status(201).json({id:createGroup(req.user!.id,name,members)});
});
app.patch('/api/conversations/:id/group',requireAuth,(req,res)=>{
  const cid=Number(req.params.id); if(!isMember(cid,req.user!.id)) return res.status(403).json({error:'not_a_member'});
  const name=String(req.body?.name??'').trim(); if(!name) return res.status(400).json({error:'invalid_name'});
  try { renameGroup(cid,name); res.status(204).end(); } catch { res.status(400).json({error:'not_group'}); }
});
app.post('/api/conversations/:id/members',requireAuth,(req,res)=>{
  const cid=Number(req.params.id); if(!isMember(cid,req.user!.id)) return res.status(403).json({error:'not_a_member'});
  const uid=Number(req.body?.userId); if(!getUserById(uid)) return res.status(400).json({error:'invalid_user'});
  try { addGroupMember(cid,uid); res.status(204).end(); } catch { res.status(400).json({error:'not_group'}); }
});
app.delete('/api/conversations/:id/members/:userId',requireAuth,(req,res)=>{
  const cid=Number(req.params.id); if(!isMember(cid,req.user!.id)) return res.status(403).json({error:'not_a_member'});
  const uid=Number(req.params.userId);
  try { removeGroupMember(cid,uid); res.status(204).end(); } catch { res.status(400).json({error:'not_group'}); }
});
app.get('/api/conversations/:id/messages',requireAuth,(req,res)=>{
  const cid=Number(req.params.id); if (!isMember(cid,req.user!.id)) return res.status(403).json({error:'not_a_member'});
  const before=req.query.before?Number(req.query.before):null; const limit=Math.min(100,Math.max(1,Number(req.query.limit??50)));
  res.json(history(cid,before,limit));
});

const storage=multer.diskStorage({
  destination:(_req,_file,cb)=>cb(null,config.uploadDir),
  filename:(_req,file,cb)=>cb(null,randomStoredName(path.extname(file.originalname).slice(0,12)))
});
const upload=multer({storage,limits:{fileSize:config.maxUploadBytes}});
app.post('/api/files',requireAuth,upload.single('file'),(req,res)=>{
  if (!req.file) return res.status(400).json({error:'missing_file'});
  const id=insertFile(req.user!.id,req.file.originalname,req.file.filename,req.file.mimetype || 'application/octet-stream',req.file.size);
  res.status(201).json({id,name:req.file.originalname,mimeType:req.file.mimetype,size:req.file.size,url:`/api/files/${id}`});
});
app.get('/api/files/:id',requireAuth,(req,res)=>{
  const fid=Number(req.params.id); const f=getFile(fid); if(!f) return res.status(404).json({error:'not_found'});
  if(Number(f.owner_id)!==req.user!.id && !fileIsReferencedForUser(fid,req.user!.id)) return res.status(403).json({error:'forbidden'});
  res.type(f.mime_type); res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`); res.sendFile(path.join(config.uploadDir,f.stored_name));
});

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('/', (_req,res)=>res.sendFile(path.join(publicDir,'index.html')));
}
const server=http.createServer(app);
const io=new SocketServer(server,{cors:{origin:true,credentials:true}});
const online=new Map<number,number>();
function roomForUser(id:number){return `user:${id}`;}
function broadcastPresence(userId:number,isOnline:boolean){io.emit('presence:update',{userId,online:isOnline});}

io.use((socket,next)=>{
  const token=String(socket.handshake.auth?.token ?? socket.handshake.headers.authorization?.toString().replace(/^Bearer\s+/,'') ?? '');
  const user=userFromToken(token); if(!user) return next(new Error('unauthorized'));
  socket.data.user=user; next();
});
io.on('connection',(socket)=>{
  const user=socket.data.user as {id:number};
  socket.join(roomForUser(user.id));
  const count=(online.get(user.id)??0)+1; online.set(user.id,count); if(count===1) broadcastPresence(user.id,true);
  socket.emit('presence:snapshot',{userIds:[...online.keys()]});

  socket.on('conversation:join',(payload,ack)=>{
    const cid=Number(payload?.conversationId); if(!isMember(cid,user.id)) return ack?.({ok:false,error:'not_a_member'});
    socket.join(`conversation:${cid}`); ack?.({ok:true});
  });
  socket.on('message:send',(payload,ack)=>{
    const cid=Number(payload?.conversationId); const body=typeof payload?.body==='string'?payload.body:null; const fileId=payload?.fileId?Number(payload.fileId):null;
    if(!isMember(cid,user.id)) return ack?.({ok:false,error:'not_a_member'});
    if(!body?.trim() && !fileId) return ack?.({ok:false,error:'empty_message'});
    try {
      const message=createMessage(cid,user.id,body,fileId);
      for(const uid of conversationMemberIds(cid)) io.to(roomForUser(uid)).emit('message:new',message);
      ack?.({ok:true,message});
    } catch { ack?.({ok:false,error:'send_failed'}); }
  });
  socket.on('typing:set',(payload)=>{
    const cid=Number(payload?.conversationId); if(!isMember(cid,user.id)) return;
    for(const uid of conversationMemberIds(cid)) if(uid!==user.id) io.to(roomForUser(uid)).emit('typing:update',{conversationId:cid,userId:user.id,typing:Boolean(payload?.typing)});
  });
  socket.on('receipt:set',(payload)=>{
    const mid=Number(payload?.messageId); const kind=payload?.kind==='read'?'read':'delivered'; const m=messageById(mid); if(!m || !isMember(m.conversationId,user.id)) return;
    markReceipt(mid,user.id,kind);
    for(const uid of conversationMemberIds(m.conversationId)) if(uid!==user.id) io.to(roomForUser(uid)).emit('receipt:update',{messageId:mid,userId:user.id,kind});
  });
  socket.on('disconnect',()=>{
    const next=Math.max(0,(online.get(user.id)??1)-1); if(next===0){online.delete(user.id);broadcastPresence(user.id,false);} else online.set(user.id,next);
  });
});

server.listen(config.port,config.host,()=>console.log(`HomeChat listening on http://${config.host}:${config.port}`));
