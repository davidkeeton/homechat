import { useEffect, useMemo, useRef, useState } from 'react';
import { HomeClient, type Conversation, type Message, type User } from './lib/homeClient';

const BASE_URL = window.location.origin;

type Session = { token:string; user:User };

function initials(name:string){ return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()).join('') || '?'; }
function fmtTime(ts:string){ const d=new Date(ts); return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }

function Avatar({name,online=false}:{name:string;online?:boolean}){
  return <div className="avatar-wrap"><div className="avatar">{initials(name)}</div><span className={online?'presence on':'presence'} /></div>;
}

function Login({onLogin}:{onLogin:(s:Session)=>void}){
  const [username,setUsername]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){ e.preventDefault(); setBusy(true); setError(''); try{ const s=await HomeClient.login(BASE_URL,username,password); localStorage.setItem('homechat.session',JSON.stringify(s)); onLogin(s); }catch(e:any){setError(e.message||'Login failed');}finally{setBusy(false);} }
  return <div className="login-shell"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark">H</div><h1>HomeChat</h1><p>Private chat for your home.</p>
    <label>Username<input autoFocus value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label>
    <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" /></label>
    {error && <div className="error">{error}</div>}
    <button className="primary" disabled={busy || !username || !password}>{busy?'Signing in…':'Sign in'}</button>
  </form></div>;
}

function Attachment({client,message}:{client:HomeClient;message:Message}){
  const [url,setUrl]=useState<string>();
  useEffect(()=>{ let alive=true; let object=''; if(message.file){client.fileBlob(message.file.id).then(b=>{if(alive){object=URL.createObjectURL(b);setUrl(object);}}).catch(()=>{});} return()=>{alive=false;if(object)URL.revokeObjectURL(object);};},[client,message.file?.id]);
  if(!message.file) return null;
  if(message.type==='image') return <div className="attachment image"><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={message.file.name}/></a><span>{message.file.name}</span></div>;
  return <a className="attachment file" href={url} download={message.file.name}>📎 {message.file.name}</a>;
}

function NewChatModal({users,current,onClose,onDirect,onGroup}:{users:User[];current:User;onClose:()=>void;onDirect:(u:User)=>void;onGroup:(name:string,ids:number[])=>void}){
  const others=users.filter(u=>u.id!==current.id); const [group,setGroup]=useState(false); const [name,setName]=useState(''); const [selected,setSelected]=useState<number[]>([]);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-head"><h3>{group?'New group':'New conversation'}</h3><button onClick={onClose}>×</button></div>
    {!group ? <>
      <div className="user-list">{others.map(u=><button className="user-row" key={u.id} onClick={()=>onDirect(u)}><Avatar name={u.displayName}/><span><strong>{u.displayName}</strong><small>@{u.username}</small></span></button>)}</div>
      <button className="secondary full" onClick={()=>setGroup(true)}>Create group chat</button>
    </> : <>
      <label className="field">Group name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Family"/></label>
      <div className="user-list">{others.map(u=><label className="check-row" key={u.id}><input type="checkbox" checked={selected.includes(u.id)} onChange={()=>setSelected(s=>s.includes(u.id)?s.filter(x=>x!==u.id):[...s,u.id])}/><Avatar name={u.displayName}/><span>{u.displayName}</span></label>)}</div>
      <div className="modal-actions"><button className="secondary" onClick={()=>setGroup(false)}>Back</button><button className="primary" disabled={!name.trim()||!selected.length} onClick={()=>onGroup(name.trim(),selected)}>Create</button></div>
    </>}
  </div></div>;
}

function AdminModal({client,onClose,onCreated}:{client:HomeClient;onClose:()=>void;onCreated:()=>void}){
  const [username,setUsername]=useState(''); const [displayName,setDisplayName]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState('');
  async function create(){try{await client.createUser(username,displayName,password);onCreated();onClose();}catch(e:any){setError(e.message||'Failed');}}
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal small" onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-head"><h3>Add user</h3><button onClick={onClose}>×</button></div>
    <label className="field">Display name<input value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>
    <label className="field">Username<input value={username} onChange={e=>setUsername(e.target.value)}/></label>
    <label className="field">Temporary password<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {error&&<div className="error">{error}</div>}
    <button className="primary full" disabled={!username||!displayName||password.length<8} onClick={create}>Create user</button>
  </div></div>;
}

export default function App(){
  const [session,setSession]=useState<Session|null>(()=>{try{return JSON.parse(localStorage.getItem('homechat.session')||'null')}catch{return null}});
  if(!session) return <Login onLogin={setSession}/>;
  return <Messenger session={session} onLogout={()=>{localStorage.removeItem('homechat.session');setSession(null)}}/>;
}

function Messenger({session,onLogout}:{session:Session;onLogout:()=>void}){
  const client=useMemo(()=>new HomeClient(BASE_URL,session.token),[session.token]);
  const [users,setUsers]=useState<User[]>([]); const [conversations,setConversations]=useState<Conversation[]>([]); const [activeId,setActiveId]=useState<number|null>(null); const [messages,setMessages]=useState<Record<number,Message[]>>({}); const [online,setOnline]=useState<Set<number>>(new Set()); const [typing,setTyping]=useState<Record<number,Set<number>>>({}); const [text,setText]=useState(''); const [newChat,setNewChat]=useState(false); const [admin,setAdmin]=useState(false); const [search,setSearch]=useState(''); const [uploading,setUploading]=useState(false);
  const typingTimer=useRef<number | undefined>(undefined); const bottomRef=useRef<HTMLDivElement>(null); const fileRef=useRef<HTMLInputElement>(null);
  const active=conversations.find(c=>c.id===activeId)||null;

  async function refresh(){ const [u,c]=await Promise.all([client.users(),client.conversations()]); setUsers(u); setConversations(c); if(!activeId&&c.length) setActiveId(c[0].id); }
  async function loadMessages(cid:number){ const list=await client.messages(cid); setMessages(m=>({...m,[cid]:list})); list.filter(x=>x.sender.id!==session.user.id).forEach(x=>client.receipt(x.id,'read')); setConversations(c=>c.map(x=>x.id===cid?{...x,unreadCount:0}:x)); }

  useEffect(()=>{ refresh().catch(()=>onLogout()); const socket=client.connect(); socket.on('presence:snapshot',(p:{userIds:number[]})=>setOnline(new Set(p.userIds))); socket.on('presence:update',(p:{userId:number;online:boolean})=>setOnline(s=>{const n=new Set(s);p.online?n.add(p.userId):n.delete(p.userId);return n;})); socket.on('typing:update',(p:{conversationId:number;userId:number;typing:boolean})=>setTyping(t=>{const n={...t}; const set=new Set(n[p.conversationId]||[]);p.typing?set.add(p.userId):set.delete(p.userId);n[p.conversationId]=set;return n;})); socket.on('message:new',(m:Message)=>{setMessages(all=>({...all,[m.conversationId]:[...(all[m.conversationId]||[]).filter(x=>x.id!==m.id),m]})); if(m.sender.id!==session.user.id){client.receipt(m.id,'delivered'); if(m.conversationId===activeId) client.receipt(m.id,'read');} refresh();}); return()=>client.disconnect();},[client]);
  useEffect(()=>{if(activeId)loadMessages(activeId);},[activeId]);
  useEffect(() => {
  bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [activeId, messages]);

  const filtered=conversations.filter(c=>conversationName(c).toLowerCase().includes(search.toLowerCase()));
  function conversationName(c:Conversation){ if(c.type==='group')return c.name||'Group'; return c.members.find(m=>m.id!==session.user.id)?.displayName||'Conversation'; }
  function conversationOnline(c:Conversation){return c.type==='direct'&&c.members.some(m=>m.id!==session.user.id&&online.has(m.id));}
  function typingNames(c:Conversation|null){ if(!c)return ''; const ids=[...(typing[c.id]||new Set())]; return ids.map(id=>users.find(u=>u.id===id)?.displayName).filter(Boolean).join(', '); }

  async function send(){const body=text.trim();if(!activeId||!body)return;setText('');client.typing(activeId,false);await client.send(activeId,body);}
  function onText(v:string){setText(v);if(!activeId)return;client.typing(activeId,true);window.clearTimeout(typingTimer.current);typingTimer.current=window.setTimeout(()=>client.typing(activeId,false),1200);}
  async function sendFile(file:File){if(!activeId)return;setUploading(true);try{const f=await client.upload(file);await client.send(activeId,undefined,f.id);}finally{setUploading(false);if(fileRef.current)fileRef.current.value='';}}
  async function direct(u:User){const {id}=await client.createDirect(u.id);await refresh();setActiveId(id);setNewChat(false);}
  async function group(name:string,ids:number[]){const {id}=await client.createGroup(name,ids);await refresh();setActiveId(id);setNewChat(false);}

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-top"><div className="me"><Avatar name={session.user.displayName} online/><div><strong>{session.user.displayName}</strong><small>HomeChat</small></div></div><div className="top-actions">{session.user.isAdmin&&<button title="Add user" onClick={()=>setAdmin(true)}>＋</button>}<button title="New chat" onClick={()=>setNewChat(true)}>✎</button><button title="Log out" onClick={onLogout}>↪</button></div></div>
      <div className="search"><input placeholder="Search conversations" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="conversation-list">{filtered.length?filtered.map(c=>{const lm=c.lastMessage;return <button key={c.id} className={'conversation '+(c.id===activeId?'active':'')} onClick={()=>setActiveId(c.id)}><Avatar name={conversationName(c)} online={conversationOnline(c)}/><div className="conv-main"><div className="conv-line"><strong>{conversationName(c)}</strong><time>{lm?fmtTime(lm.createdAt):''}</time></div><div className="conv-line"><span className="preview">{lm?.type==='image'?'📷 Photo':lm?.type==='file'?'📎 '+lm.file?.name:lm?.body||'No messages yet'}</span>{c.unreadCount>0&&<b className="badge">{c.unreadCount}</b>}</div></div></button>}):<div className="empty-side"><p>No conversations yet.</p><button className="secondary" onClick={()=>setNewChat(true)}>Start one</button></div>}</div>
    </aside>

    <main className="chat-panel" onDragOver={e=>{if(active)e.preventDefault()}} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files?.[0];if(f&&active)sendFile(f)}}>
      {!active?<div className="welcome"><div className="brand-mark big">H</div><h2>HomeChat</h2><p>Pick a conversation or start a new one.</p></div>:<>
        <header className="chat-head"><Avatar name={conversationName(active)} online={conversationOnline(active)}/><div><strong>{conversationName(active)}</strong><small>{typingNames(active)?`${typingNames(active)} typing…`:active.type==='group'?`${active.members.length} members`:conversationOnline(active)?'online':'offline'}</small></div></header>
        <section className="messages">{(messages[active.id]||[]).map(m=><div className={'message-row '+(m.sender.id===session.user.id?'mine':'theirs')} key={m.id}><div className="bubble">{active.type==='group'&&m.sender.id!==session.user.id&&<b className="sender-name">{m.sender.displayName}</b>}{m.body&&<div className="body">{m.body}</div>}<Attachment client={client} message={m}/><span className="stamp">{fmtTime(m.createdAt)}</span></div></div>)}<div ref={bottomRef}/></section>
        <footer className="composer"><input ref={fileRef} type="file" hidden onChange={e=>{const f=e.target.files?.[0];if(f)sendFile(f)}}/><button className="clip" onClick={()=>fileRef.current?.click()} disabled={uploading}>{uploading?'…':'＋'}</button><textarea rows={1} value={text} onChange={e=>onText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Type a message"/><button className="send" onClick={send} disabled={!text.trim()}>➤</button></footer>
      </>}
    </main>
    {newChat&&<NewChatModal users={users} current={session.user} onClose={()=>setNewChat(false)} onDirect={direct} onGroup={group}/>} 
    {admin&&<AdminModal client={client} onClose={()=>setAdmin(false)} onCreated={refresh}/>} 
  </div>;
}
