import { io, type Socket } from 'socket.io-client';

export class HomeClient {
  private socket?: Socket;
  constructor(public baseUrl:string, public token:string) {}
  async api<T>(path:string, init:RequestInit={}):Promise<T>{
    const r=await fetch(`${this.baseUrl}${path}`,{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.token}`,...init.headers}});
    if(!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.status===204?undefined as T:r.json();
  }
  connect(){ this.socket=io(this.baseUrl,{auth:{token:this.token}}); return this.socket; }
  disconnect(){ this.socket?.disconnect(); }
  conversations(){return this.api('/api/conversations');}
  messages(conversationId:number,before?:number){return this.api(`/api/conversations/${conversationId}/messages${before?`?before=${before}`:''}`);}
  send(conversationId:number,body?:string,fileId?:number){return new Promise((resolve,reject)=>this.socket?.emit('message:send',{conversationId,body,fileId},(r:any)=>r?.ok?resolve(r.message):reject(new Error(r?.error??'send_failed'))));}
  typing(conversationId:number,typing:boolean){this.socket?.emit('typing:set',{conversationId,typing});}
  receipt(messageId:number,kind:'delivered'|'read'){this.socket?.emit('receipt:set',{messageId,kind});}
  async upload(file:File){const fd=new FormData();fd.append('file',file);const r=await fetch(`${this.baseUrl}/api/files`,{method:'POST',headers:{Authorization:`Bearer ${this.token}`},body:fd});if(!r.ok)throw new Error(await r.text());return r.json();}
}
