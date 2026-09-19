import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { requireAuth } from './auth.js';
import { randomStoredName, verifyPassword } from './security.js';
import {
  conversationInventory, conversationMemberIds, conversationSummaries, createGroup, createMessage, createSession, createUser,
  findOrCreateDirect, findOrCreateSelf, getAvatarFile, getCachedLinkPreview, getFile, getUserById, getUserForLogin, history,
  insertFile, isMember, listUsers, markReceipt, messageById, revokeToken, saveLinkPreview, setUserAvatar, userCount,
  userFromToken, addGroupMember, removeGroupMember, renameGroup, fileIsReferencedForUser
} from './db.js';
import type { LinkPreview } from './types.js';

const app = express();
app.use(cors({origin:true,credentials:true}));
app.use(express.json({limit:'1mb'}));
const publicDir = path.resolve(process.env.PUBLIC_DIR ?? './public');
app.get('/health', (_req,res)=>res.json({ok:true,version:'0.6.0'}));

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

app.get('/api/conversations',requireAuth,(req,res)=>{
  findOrCreateSelf(req.user!.id);
  res.json(conversationSummaries(req.user!.id));
});
app.post('/api/conversations/self',requireAuth,(req,res)=>res.status(201).json({id:findOrCreateSelf(req.user!.id)}));
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
app.get('/api/conversations/:id/inventory',requireAuth,(req,res)=>{
  const cid=Number(req.params.id); if (!isMember(cid,req.user!.id)) return res.status(403).json({error:'not_a_member'});
  res.json(conversationInventory(cid));
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
app.post('/api/me/avatar',requireAuth,upload.single('file'),(req,res)=>{
  if (!req.file) return res.status(400).json({error:'missing_file'});
  if (!String(req.file.mimetype).startsWith('image/')) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({error:'avatar_must_be_image'});
  }
  const id=insertFile(req.user!.id,req.file.originalname,req.file.filename,req.file.mimetype || 'application/octet-stream',req.file.size);
  try { res.json(setUserAvatar(req.user!.id,id)); }
  catch { res.status(400).json({error:'invalid_avatar'}); }
});
app.get('/api/avatars/:id',(req,res)=>{
  const fid=Number(req.params.id); const f=getAvatarFile(fid); if(!f) return res.status(404).end();
  res.setHeader('Cache-Control','public, max-age=86400');
  res.type(f.mime_type); res.sendFile(path.join(config.uploadDir,f.stored_name));
});
app.get('/api/files/:id',requireAuth,(req,res)=>{
  const fid=Number(req.params.id); const f=getFile(fid); if(!f) return res.status(404).json({error:'not_found'});
  if(Number(f.owner_id)!==req.user!.id && !fileIsReferencedForUser(fid,req.user!.id)) return res.status(403).json({error:'forbidden'});
  res.type(f.mime_type); res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`); res.sendFile(path.join(config.uploadDir,f.stored_name));
});

function privateAddress(address:string): boolean {
  if (address.startsWith('::ffff:')) return privateAddress(address.slice(7));
  if (net.isIPv4(address)) {
    const p=address.split('.').map(Number); const [a,b]=p;
    return a===0 || a===10 || a===127 || (a===100&&b>=64&&b<=127) || (a===169&&b===254) ||
      (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===198&&(b===18||b===19)) || a>=224;
  }
  const x=address.toLowerCase();
  return x==='::' || x==='::1' || x.startsWith('fc') || x.startsWith('fd') || /^fe[89ab]/.test(x);
}

async function safePreviewUrl(input:string): Promise<URL> {
  const u=new URL(input);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('invalid_url');
  if (u.port && !['80','443'].includes(u.port)) throw new Error('port_not_allowed');
  const host=u.hostname.toLowerCase();
  if (host==='localhost' || host.endsWith('.local') || host.endsWith('.localhost')) throw new Error('local_host');
  if (net.isIP(host)) { if(privateAddress(host)) throw new Error('private_host'); }
  else {
    const resolved=await lookup(host,{all:true,verbatim:true});
    if(!resolved.length || resolved.some(r=>privateAddress(r.address))) throw new Error('private_host');
  }
  return u;
}

function entityDecode(s:string): string {
  return s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}
function meta(html:string,key:string): string | null {
  const q=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const a=new RegExp(`<meta[^>]+(?:property|name)=["']${q}["'][^>]+content=["']([^"']+)["'][^>]*>`,`i`).exec(html)?.[1];
  const b=new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${q}["'][^>]*>`,`i`).exec(html)?.[1];
  return a||b ? entityDecode(a||b||'').trim() : null;
}
function titleFromHtml(html:string): string | null {
  const og=meta(html,'og:title'); if(og)return og;
  const m=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html); return m?entityDecode(m[1].replace(/\s+/g,' ').trim()):null;
}
function absoluteHttpUrl(value:string|null,base:URL): string | null {
  if(!value)return null; try{const u=new URL(value,base);return ['http:','https:'].includes(u.protocol)?u.toString():null;}catch{return null;}
}
async function readLimitedHtml(response:Response,maxBytes=512*1024): Promise<string> {
  const reader=response.body?.getReader(); if(!reader)return '';
  const chunks:Uint8Array[]=[]; let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;if(!value)continue;total+=value.byteLength;if(total>maxBytes){await reader.cancel();break;}chunks.push(value);}
  const all=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}return new TextDecoder().decode(all);
}
async function fetchLinkPreview(raw:string): Promise<LinkPreview> {
  const url=await safePreviewUrl(raw);
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),4500);
  try {
    const r=await fetch(url,{signal:controller.signal,redirect:'error',headers:{'User-Agent':'HomeChat/0.6 link-preview','Accept':'text/html,application/xhtml+xml'}});
    if(!r.ok) throw new Error('fetch_failed');
    const type=r.headers.get('content-type')||''; if(!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('not_html');
    const html=await readLimitedHtml(r);
    const preview:LinkPreview={
      url:url.toString(),hostname:url.hostname,title:titleFromHtml(html),description:meta(html,'og:description')||meta(html,'description'),
      imageUrl:absoluteHttpUrl(meta(html,'og:image'),url),siteName:meta(html,'og:site_name')
    };
    saveLinkPreview(preview); return preview;
  } finally {clearTimeout(timer);}
}
app.get('/api/link-preview',requireAuth,async(req,res)=>{
  const raw=String(req.query.url??''); if(!raw) return res.status(400).json({error:'missing_url'});
  const cached=getCachedLinkPreview(raw); if(cached)return res.json(cached);
  try {res.json(await fetchLinkPreview(raw));}
  catch {try{const u=new URL(raw);res.json({url:raw,title:null,description:null,imageUrl:null,siteName:null,hostname:u.hostname});}catch{res.status(400).json({error:'invalid_url'});}}
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
