import { io, type Socket } from 'socket.io-client';

export type User = { id:number; hid:string; username:string; displayName:string; avatarUrl:string|null; isAdmin:boolean };
export type FileView = { id:number; name:string; mimeType:string; size:number; url:string };
export type MessageReceipt = { userId:number; deliveredAt:string|null; readAt:string|null };
export type Message = { id:number; conversationId:number; sender:User; type:'text'|'image'|'file'; body:string|null; file:FileView|null; createdAt:string; editedAt:string|null; receipts:MessageReceipt[] };
export type Conversation = { id:number; type:'direct'|'group'; isSelf:boolean; name:string|null; avatarUrl:string|null; members:User[]; unreadCount:number; lastMessage:Message|null };
export type InventoryAttachment = { messageId:number; sender:User; file:FileView; createdAt:string };
export type InventoryLink = { messageId:number; sender:User; url:string; createdAt:string };
export type ConversationInventory = { media:InventoryAttachment[]; files:InventoryAttachment[]; links:InventoryLink[] };
export type LinkPreview = { url:string; title:string|null; description:string|null; imageUrl:string|null; siteName:string|null; hostname:string };

type LoginResponse = { token:string; user:User };

export class HomeClient {
  socket?: Socket;
  constructor(public baseUrl:string, public token:string) {}

  static async login(baseUrl:string, username:string, password:string):Promise<LoginResponse> {
    const r = await fetch(`${baseUrl}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
    if (!r.ok) throw new Error('Invalid username or password');
    return r.json();
  }

  async api<T>(path:string, init:RequestInit={}):Promise<T> {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) headers.set('Content-Type','application/json');
    headers.set('Authorization',`Bearer ${this.token}`);
    const r = await fetch(`${this.baseUrl}${path}`, {...init, headers});
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.status===204 ? undefined as T : r.json();
  }

  connect(){ this.socket = io(this.baseUrl,{auth:{token:this.token}}); return this.socket; }
  disconnect(){ this.socket?.disconnect(); }
  me(){ return this.api<User>('/api/me'); }
  users(){ return this.api<User[]>('/api/users'); }
  conversations(){ return this.api<Conversation[]>('/api/conversations'); }
  messages(conversationId:number,before?:number){ return this.api<Message[]>(`/api/conversations/${conversationId}/messages${before?`?before=${before}`:''}`); }
  inventory(conversationId:number){ return this.api<ConversationInventory>(`/api/conversations/${conversationId}/inventory`); }
  linkPreview(url:string){ return this.api<LinkPreview>(`/api/link-preview?url=${encodeURIComponent(url)}`); }
  savedMessages(){ return this.api<{id:number}>('/api/conversations/self',{method:'POST'}); }
  createDirect(userId:number){ return this.api<{id:number}>('/api/conversations/direct',{method:'POST',body:JSON.stringify({userId})}); }
  createGroup(name:string,memberIds:number[]){ return this.api<{id:number}>('/api/conversations/group',{method:'POST',body:JSON.stringify({name,memberIds})}); }
  createUser(username:string,displayName:string,password:string,isAdmin=false){ return this.api<User>('/api/users',{method:'POST',body:JSON.stringify({username,displayName,password,isAdmin})}); }
  send(conversationId:number,body?:string,fileId?:number){ return new Promise<Message>((resolve,reject)=>this.socket?.emit('message:send',{conversationId,body,fileId},(r:any)=>r?.ok?resolve(r.message):reject(new Error(r?.error??'send_failed')))); }
  typing(conversationId:number,typing:boolean){ this.socket?.emit('typing:set',{conversationId,typing}); }
  receipt(messageId:number,kind:'delivered'|'read'){ this.socket?.emit('receipt:set',{messageId,kind}); }
  async upload(file:File){ const fd=new FormData();fd.append('file',file); return this.api<FileView>('/api/files',{method:'POST',body:fd}); }
  async uploadAvatar(file:File){ const fd=new FormData();fd.append('file',file); return this.api<User>('/api/me/avatar',{method:'POST',body:fd}); }
  async fileBlob(fileId:number){ const r=await fetch(`${this.baseUrl}/api/files/${fileId}`,{headers:{Authorization:`Bearer ${this.token}`}}); if(!r.ok)throw new Error('file_failed'); return r.blob(); }
}
