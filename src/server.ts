import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Server as SocketServer } from 'socket.io';
import { APP_VERSION, config } from './config.js';
import { ensureTlsMaterial } from './tls.js';
import { requireAuth } from './auth.js';
import { hashToken, randomStoredName, verifyPassword } from './security.js';
import {
  acceptContactRequest, adminUsers, blockUser, canMessageUser, canSeePresence, contactRequests, conversationInventory, conversationMemberIds, conversationSummaries, createGroup, createMessage, createSession, createUser,
  directConversationBlocked, directConversationPrivacyBlocked, findOrCreateDirect, findOrCreateSelf, getAvatarFile, getCachedLinkPreview, getFile, getPrivacy, getServiceSettings, getUserById, getUserForLogin, history,
  deleteMessage, declineContactRequest, editMessage, insertFile, isBlockedPair, isMember, listBlocked, listContacts, listUsers, markReceipt, messageById, removeContact, resetUserPassword, revokeToken, saveLinkPreview, searchDirectory, searchMessages, sendContactRequest, setPrivacy, setDisplayName, setUserAvatar, setGroupAvatar, setUserDisabled, storageStats, toggleReaction, unblockUser, updateServiceSettings, userCount,
  userFromToken, addGroupMember, removeGroupMember, renameGroup, fileIsReferencedForUser, setting, pruneExpiredSessions, pruneOrphanFiles, userExists, upsertPushSubscription, deletePushSubscription, pruneStalePushSubscriptions
} from './db.js';
import type { LinkPreview, MessageView } from './types.js';
import { sendPushToUser, vapidPublicKey } from './push.js';


function bootstrapAdminFromEnvironment(): void {
  if (userCount() > 0) return;

  const displayName = String(process.env.HOMECHAT_ADMIN_NAME ?? '').trim();
  const passwordFile = String(process.env.HOMECHAT_ADMIN_PASSWORD_FILE ?? '').trim();
  let password = String(process.env.HOMECHAT_ADMIN_PASSWORD ?? '');
  if (passwordFile) {
    if (!fs.existsSync(passwordFile)) throw new Error(`bootstrap_admin_password_file_missing: ${passwordFile}`);
    password = fs.readFileSync(passwordFile,'utf8').replace(/[\r\n]+$/,'');
  }

  if (!displayName && !password) {
    console.warn('HomeChat: no users exist and no bootstrap administrator is configured. Use /api/setup or configure HOMECHAT_ADMIN_NAME plus HOMECHAT_ADMIN_PASSWORD(_FILE).');
    return;
  }
  if (!displayName || !password) {
    throw new Error('bootstrap_admin_config_incomplete: set HOMECHAT_ADMIN_NAME and HOMECHAT_ADMIN_PASSWORD or HOMECHAT_ADMIN_PASSWORD_FILE');
  }

  const user = createUser(displayName, password, true);
  console.log(`HomeChat ${APP_VERSION}: created bootstrap administrator ${user.displayName} (${user.hid})`);
}

bootstrapAdminFromEnvironment();

const app = express();
app.disable('x-powered-by');
app.use(cors({origin:true,credentials:true}));
app.use(express.json({limit:'1mb'}));
app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');next();});
const publicDir = path.resolve(process.env.PUBLIC_DIR ?? './public');
app.get('/health', (_req,res)=>res.json({ok:true,version:APP_VERSION}));

const windowsClientFile = path.join(config.dataDir,'downloads','HomeChat-Windows-Setup.exe');
app.get('/downloads/HomeChat-Windows-Setup.exe', (_req,res)=>{
  if(!fs.existsSync(windowsClientFile)) return res.status(404).type('text/plain').send('HomeChat Windows installer is not available yet.');
  res.type('application/vnd.microsoft.portable-executable');
  res.setHeader('Content-Disposition','attachment; filename="HomeChat-Windows-Setup.exe"');
  res.setHeader('Cache-Control','no-store');
  res.sendFile(windowsClientFile);
});

app.get('/homechat-root-ca.crt', (_req,res)=>{
  if(!fs.existsSync(config.caCertFile)) return res.status(404).type('text/plain').send('HomeChat CA certificate has not been generated yet.');
  res.type('application/x-x509-ca-cert');
  res.setHeader('Content-Disposition','attachment; filename=\"homechat-root-ca.crt\"');
  res.setHeader('Cache-Control','no-store');
  res.sendFile(config.caCertFile);
});

app.post('/api/setup', (req,res)=>{
  if (userCount() > 0) return res.status(409).json({error:'setup_complete'});
  const {displayName,password} = req.body ?? {};
  try{
    const user = createUser(String(displayName??''),password,true);
    const token = createSession(user.id);
    res.status(201).json({token,user});
  }catch(e:any){res.status(400).json({error:e?.message||'invalid_input'});}
});

app.get('/api/public-config',(_req,res)=>res.json(getServiceSettings()));
app.post('/api/auth/register',(req,res)=>{
  const settings=getServiceSettings();
  if(!settings.registrationEnabled) return res.status(403).json({error:'registration_disabled'});
  const {displayName,password,inviteCode}=req.body??{};
  const inviteHash=setting('registration_invite_hash','');
  if(inviteHash&&hashToken(String(inviteCode??''))!==inviteHash) return res.status(403).json({error:'invalid_invite'});
  try{const user=createUser(String(displayName??''),password,false);res.status(201).json({token:createSession(user.id),user});}
  catch(e:any){const code=e?.message==='invalid_display_name'||e?.message==='invalid_password'?400:409;res.status(code).json({error:code===409?'display_name_exists':e?.message||'invalid_input'});}
});

app.post('/api/auth/login',(req,res)=>{
  const {displayName,password} = req.body ?? {};
  const row = typeof displayName === 'string' ? getUserForLogin(displayName) : null;
  if (!row || row.disabled || typeof password !== 'string' || !verifyPassword(password,row.password_hash)) return res.status(401).json({error:'invalid_credentials'});
  const user = getUserById(Number(row.id))!;
  res.json({token:createSession(user.id),user});
});
app.post('/api/auth/logout',requireAuth,(req,res)=>{ revokeToken(req.token!); res.status(204).end(); });
app.get('/api/push/config',requireAuth,(_req,res)=>res.json({publicKey:vapidPublicKey()}));
app.post('/api/push/subscriptions',requireAuth,(req,res)=>{
  try{
    upsertPushSubscription(req.user!.id,req.token!,{
      endpoint:req.body?.endpoint,p256dh:req.body?.keys?.p256dh,auth:req.body?.keys?.auth,
      deviceId:req.body?.deviceId,userAgent:req.headers['user-agent']??''
    });
    res.status(204).end();
  }catch(e:any){res.status(400).json({error:e?.message||'invalid_push_subscription'});}
});
app.delete('/api/push/subscriptions',requireAuth,(req,res)=>{
  deletePushSubscription(req.user!.id,String(req.body?.endpoint??''));res.status(204).end();
});
app.get('/api/me',requireAuth,(req,res)=>res.json(req.user));
app.patch('/api/me',requireAuth,(req,res)=>{try{res.json(setDisplayName(req.user!.id,String(req.body?.displayName??'')));}catch(e:any){const code=e?.message==='display_name_exists'?409:e?.message==='not_found'?404:400;res.status(code).json({error:e?.message||'invalid_display_name'});}});
app.get('/api/users',requireAuth,(req,res)=>res.json(searchDirectory(req.user!.id,'').map(({relationship,...user})=>user)));
app.post('/api/users',requireAuth,(req,res)=>{
  if (!req.user!.isAdmin) return res.status(403).json({error:'admin_required'});
  const {displayName,password,isAdmin=false}=req.body ?? {};
  try { res.status(201).json(createUser(String(displayName??''),password,Boolean(isAdmin))); }
  catch(e:any) { const code=e?.message==='invalid_display_name'||e?.message==='invalid_password'?400:409; res.status(code).json({error:code===409?'display_name_exists':e?.message||'invalid_input'}); }
});

app.get('/api/me/privacy',requireAuth,(req,res)=>res.json(getPrivacy(req.user!.id)));
app.put('/api/me/privacy',requireAuth,(req,res)=>{try{const value=setPrivacy(req.user!.id,req.body??{});syncPresenceVisibility(req.user!.id);res.json(value);}catch(e:any){res.status(400).json({error:e?.message||'invalid_privacy'});}});

function requireAdmin(req:any,res:any): boolean {if(!req.user?.isAdmin){res.status(403).json({error:'admin_required'});return false;}return true;}
app.get('/api/admin/overview',requireAuth,(req,res)=>{if(!requireAdmin(req,res))return;res.json({settings:getServiceSettings(),storage:storageStats()});});
app.get('/api/admin/users',requireAuth,(req,res)=>{if(!requireAdmin(req,res))return;res.json(adminUsers());});
app.put('/api/admin/settings',requireAuth,(req,res)=>{
  if(!requireAdmin(req,res))return;
  const body=req.body??{};
  const inviteHash=body.inviteCode===undefined?undefined:(String(body.inviteCode).trim()==='__clear__'?null:(String(body.inviteCode).trim()?hashToken(String(body.inviteCode).trim()):null));
  try{res.json(updateServiceSettings({registrationEnabled:body.registrationEnabled,inviteHash,maxUploadBytes:body.maxUploadBytes}));}
  catch(e:any){res.status(400).json({error:e?.message||'invalid_settings'});}
});
app.patch('/api/admin/users/:id',requireAuth,(req,res)=>{
  if(!requireAdmin(req,res))return;const id=Number(req.params.id);if(id===req.user!.id&&req.body?.disabled===true)return res.status(400).json({error:'cannot_disable_self'});
  if(!userExists(id))return res.status(404).json({error:'not_found'});
  try{if(typeof req.body?.disabled==='boolean'){setUserDisabled(id,req.body.disabled);if(req.body.disabled)io.to(roomForUser(id)).disconnectSockets(true);}res.status(204).end();}
  catch(e:any){res.status(e?.message==='not_found'?404:400).json({error:e?.message||'update_failed'});}
});
app.post('/api/admin/users/:id/reset-password',requireAuth,(req,res)=>{
  if(!requireAdmin(req,res))return;const id=Number(req.params.id);const password=String(req.body?.password??'');try{resetUserPassword(id,password);io.to(roomForUser(id)).disconnectSockets(true);res.status(204).end();}catch(e:any){res.status(e?.message==='not_found'?404:400).json({error:e?.message||'reset_failed'});}
});


app.get('/api/contacts',requireAuth,(req,res)=>res.json(listContacts(req.user!.id)));
app.get('/api/contact-requests',requireAuth,(req,res)=>res.json(contactRequests(req.user!.id)));
app.get('/api/directory',requireAuth,(req,res)=>res.json(searchDirectory(req.user!.id,String(req.query.q??''))));
app.get('/api/search/messages',requireAuth,(req,res)=>res.json(searchMessages(req.user!.id,String(req.query.q??''),Number(req.query.limit??50))));
app.post('/api/contact-requests',requireAuth,(req,res)=>{
  const uid=Number(req.body?.userId); if(!uid) return res.status(400).json({error:'invalid_user'});
  try{
    sendContactRequest(req.user!.id,uid);
    // A reverse pending request auto-accepts in the DB. In that case make the
    // direct chat immediately usable; otherwise wake the recipient's UI so the
    // request appears in the chat list without opening Contacts.
    const accepted=listContacts(req.user!.id).some(u=>u.id===uid);
    const conversationId=accepted?findOrCreateDirect(req.user!.id,uid):null;
    io.to(roomForUser(uid)).emit('contacts:changed',{kind:accepted?'accepted':'request',conversationId,fromUserId:req.user!.id});
    io.to(roomForUser(req.user!.id)).emit('contacts:changed',{kind:accepted?'accepted':'outgoing',conversationId,fromUserId:req.user!.id});
    res.status(201).json({status:accepted?'accepted':'requested',conversationId});
  }catch(e:any){res.status(400).json({error:e?.message||'request_failed'});}
});
app.post('/api/contact-requests/:id/accept',requireAuth,(req,res)=>{
  try{
    const before=contactRequests(req.user!.id).incoming.find(x=>x.id===Number(req.params.id));
    if(!before) return res.status(404).json({error:'request_not_found'});
    acceptContactRequest(Number(req.params.id),req.user!.id);
    const conversationId=findOrCreateDirect(req.user!.id,before.sender.id);
    syncPresenceVisibility(before.sender.id);syncPresenceVisibility(req.user!.id);
    io.to(roomForUser(before.sender.id)).emit('contacts:changed',{kind:'accepted',conversationId,fromUserId:req.user!.id});
    io.to(roomForUser(req.user!.id)).emit('contacts:changed',{kind:'accepted',conversationId,fromUserId:before.sender.id});
    res.json({conversationId});
  }catch{res.status(404).json({error:'request_not_found'});}
});
app.delete('/api/contact-requests/:id',requireAuth,(req,res)=>{
  const before=contactRequests(req.user!.id).incoming.find(x=>x.id===Number(req.params.id));
  declineContactRequest(Number(req.params.id),req.user!.id);
  if(before)io.to(roomForUser(before.sender.id)).emit('contacts:changed',{kind:'declined',fromUserId:req.user!.id});
  io.to(roomForUser(req.user!.id)).emit('contacts:changed',{kind:'declined'});
  res.status(204).end();
});
app.delete('/api/contacts/:userId',requireAuth,(req,res)=>{const other=Number(req.params.userId);removeContact(req.user!.id,other);syncPresenceVisibility(req.user!.id);syncPresenceVisibility(other);res.status(204).end();});
app.get('/api/blocks',requireAuth,(req,res)=>res.json(listBlocked(req.user!.id)));
app.post('/api/blocks',requireAuth,(req,res)=>{const uid=Number(req.body?.userId);try{blockUser(req.user!.id,uid);syncPresenceVisibility(req.user!.id);syncPresenceVisibility(uid);res.status(204).end();}catch(e:any){res.status(400).json({error:e?.message||'block_failed'});}});
app.delete('/api/blocks/:userId',requireAuth,(req,res)=>{const other=Number(req.params.userId);unblockUser(req.user!.id,other);syncPresenceVisibility(req.user!.id);syncPresenceVisibility(other);res.status(204).end();});

app.get('/api/conversations',requireAuth,(req,res)=>{
  findOrCreateSelf(req.user!.id);
  res.json(conversationSummaries(req.user!.id));
});
app.post('/api/conversations/self',requireAuth,(req,res)=>res.status(201).json({id:findOrCreateSelf(req.user!.id)}));
app.post('/api/conversations/direct',requireAuth,(req,res)=>{
  const otherId=Number(req.body?.userId); if (!getUserById(otherId) || otherId===req.user!.id) return res.status(400).json({error:'invalid_user'});
  if(isBlockedPair(req.user!.id,otherId)) return res.status(403).json({error:'blocked'});
  if(!canMessageUser(req.user!.id,otherId)) return res.status(403).json({error:'dm_not_allowed'});
  const id=findOrCreateDirect(req.user!.id,otherId); res.status(201).json({id});
});
function pushPreview(message:MessageView):string{
  if(message.deletedAt)return 'Message deleted';
  if(message.file?.mimeType.startsWith('audio/'))return 'Voice message';
  if(message.file?.mimeType.startsWith('video/'))return 'Video';
  if(message.type==='image')return 'Photo';
  if(message.type==='file')return message.file?.name?`Attachment: ${message.file.name}`:'Attachment';
  const text=String(message.body??'').replace(/\s+/g,' ').trim();
  return text.length>180?`${text.slice(0,177)}…`:text||'New message';
}
function queuePushForMessage(message:MessageView):void{
  const members=conversationMemberIds(message.conversationId);
  const group=members.length>2;
  for(const uid of members){
    if(uid===message.sender.id)continue;
    const title=group?`HomeChat · ${message.sender.displayName}`:message.sender.displayName;
    void sendPushToUser(uid,{title,body:pushPreview(message),conversationId:message.conversationId,messageId:message.id,senderId:message.sender.id},activeDeviceIds(uid)).catch(error=>console.warn('HomeChat push queue failed:',error));
  }
}

app.post('/api/conversations/:id/messages',requireAuth,(req,res)=>{
  const cid=Number(req.params.id);
  const body=typeof req.body?.body==='string'?req.body.body:null;
  const fileId=req.body?.fileId?Number(req.body.fileId):null;
  const clientNonce=typeof req.body?.clientNonce==='string'?req.body.clientNonce.slice(0,80):null;
  const replyToId=req.body?.replyToId?Number(req.body.replyToId):null;
  if(!isMember(cid,req.user!.id)) return res.status(403).json({error:'not_a_member'});
  if(directConversationBlocked(cid,req.user!.id)) return res.status(403).json({error:'blocked'});
  if(directConversationPrivacyBlocked(cid,req.user!.id)) return res.status(403).json({error:'dm_not_allowed'});
  if(!body?.trim() && !fileId) return res.status(400).json({error:'empty_message'});
  try{
    const message=createMessage(cid,req.user!.id,body,fileId,clientNonce,replyToId);
    for(const uid of conversationMemberIds(cid)) io.to(roomForUser(uid)).emit('message:new',message);
    queuePushForMessage(message);
    res.status(201).json(message);
  }catch(e:any){
    res.status(400).json({error:e?.message||'send_failed'});
  }
});
app.post('/api/conversations/group',requireAuth,(req,res)=>{
  const name=String(req.body?.name??'').trim(); const members=Array.isArray(req.body?.memberIds)?req.body.memberIds.map(Number):[];
  if (!name || name.length>100 || members.length<1) return res.status(400).json({error:'invalid_group'});
  if (members.some((id:number)=>!getUserById(id))) return res.status(400).json({error:'invalid_member'});
  res.status(201).json({id:createGroup(req.user!.id,name,members)});
});
app.patch('/api/conversations/:id/group',requireAuth,(req,res)=>{
  const cid=Number(req.params.id); if(!isMember(cid,req.user!.id)) return res.status(403).json({error:'not_a_member'});
  const name=String(req.body?.name??'').trim(); if(!name || name.length>100) return res.status(400).json({error:'invalid_name'});
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
const uploadSingle=(req:any,res:any,next:any)=>multer({storage,limits:{fileSize:getServiceSettings().maxUploadBytes}}).single('file')(req,res,(err:any)=>{if(err?.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'file_too_large',maxBytes:getServiceSettings().maxUploadBytes});if(err)return res.status(400).json({error:'upload_failed'});next();});
app.post('/api/files',requireAuth,uploadSingle,(req,res)=>{
  if (!req.file) return res.status(400).json({error:'missing_file'});
  const id=insertFile(req.user!.id,req.file.originalname,req.file.filename,req.file.mimetype || 'application/octet-stream',req.file.size);
  res.status(201).json({id,name:req.file.originalname,mimeType:req.file.mimetype,size:req.file.size,url:`/api/files/${id}`});
});
app.post('/api/me/avatar',requireAuth,uploadSingle,(req,res)=>{
  if (!req.file) return res.status(400).json({error:'missing_file'});
  const avatarTypes=new Set(['image/jpeg','image/png','image/webp','image/gif']);
  if (!avatarTypes.has(String(req.file.mimetype)) || req.file.size>10*1024*1024) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({error:req.file.size>10*1024*1024?'avatar_too_large':'avatar_must_be_raster_image'});
  }
  const id=insertFile(req.user!.id,req.file.originalname,req.file.filename,req.file.mimetype || 'application/octet-stream',req.file.size);
  try { res.json(setUserAvatar(req.user!.id,id)); }
  catch { res.status(400).json({error:'invalid_avatar'}); }
});

app.post('/api/conversations/:id/avatar',requireAuth,uploadSingle,(req,res)=>{
  const cid=Number(req.params.id);
  if (!isMember(cid,req.user!.id)) {
    if(req.file){try{fs.unlinkSync(req.file.path);}catch{}}
    return res.status(403).json({error:'not_a_member'});
  }
  if (!req.file) return res.status(400).json({error:'missing_file'});
  const avatarTypes=new Set(['image/jpeg','image/png','image/webp','image/gif']);
  if (!avatarTypes.has(String(req.file.mimetype)) || req.file.size>10*1024*1024) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({error:req.file.size>10*1024*1024?'avatar_too_large':'avatar_must_be_raster_image'});
  }
  const id=insertFile(req.user!.id,req.file.originalname,req.file.filename,req.file.mimetype || 'application/octet-stream',req.file.size);
  try { res.json({avatarUrl:setGroupAvatar(cid,req.user!.id,id)}); }
  catch { res.status(400).json({error:'invalid_group_avatar'}); }
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
    const r=await fetch(url,{signal:controller.signal,redirect:'error',headers:{'User-Agent':`HomeChat/${APP_VERSION} link-preview`,'Accept':'text/html,application/xhtml+xml'}});
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
// The real HomeChat app is HTTPS-only.  Port 8092 is intentionally kept as a
// tiny HTTP bootstrap service so a new phone can download the private CA before
// it has enough trust to open the secure app on 8093.
let tlsReady=false;
try { tlsReady=ensureTlsMaterial(); }
catch (error) { console.error('HomeChat: automatic TLS setup failed', error); }
const server=tlsReady
  ? https.createServer({cert:fs.readFileSync(config.tlsCertFile),key:fs.readFileSync(config.tlsKeyFile)},app)
  : null;
const io=new SocketServer(server ?? http.createServer(),{cors:{origin:true,credentials:true}});
const online=new Map<number,number>();
const onlineDevices=new Map<number,Map<string,number>>();
function roomForUser(id:number){return `user:${id}`;}
function activeDeviceIds(userId:number):Set<string>{return new Set(onlineDevices.get(userId)?.keys()??[]);}
function trackDevice(userId:number,deviceId:string,delta:1|-1){if(!deviceId)return;const devices=onlineDevices.get(userId)??new Map<string,number>();const next=(devices.get(deviceId)??0)+delta;if(next>0)devices.set(deviceId,next);else devices.delete(deviceId);if(devices.size)onlineDevices.set(userId,devices);else onlineDevices.delete(userId);}
function broadcastPresence(userId:number,isOnline:boolean){for(const viewer of listUsers())if(canSeePresence(viewer.id,userId))io.to(roomForUser(viewer.id)).emit('presence:update',{userId,online:isOnline});}
function syncPresenceVisibility(userId:number){for(const viewer of listUsers())io.to(roomForUser(viewer.id)).emit('presence:update',{userId,online:online.has(userId)&&canSeePresence(viewer.id,userId)});}

io.use((socket,next)=>{
  const token=String(socket.handshake.auth?.token ?? socket.handshake.headers.authorization?.toString().replace(/^Bearer\s+/,'') ?? '');
  const user=userFromToken(token); if(!user) return next(new Error('unauthorized'));
  socket.data.user=user; socket.data.deviceId=String(socket.handshake.auth?.deviceId??'').slice(0,128); next();
});
io.on('connection',(socket)=>{
  const user=socket.data.user as {id:number};
  const deviceId=String(socket.data.deviceId??'');
  socket.join(roomForUser(user.id));
  trackDevice(user.id,deviceId,1);
  const count=(online.get(user.id)??0)+1; online.set(user.id,count); if(count===1) broadcastPresence(user.id,true);
  socket.emit('presence:snapshot',{userIds:[...online.keys()].filter(id=>canSeePresence(user.id,id))});

  socket.on('conversation:join',(payload,ack)=>{
    const cid=Number(payload?.conversationId); if(!isMember(cid,user.id)) return ack?.({ok:false,error:'not_a_member'});
    socket.join(`conversation:${cid}`); ack?.({ok:true});
  });
  socket.on('message:send',(payload,ack)=>{
    const cid=Number(payload?.conversationId); const body=typeof payload?.body==='string'?payload.body:null; const fileId=payload?.fileId?Number(payload.fileId):null; const clientNonce=typeof payload?.clientNonce==='string'?payload.clientNonce.slice(0,80):null; const replyToId=payload?.replyToId?Number(payload.replyToId):null;
    if(!isMember(cid,user.id)) return ack?.({ok:false,error:'not_a_member'});
    if(directConversationBlocked(cid,user.id)) return ack?.({ok:false,error:'blocked'});
    if(directConversationPrivacyBlocked(cid,user.id)) return ack?.({ok:false,error:'dm_not_allowed'});
    if(!body?.trim() && !fileId) return ack?.({ok:false,error:'empty_message'});
    try {
      const message=createMessage(cid,user.id,body,fileId,clientNonce,replyToId);
      for(const uid of conversationMemberIds(cid)) io.to(roomForUser(uid)).emit('message:new',message);
      queuePushForMessage(message);
      ack?.({ok:true,message});
    } catch { ack?.({ok:false,error:'send_failed'}); }
  });
  socket.on('message:edit',(payload,ack)=>{
    const mid=Number(payload?.messageId), body=String(payload?.body??''); const existing=messageById(mid);
    if(!existing || !isMember(existing.conversationId,user.id)) return ack?.({ok:false,error:'forbidden'});
    try{const message=editMessage(mid,user.id,body);for(const uid of conversationMemberIds(message.conversationId))io.to(roomForUser(uid)).emit('message:update',message);ack?.({ok:true,message});}
    catch(e:any){ack?.({ok:false,error:e?.message||'edit_failed'});}
  });
  socket.on('message:delete',(payload,ack)=>{
    const mid=Number(payload?.messageId); const existing=messageById(mid);
    if(!existing || !isMember(existing.conversationId,user.id)) return ack?.({ok:false,error:'forbidden'});
    try{const message=deleteMessage(mid,user.id);for(const uid of conversationMemberIds(message.conversationId))io.to(roomForUser(uid)).emit('message:update',message);ack?.({ok:true,message});}
    catch(e:any){ack?.({ok:false,error:e?.message||'delete_failed'});}
  });

  socket.on('reaction:toggle',(payload,ack)=>{
    const mid=Number(payload?.messageId); const emoji=String(payload?.emoji??''); const m=messageById(mid);
    if(!m || !isMember(m.conversationId,user.id)) return ack?.({ok:false,error:'not_a_member'});
    try{const reactions=toggleReaction(mid,user.id,emoji);for(const uid of conversationMemberIds(m.conversationId))io.to(roomForUser(uid)).emit('reaction:update',{messageId:mid,reactions});ack?.({ok:true,reactions});}
    catch{ack?.({ok:false,error:'reaction_failed'});}
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
  socket.on('disconnect',()=>{trackDevice(user.id,deviceId,-1);
    const next=Math.max(0,(online.get(user.id)??1)-1); if(next===0){online.delete(user.id);broadcastPresence(user.id,false);} else online.set(user.id,next);
  });
});

function cleanupStorage(): void {
  pruneExpiredSessions();
pruneStalePushSubscriptions();
  const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
  pruneOrphanFiles(cutoff);
}
cleanupStorage();
const cleanupTimer=setInterval(cleanupStorage,6*60*60*1000);(cleanupTimer as any).unref?.();

const HTML_ESCAPES: Record<string,string> = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
function htmlEscape(value:string): string {
  return value.replace(/[&<>"']/g,ch=>HTML_ESCAPES[ch] ?? ch);
}

const bootstrap=express();
bootstrap.disable('x-powered-by');
bootstrap.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');next();});
bootstrap.get('/health',(_req,res)=>res.json({ok:true,version:APP_VERSION,service:'bootstrap',httpsReady:tlsReady}));
bootstrap.get('/homechat-root-ca.crt',(_req,res)=>{
  if(!fs.existsSync(config.caCertFile))return res.status(404).type('text/plain').send('HomeChat CA certificate has not been generated yet.');
  res.type('application/x-x509-ca-cert');
  res.setHeader('Content-Disposition','attachment; filename="homechat-root-ca.crt"');
  res.sendFile(config.caCertFile);
});
bootstrap.get('/',(req,res)=>{
  const host=htmlEscape(req.hostname || config.publicHost);
  const secureUrl=`https://${host}:${config.publicHttpsPort}/`;
  const ready=tlsReady&&fs.existsSync(config.caCertFile);
  res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>HomeChat secure setup</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090e;color:#f4f5fb;font-family:system-ui,-apple-system,sans-serif}.card{width:min(430px,90vw);padding:28px;border:1px solid #303444;border-radius:20px;background:#12141d;box-shadow:0 30px 90px #0008}h1{margin:0 0 8px}p{color:#aeb4c6;line-height:1.5}.button{display:block;text-align:center;text-decoration:none;margin-top:14px;padding:13px 16px;border-radius:12px;background:#6d5dfc;color:white;font-weight:700}.secondary{background:#242837}.disabled{opacity:.45;pointer-events:none}.note{font-size:13px}</style></head><body><main class="card"><h1>HomeChat secure setup</h1><p>Install the HomeChat root certificate on this device, trust it as a root CA, then continue to the secure app.</p><a class="button${fs.existsSync(config.caCertFile)?'':' disabled'}" href="/homechat-root-ca.crt">Install certificate</a><a class="button secondary${fs.existsSync(windowsClientFile)?'':' disabled'}" href="/downloads/HomeChat-Windows-Setup.exe">Download HomeChat for Windows</a><a class="button secondary${tlsReady?'':' disabled'}" href="${secureUrl}">Continue to secure HomeChat</a>${ready?'':'<p class="note">TLS files are not ready yet. Check HOMECHAT_HOST, HOMECHAT_AUTO_TLS, and the container logs.</p>'}<p class="note">Secure HomeChat: ${secureUrl}</p></main></body></html>`);
});

const bootstrapServer=http.createServer(bootstrap);
bootstrapServer.listen(config.httpPort,config.host,()=>console.log(`HomeChat ${APP_VERSION} bootstrap listening on http://${config.host}:${config.httpPort}`));
if(server){
  server.listen(config.httpsPort,config.host,()=>console.log(`HomeChat ${APP_VERSION} secure app listening on https://${config.host}:${config.httpsPort}`));
}else{
  console.warn(`HomeChat ${APP_VERSION}: HTTPS not started; missing ${config.tlsCertFile} or ${config.tlsKeyFile}`);
}
