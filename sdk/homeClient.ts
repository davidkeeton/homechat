import { io, type Socket } from 'socket.io-client';

export type User = { id:number; hid:string; displayName:string; avatarUrl:string|null; isAdmin:boolean };
export type FileView = { id:number; name:string; mimeType:string; size:number; url:string };
export type MessageReceipt = { userId:number; deliveredAt:string|null; readAt:string|null };
export type MessageReaction = { emoji:string; userIds:number[] };
export type ReplyPreview = { id:number; sender:User; type:'text'|'image'|'file'; body:string|null; file:FileView|null; deletedAt:string|null };
export type Message = { id:number; conversationId:number; sender:User; type:'text'|'image'|'file'; body:string|null; file:FileView|null; createdAt:string; editedAt:string|null; deletedAt:string|null; replyTo:ReplyPreview|null; receipts:MessageReceipt[]; reactions:MessageReaction[]; clientNonce?:string|null };
export type ContactRequest = { id:number; sender:User; recipient:User; createdAt:string };
export type ContactRequests = { incoming:ContactRequest[]; outgoing:ContactRequest[] };
export type DirectoryUser = User & { relationship:'self'|'contact'|'incoming'|'outgoing'|'blocked'|'none' };
export type Conversation = { id:number; type:'direct'|'group'; isSelf:boolean; name:string|null; avatarUrl:string|null; members:User[]; unreadCount:number; mentionCount:number; lastMessage:Message|null };
export type InventoryAttachment = { messageId:number; sender:User; file:FileView; createdAt:string };
export type InventoryLink = { messageId:number; sender:User; url:string; createdAt:string };
export type ConversationInventory = { media:InventoryAttachment[]; files:InventoryAttachment[]; links:InventoryLink[] };
export type LinkPreview = { url:string; title:string|null; description:string|null; imageUrl:string|null; siteName:string|null; hostname:string };
export type MessageSearchResult = { message:Message };
export type PrivacySettings = { dmPolicy:'everyone'|'contacts'|'nobody'; contactPolicy:'everyone'|'nobody'; presencePolicy:'everyone'|'contacts'|'nobody'; directoryVisible:boolean };
export type PublicServiceConfig = { registrationEnabled:boolean; inviteRequired:boolean; maxUploadBytes:number };
export type AdminUser = User & { disabled:boolean; createdAt:string };
export type AdminOverview = { settings:PublicServiceConfig; storage:{fileCount:number;bytes:number;messageCount:number;userCount:number} };
export type PushConfig = { publicKey:string };
export type PushSubscriptionJson = { endpoint:string; keys:{p256dh:string;auth:string}; deviceId:string };

type LoginResponse = { token:string; user:User };

export class HomeClient {
  socket?: Socket;
  constructor(public baseUrl:string, public token:string, public deviceId='sdk') {}

  static async login(baseUrl:string, displayName:string, password:string):Promise<LoginResponse> {
    const r = await fetch(`${baseUrl}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({displayName,password}) });
    if (!r.ok) throw new Error('Invalid display name or password');
    return r.json();
  }

  static async publicConfig(baseUrl:string):Promise<PublicServiceConfig>{const r=await fetch(`${baseUrl}/api/public-config`);if(!r.ok)throw new Error('config_failed');return r.json();}
  static async register(baseUrl:string, displayName:string, password:string, inviteCode=''):Promise<LoginResponse>{const r=await fetch(`${baseUrl}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName,password,inviteCode})});if(!r.ok)throw new Error(`${r.status} ${await r.text()}`);return r.json();}

  async api<T>(path:string, init:RequestInit={}):Promise<T> {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) headers.set('Content-Type','application/json');
    headers.set('Authorization',`Bearer ${this.token}`);
    const r = await fetch(`${this.baseUrl}${path}`, {...init, headers});
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.status===204 ? undefined as T : r.json();
  }

  connect(){ this.socket = io(this.baseUrl,{auth:{token:this.token,deviceId:this.deviceId}}); return this.socket; }
  disconnect(){ this.socket?.disconnect(); }
  logout(){return this.api<void>('/api/auth/logout',{method:'POST'});}
  pushConfig(){return this.api<PushConfig>('/api/push/config');}
  savePushSubscription(subscription:PushSubscriptionJson){return this.api<void>('/api/push/subscriptions',{method:'POST',body:JSON.stringify(subscription)});}
  deletePushSubscription(endpoint:string){return this.api<void>('/api/push/subscriptions',{method:'DELETE',body:JSON.stringify({endpoint})});}
  me(){ return this.api<User>('/api/me'); }
  setDisplayName(displayName:string){return this.api<User>('/api/me',{method:'PATCH',body:JSON.stringify({displayName})});}
  users(){ return this.api<User[]>('/api/users'); }
  privacy(){return this.api<PrivacySettings>('/api/me/privacy');}
  setPrivacy(settings:Partial<PrivacySettings>){return this.api<PrivacySettings>('/api/me/privacy',{method:'PUT',body:JSON.stringify(settings)});}
  adminOverview(){return this.api<AdminOverview>('/api/admin/overview');}
  adminUsers(){return this.api<AdminUser[]>('/api/admin/users');}
  updateAdminSettings(settings:{registrationEnabled?:boolean;inviteCode?:string;maxUploadBytes?:number}){return this.api<PublicServiceConfig>('/api/admin/settings',{method:'PUT',body:JSON.stringify(settings)});}
  setUserDisabled(userId:number,disabled:boolean){return this.api<void>(`/api/admin/users/${userId}`,{method:'PATCH',body:JSON.stringify({disabled})});}
  resetUserPassword(userId:number,password:string){return this.api<void>(`/api/admin/users/${userId}/reset-password`,{method:'POST',body:JSON.stringify({password})});}
  contacts(){ return this.api<User[]>('/api/contacts'); }
  contactRequests(){ return this.api<ContactRequests>('/api/contact-requests'); }
  directory(q=''){ return this.api<DirectoryUser[]>(`/api/directory?q=${encodeURIComponent(q)}`); }
  searchMessages(q:string,limit=50){ return this.api<MessageSearchResult[]>(`/api/search/messages?q=${encodeURIComponent(q)}&limit=${limit}`); }
  requestContact(userId:number){ return this.api<void>('/api/contact-requests',{method:'POST',body:JSON.stringify({userId})}); }
  acceptContactRequest(id:number){ return this.api<void>(`/api/contact-requests/${id}/accept`,{method:'POST'}); }
  declineContactRequest(id:number){ return this.api<void>(`/api/contact-requests/${id}`,{method:'DELETE'}); }
  removeContact(userId:number){ return this.api<void>(`/api/contacts/${userId}`,{method:'DELETE'}); }
  blocked(){ return this.api<User[]>('/api/blocks'); }
  block(userId:number){ return this.api<void>('/api/blocks',{method:'POST',body:JSON.stringify({userId})}); }
  unblock(userId:number){ return this.api<void>(`/api/blocks/${userId}`,{method:'DELETE'}); }
  conversations(){ return this.api<Conversation[]>('/api/conversations'); }
  deleteConversation(conversationId:number){ return this.api<void>(`/api/conversations/${conversationId}`,{method:'DELETE'}); }
  messages(conversationId:number,before?:number){ return this.api<Message[]>(`/api/conversations/${conversationId}/messages${before?`?before=${before}`:''}`); }
  inventory(conversationId:number){ return this.api<ConversationInventory>(`/api/conversations/${conversationId}/inventory`); }
  linkPreview(url:string){ return this.api<LinkPreview>(`/api/link-preview?url=${encodeURIComponent(url)}`); }
  savedMessages(){ return this.api<{id:number}>('/api/conversations/self',{method:'POST'}); }
  createDirect(userId:number){ return this.api<{id:number}>('/api/conversations/direct',{method:'POST',body:JSON.stringify({userId})}); }
  createGroup(name:string,memberIds:number[]){ return this.api<{id:number}>('/api/conversations/group',{method:'POST',body:JSON.stringify({name,memberIds})}); }
  renameGroup(conversationId:number,name:string){ return this.api<void>(`/api/conversations/${conversationId}/group`,{method:'PATCH',body:JSON.stringify({name})}); }
  async uploadGroupAvatar(conversationId:number,file:File){ const fd=new FormData();fd.append('file',file); return this.api<{avatarUrl:string}>(`/api/conversations/${conversationId}/avatar`,{method:'POST',body:fd}); }
  addGroupMember(conversationId:number,userId:number){ return this.api<void>(`/api/conversations/${conversationId}/members`,{method:'POST',body:JSON.stringify({userId})}); }
  removeGroupMember(conversationId:number,userId:number){ return this.api<void>(`/api/conversations/${conversationId}/members/${userId}`,{method:'DELETE'}); }
  createUser(displayName:string,password:string,isAdmin=false){ return this.api<User>('/api/users',{method:'POST',body:JSON.stringify({displayName,password,isAdmin})}); }
  send(conversationId:number,body?:string,fileId?:number,clientNonce?:string,replyToId?:number){ return new Promise<Message>((resolve,reject)=>{if(!this.socket?.connected)return reject(new Error('offline'));this.socket.emit('message:send',{conversationId,body,fileId,clientNonce,replyToId},(r:any)=>r?.ok?resolve(r.message):reject(new Error(r?.error??'send_failed')));}); }
  editMessage(messageId:number,body:string){ return new Promise<Message>((resolve,reject)=>{if(!this.socket?.connected)return reject(new Error('offline'));this.socket.emit('message:edit',{messageId,body},(r:any)=>r?.ok?resolve(r.message):reject(new Error(r?.error??'edit_failed')));}); }
  deleteMessage(messageId:number){ return new Promise<Message>((resolve,reject)=>{if(!this.socket?.connected)return reject(new Error('offline'));this.socket.emit('message:delete',{messageId},(r:any)=>r?.ok?resolve(r.message):reject(new Error(r?.error??'delete_failed')));}); }
  reaction(messageId:number,emoji:string){ return new Promise<MessageReaction[]>((resolve,reject)=>{if(!this.socket?.connected)return reject(new Error('offline'));this.socket.emit('reaction:toggle',{messageId,emoji},(r:any)=>r?.ok?resolve(r.reactions):reject(new Error(r?.error??'reaction_failed')));}); }
  typing(conversationId:number,typing:boolean){ this.socket?.emit('typing:set',{conversationId,typing}); }
  receipt(messageId:number,kind:'delivered'|'read'){ this.socket?.emit('receipt:set',{messageId,kind}); }
  async upload(file:File){ const fd=new FormData();fd.append('file',file); return this.api<FileView>('/api/files',{method:'POST',body:fd}); }
  async uploadAvatar(file:File){ const fd=new FormData();fd.append('file',file); return this.api<User>('/api/me/avatar',{method:'POST',body:fd}); }
  async fileBlob(fileId:number){ const r=await fetch(`${this.baseUrl}/api/files/${fileId}`,{headers:{Authorization:`Bearer ${this.token}`}}); if(!r.ok)throw new Error('file_failed'); return r.blob(); }
}
