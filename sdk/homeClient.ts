import { io, type Socket } from 'socket.io-client';

export type User = { id:number; hid:string; username:string; displayName:string; avatarUrl:string|null; isAdmin:boolean };
export type FileView = { id:number; name:string; mimeType:string; size:number; url:string };
export type MessageReceipt = { userId:number; deliveredAt:string|null; readAt:string|null };
export type Message = { id:number; conversationId:number; sender:User; type:'text'|'image'|'file'; body:string|null; file:FileView|null; createdAt:string; editedAt:string|null; receipts:MessageReceipt[] };
export type Conversation = { id:number; type:'direct'|'group'; isSelf:boolean; name:string|null; avatarUrl:string|null; members:User[]; unreadCount:number; lastMessage:Message|null };
export type ConversationInventory = { media:any[]; files:any[]; links:any[] };

export class HomeClient {
  private socket?: Socket;
  constructor(public baseUrl:string, public token:string) {}
  async api<T>(path:string, init:RequestInit={}):Promise<T>{
    const headers=new Headers(init.headers); if(!(init.body instanceof FormData))headers.set('Content-Type','application/json'); headers.set('Authorization',`Bearer ${this.token}`);
    const r=await fetch(`${this.baseUrl}${path}`,{...init,headers}); if(!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.status===204?undefined as T:r.json();
  }
  connect(){ this.socket=io(this.baseUrl,{auth:{token:this.token}}); return this.socket; }
  disconnect(){ this.socket?.disconnect(); }
  conversations(){return this.api<Conversation[]>('/api/conversations');}
  messages(conversationId:number,before?:number){return this.api<Message[]>(`/api/conversations/${conversationId}/messages${before?`?before=${before}`:''}`);}
  inventory(conversationId:number){return this.api<ConversationInventory>(`/api/conversations/${conversationId}/inventory`);}
  savedMessages(){return this.api<{id:number}>('/api/conversations/self',{method:'POST'});}
  renameGroup(conversationId:number,name:string){return this.api<void>(`/api/conversations/${conversationId}/group`,{method:'PATCH',body:JSON.stringify({name})});}
  addGroupMember(conversationId:number,userId:number){return this.api<void>(`/api/conversations/${conversationId}/members`,{method:'POST',body:JSON.stringify({userId})});}
  removeGroupMember(conversationId:number,userId:number){return this.api<void>(`/api/conversations/${conversationId}/members/${userId}`,{method:'DELETE'});}
  send(conversationId:number,body?:string,fileId?:number){return new Promise((resolve,reject)=>this.socket?.emit('message:send',{conversationId,body,fileId},(r:any)=>r?.ok?resolve(r.message):reject(new Error(r?.error??'send_failed'))));}
  typing(conversationId:number,typing:boolean){this.socket?.emit('typing:set',{conversationId,typing});}
  receipt(messageId:number,kind:'delivered'|'read'){this.socket?.emit('receipt:set',{messageId,kind});}
  async upload(file:File){const fd=new FormData();fd.append('file',file);return this.api<FileView>('/api/files',{method:'POST',body:fd});}
}
