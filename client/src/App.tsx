import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HomeClient,
  type Conversation,
  type ConversationInventory,
  type FileView,
  type InventoryAttachment,
  type LinkPreview,
  type Message,
  type User,
} from './lib/homeClient';

const BASE_URL = window.location.origin;
const URL_RE = /https?:\/\/[^\s<>'"`]+/gi;

type Session = { token:string; user:User };
type Lightbox = { url:string; name:string } | null;
type InventoryTab = 'media'|'files'|'links';

function initials(name:string){ return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()).join('') || '?'; }
function fmtTime(ts:string){ const d=new Date(ts); return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
function fmtDateTime(ts:string){ const d=new Date(ts); return d.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function fmtBytes(bytes:number){ if(bytes<1024)return `${bytes} B`; if(bytes<1024*1024)return `${(bytes/1024).toFixed(bytes<10*1024?1:0)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB`; }
function avatarTone(name:string){ let h=0; for(const ch of name) h=(h*31+ch.charCodeAt(0))>>>0; return h%8; }
function fileGlyph(name:string,mime=''){ const ext=name.split('.').pop()?.toLowerCase(); if(mime.includes('pdf')||ext==='pdf')return 'PDF'; if(/zip|rar|7z|tar|gzip/.test(mime)||['zip','rar','7z','tar','gz'].includes(ext||''))return 'ZIP'; if(mime.startsWith('audio/'))return '♪'; if(mime.startsWith('video/'))return '▶'; if(/word|document/.test(mime)||['doc','docx','odt'].includes(ext||''))return 'DOC'; if(/sheet|excel/.test(mime)||['xls','xlsx','csv'].includes(ext||''))return 'XLS'; return 'FILE'; }
function extractUrls(text:string|null|undefined){ if(!text)return []; return [...text.matchAll(URL_RE)].map(m=>m[0].replace(/[),.;!?]+$/g,'')); }
function previewText(m:Message|null){ if(!m)return 'No messages yet'; if(m.file?.mimeType.startsWith('audio/'))return '🎤 Voice message'; if(m.file?.mimeType.startsWith('video/'))return '🎬 Video'; if(m.type==='image')return '📷 Photo'; if(m.type==='file')return `📎 ${m.file?.name||'File'}`; return m.body||'Message'; }

function Avatar({name,online=false,avatarUrl,size='normal',onClick}:{name:string;online?:boolean;avatarUrl?:string|null;size?:'normal'|'large';onClick?:()=>void}){
  const content=avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials(name)}</span>;
  const avatar=<div className={`avatar tone-${avatarTone(name)} ${size==='large'?'large':''}`}>{content}</div>;
  return <div className={`avatar-wrap ${onClick?'clickable':''}`} onClick={onClick} title={onClick?'Change profile picture':undefined}>{avatar}<span className={online?'presence on':'presence'} /></div>;
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

function useFileUrl(client:HomeClient,file?:FileView|null){
  const [url,setUrl]=useState('');
  useEffect(()=>{let alive=true;let object='';if(file){client.fileBlob(file.id).then(b=>{if(alive){object=URL.createObjectURL(b);setUrl(object);}}).catch(()=>{});}return()=>{alive=false;if(object)URL.revokeObjectURL(object);};},[client,file?.id]);
  return url;
}

function Attachment({client,message}:{client:HomeClient;message:Message}){
  const url=useFileUrl(client,message.file); const [lightbox,setLightbox]=useState<Lightbox>(null);
  if(!message.file) return null;
  if(message.file.mimeType.startsWith('audio/')) return <div className="attachment audio"><span className="voice-label">🎤 Voice message</span><audio controls preload="metadata" src={url}/></div>;
  if(message.file.mimeType.startsWith('video/')) return <div className="attachment video"><video controls preload="metadata" src={url}/><span>{message.file.name}</span></div>;
  if(message.type==='image') return <>
    <button className="attachment image" onClick={()=>url&&setLightbox({url,name:message.file!.name})} title="Open image">
      <img src={url} alt={message.file.name}/><span>{message.file.name}</span>
    </button>
    {lightbox&&<div className="lightbox" onMouseDown={()=>setLightbox(null)}><div className="lightbox-card" onMouseDown={e=>e.stopPropagation()}><div className="lightbox-head"><span>{lightbox.name}</span><a href={lightbox.url} download={lightbox.name}>Download</a><button onClick={()=>setLightbox(null)}>×</button></div><img src={lightbox.url} alt={lightbox.name}/></div></div>}
  </>;
  return <a className="attachment file" href={url} download={message.file.name}>
    <span className="file-glyph">{fileGlyph(message.file.name,message.file.mimeType)}</span>
    <span className="file-meta"><strong>{message.file.name}</strong><small>{fmtBytes(message.file.size)}</small></span>
    <span className="download-mark">↓</span>
  </a>;
}

function LinkPreviewCard({client,url,compact=false}:{client:HomeClient;url:string;compact?:boolean}){
  const [preview,setPreview]=useState<LinkPreview|null>(null);
  useEffect(()=>{let alive=true;client.linkPreview(url).then(x=>alive&&setPreview(x)).catch(()=>{});return()=>{alive=false};},[client,url]);
  if(!preview) return null;
  return <a className={`link-preview ${compact?'compact':''}`} href={preview.url} target="_blank" rel="noreferrer noopener">
    {preview.imageUrl&&<img src={preview.imageUrl} alt="" loading="lazy"/>}
    <span className="link-preview-copy"><small>{preview.siteName||preview.hostname}</small><strong>{preview.title||preview.hostname}</strong>{!compact&&preview.description&&<span>{preview.description}</span>}</span>
  </a>;
}

function MessageBody({client,body}:{client:HomeClient;body:string}){
  const urls=extractUrls(body); const pieces:React.ReactNode[]=[]; let last=0;
  const re=new RegExp(URL_RE.source,'gi'); let match:RegExpExecArray|null;
  while((match=re.exec(body))){const raw=match[0];const clean=raw.replace(/[),.;!?]+$/g,'');const trailing=raw.slice(clean.length);if(match.index>last)pieces.push(body.slice(last,match.index));pieces.push(<a key={`${match.index}-${clean}`} href={clean} target="_blank" rel="noreferrer noopener" className="message-link">{clean}</a>);if(trailing)pieces.push(trailing);last=match.index+raw.length;}
  if(last<body.length)pieces.push(body.slice(last));
  return <><div className="body">{pieces.length?pieces:body}</div>{urls[0]&&<LinkPreviewCard client={client} url={urls[0]}/>}</>;
}

function InventoryMediaItem({client,item}:{client:HomeClient;item:InventoryAttachment}){
  const url=useFileUrl(client,item.file);
  if(item.file.mimeType.startsWith('image/'))return <a className="inventory-media image" href={url} target="_blank" rel="noreferrer"><img src={url} alt={item.file.name}/><small>{item.file.name}</small></a>;
  if(item.file.mimeType.startsWith('video/'))return <div className="inventory-media"><video src={url} controls preload="metadata"/><small>{item.file.name}</small></div>;
  return <div className="inventory-media audio"><audio src={url} controls preload="metadata"/><small>{item.file.name}</small></div>;
}

function InventoryFileItem({client,item}:{client:HomeClient;item:InventoryAttachment}){
  const url=useFileUrl(client,item.file);
  return <a className="inventory-file" href={url} download={item.file.name}><span className="file-glyph">{fileGlyph(item.file.name,item.file.mimeType)}</span><span><strong>{item.file.name}</strong><small>{fmtBytes(item.file.size)} · {fmtDateTime(item.createdAt)}</small></span><b>↓</b></a>;
}

function InventoryDrawer({client,conversation,title,onClose}:{client:HomeClient;conversation:Conversation;title:string;onClose:()=>void}){
  const [tab,setTab]=useState<InventoryTab>('media'); const [inventory,setInventory]=useState<ConversationInventory|null>(null); const [loading,setLoading]=useState(true);
  useEffect(()=>{let alive=true;setLoading(true);client.inventory(conversation.id).then(x=>{if(alive){setInventory(x);setLoading(false);}}).catch(()=>alive&&setLoading(false));return()=>{alive=false};},[client,conversation.id]);
  return <aside className="inventory-drawer">
    <div className="inventory-head"><div><strong>{title}</strong><small>Shared content</small></div><button onClick={onClose}>×</button></div>
    <div className="inventory-tabs"><button className={tab==='media'?'active':''} onClick={()=>setTab('media')}>Media <b>{inventory?.media.length||0}</b></button><button className={tab==='files'?'active':''} onClick={()=>setTab('files')}>Files <b>{inventory?.files.length||0}</b></button><button className={tab==='links'?'active':''} onClick={()=>setTab('links')}>Links <b>{inventory?.links.length||0}</b></button></div>
    <div className="inventory-body">{loading?<div className="inventory-empty">Loading…</div>:tab==='media'?<div className="media-grid">{inventory?.media.length?inventory.media.map(x=><InventoryMediaItem key={`${x.messageId}-${x.file.id}`} client={client} item={x}/>):<div className="inventory-empty">No shared media yet.</div>}</div>:tab==='files'?<div className="inventory-files">{inventory?.files.length?inventory.files.map(x=><InventoryFileItem key={`${x.messageId}-${x.file.id}`} client={client} item={x}/>):<div className="inventory-empty">No shared files yet.</div>}</div>:<div className="inventory-links">{inventory?.links.length?inventory.links.map((x,i)=><div className="inventory-link" key={`${x.messageId}-${i}`}><LinkPreviewCard client={client} url={x.url}/><a href={x.url} target="_blank" rel="noreferrer noopener">{x.url}</a><small>{x.sender.displayName} · {fmtDateTime(x.createdAt)}</small></div>):<div className="inventory-empty">No shared links yet.</div>}</div>}</div>
  </aside>;
}

function NewChatModal({users,current,onClose,onDirect,onGroup,onSaved}:{users:User[];current:User;onClose:()=>void;onDirect:(u:User)=>void;onGroup:(name:string,ids:number[])=>void;onSaved:()=>void}){
  const others=users.filter(u=>u.id!==current.id); const [group,setGroup]=useState(false); const [name,setName]=useState(''); const [selected,setSelected]=useState<number[]>([]);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-head"><h3>{group?'New group':'New conversation'}</h3><button onClick={onClose}>×</button></div>
    {!group ? <>
      <button className="user-row saved-row" onClick={onSaved}><div className="saved-icon">★</div><span><strong>Saved Messages</strong><small>Notes, files and messages to yourself</small></span></button>
      <div className="user-list">{others.map(u=><button className="user-row" key={u.id} onClick={()=>onDirect(u)}><Avatar name={u.displayName} avatarUrl={u.avatarUrl}/><span><strong>{u.displayName}</strong><small>HID {u.hid} · @{u.username}</small></span></button>)}</div>
      <button className="secondary full" onClick={()=>setGroup(true)}>Create group chat</button>
    </> : <>
      <label className="field">Group name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Family"/></label>
      <div className="user-list">{others.map(u=><label className="check-row" key={u.id}><input type="checkbox" checked={selected.includes(u.id)} onChange={()=>setSelected(s=>s.includes(u.id)?s.filter(x=>x!==u.id):[...s,u.id])}/><Avatar name={u.displayName} avatarUrl={u.avatarUrl}/><span>{u.displayName}</span></label>)}</div>
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
  function saveSession(next:Session){localStorage.setItem('homechat.session',JSON.stringify(next));setSession(next);}
  if(!session) return <Login onLogin={saveSession}/>;
  return <Messenger session={session} onSessionChange={saveSession} onLogout={()=>{localStorage.removeItem('homechat.session');setSession(null)}}/>;
}

function Messenger({session,onSessionChange,onLogout}:{session:Session;onSessionChange:(s:Session)=>void;onLogout:()=>void}){
  const client=useMemo(()=>new HomeClient(BASE_URL,session.token),[session.token]);
  const [me,setMe]=useState(session.user); const [users,setUsers]=useState<User[]>([]); const [conversations,setConversations]=useState<Conversation[]>([]); const [activeId,setActiveId]=useState<number|null>(null); const [messages,setMessages]=useState<Record<number,Message[]>>({}); const [online,setOnline]=useState<Set<number>>(new Set()); const [typing,setTyping]=useState<Record<number,Set<number>>>({}); const [text,setText]=useState(''); const [newChat,setNewChat]=useState(false); const [admin,setAdmin]=useState(false); const [search,setSearch]=useState(''); const [uploading,setUploading]=useState(false); const [pendingFile,setPendingFile]=useState<File|null>(null); const [pendingUrl,setPendingUrl]=useState<string>(''); const [notificationPermission,setNotificationPermission]=useState<NotificationPermission>(()=>typeof Notification==='undefined'?'denied':Notification.permission); const [inventoryOpen,setInventoryOpen]=useState(false); const [recording,setRecording]=useState(false); const [recordingSeconds,setRecordingSeconds]=useState(0);
  const typingTimer=useRef<number | undefined>(undefined); const bottomRef=useRef<HTMLDivElement>(null); const fileRef=useRef<HTMLInputElement>(null); const avatarRef=useRef<HTMLInputElement>(null); const activeIdRef=useRef<number|null>(null); const conversationsRef=useRef<Conversation[]>([]); const audioRef=useRef<AudioContext|null>(null); const recorderRef=useRef<MediaRecorder|null>(null); const recordStreamRef=useRef<MediaStream|null>(null); const recordChunksRef=useRef<Blob[]>([]); const recordTimerRef=useRef<number|undefined>(undefined);
  const active=conversations.find(c=>c.id===activeId)||null;

  useEffect(()=>{activeIdRef.current=activeId;setInventoryOpen(false);},[activeId]);
  useEffect(()=>{conversationsRef.current=conversations; const unread=conversations.reduce((n,c)=>n+c.unreadCount,0); document.title=unread?`(${unread}) HomeChat`:'HomeChat';},[conversations]);
  useEffect(()=>()=>{document.title='HomeChat';},[]);
  useEffect(()=>{if(!pendingFile){if(pendingUrl)URL.revokeObjectURL(pendingUrl);setPendingUrl('');return;} const url=URL.createObjectURL(pendingFile);setPendingUrl(url);return()=>URL.revokeObjectURL(url);},[pendingFile]);
  useEffect(()=>()=>{window.clearInterval(recordTimerRef.current);recordStreamRef.current?.getTracks().forEach(t=>t.stop());},[]);

  async function refresh(){
    const [freshMe,u,c]=await Promise.all([client.me(),client.users(),client.conversations()]);
    setMe(freshMe); setUsers(u); setConversations(c);
    if(freshMe.hid!==session.user.hid){const next={token:session.token,user:freshMe};onSessionChange(next);}
    if(!activeIdRef.current&&c.length) setActiveId(c[0].id);
  }
  async function loadMessages(cid:number){ const list=await client.messages(cid); setMessages(m=>({...m,[cid]:list})); list.filter(x=>x.sender.id!==me.id).forEach(x=>client.receipt(x.id,'read')); setConversations(c=>c.map(x=>x.id===cid?{...x,unreadCount:0}:x)); }

  function conversationName(c:Conversation){ if(c.isSelf)return 'Saved Messages'; if(c.type==='group')return c.name||'Group'; return c.members.find(m=>m.id!==me.id)?.displayName||'Conversation'; }
  function conversationAvatar(c:Conversation){ if(c.isSelf)return me.avatarUrl; if(c.type==='group')return c.avatarUrl; return c.members.find(m=>m.id!==me.id)?.avatarUrl||null; }
  function conversationOnline(c:Conversation){return !c.isSelf&&c.type==='direct'&&c.members.some(m=>m.id!==me.id&&online.has(m.id));}
  function conversationSubline(c:Conversation){if(c.isSelf)return `HID ${me.hid}`;if(c.type==='group')return `${c.members.length} members`;const other=c.members.find(m=>m.id!==me.id);return `${conversationOnline(c)?'online':'offline'}${other?.hid?` · HID ${other.hid}`:''}`;}
  function typingNames(c:Conversation|null){ if(!c)return ''; const ids=[...(typing[c.id]||new Set())]; return ids.map(id=>users.find(u=>u.id===id)?.displayName).filter(Boolean).join(', '); }

  function beep(){
    try{const Ctx=window.AudioContext || (window as any).webkitAudioContext;if(!Ctx)return;const ctx=audioRef.current??new Ctx();audioRef.current=ctx;if(ctx.state==='suspended')void ctx.resume();const osc=ctx.createOscillator();const gain=ctx.createGain();osc.frequency.value=680;gain.gain.setValueAtTime(.045,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.16);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.17);}catch{}
  }
  async function enableNotifications(){beep();if(typeof Notification==='undefined')return;const p=await Notification.requestPermission();setNotificationPermission(p);}
  function notifyIncoming(m:Message){const c=conversationsRef.current.find(x=>x.id===m.conversationId);const isVisible=!document.hidden&&activeIdRef.current===m.conversationId;if(isVisible)return;beep();if(typeof Notification!=='undefined'&&Notification.permission==='granted'){const title=c?conversationName(c):m.sender.displayName;const body=previewText(m);const n=new Notification(title,{body,tag:`homechat-${m.conversationId}`});n.onclick=()=>{window.focus();setActiveId(m.conversationId);n.close();};}}

  useEffect(()=>{
    refresh().catch(()=>onLogout()); const socket=client.connect();
    socket.on('presence:snapshot',(p:{userIds:number[]})=>setOnline(new Set(p.userIds)));
    socket.on('presence:update',(p:{userId:number;online:boolean})=>setOnline(s=>{const n=new Set(s);p.online?n.add(p.userId):n.delete(p.userId);return n;}));
    socket.on('typing:update',(p:{conversationId:number;userId:number;typing:boolean})=>setTyping(t=>{const n={...t};const set=new Set(n[p.conversationId]||[]);p.typing?set.add(p.userId):set.delete(p.userId);n[p.conversationId]=set;return n;}));
    socket.on('message:new',(m:Message)=>{setMessages(all=>({...all,[m.conversationId]:[...(all[m.conversationId]||[]).filter(x=>x.id!==m.id),m]}));if(m.sender.id!==me.id){client.receipt(m.id,'delivered');if(m.conversationId===activeIdRef.current&&!document.hidden)client.receipt(m.id,'read');notifyIncoming(m);}refresh();});
    return()=>client.disconnect();
  },[client]);
  useEffect(()=>{if(activeId){loadMessages(activeId);setPendingFile(null);}},[activeId]);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'});},[activeId,messages]);
  useEffect(()=>{function visible(){if(!document.hidden&&activeIdRef.current){const cid=activeIdRef.current;const list=messages[cid]||[];list.filter(x=>x.sender.id!==me.id).forEach(x=>client.receipt(x.id,'read'));setConversations(c=>c.map(x=>x.id===cid?{...x,unreadCount:0}:x));}}document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[client,messages,me.id]);

  const filtered=conversations.filter(c=>conversationName(c).toLowerCase().includes(search.toLowerCase()));

  function queueFile(file:File){if(file.size>100*1024*1024){alert('File is larger than 100 MB.');return;}setPendingFile(file);}
  async function send(){const body=text.trim();if(!activeId||(!body&&!pendingFile)||uploading)return;setUploading(true);try{let fileId:number|undefined;if(pendingFile){const uploaded=await client.upload(pendingFile);fileId=uploaded.id;}await client.send(activeId,body||undefined,fileId);setText('');setPendingFile(null);client.typing(activeId,false);}finally{setUploading(false);if(fileRef.current)fileRef.current.value='';}}
  function onText(v:string){setText(v);if(!activeId)return;client.typing(activeId,true);window.clearTimeout(typingTimer.current);typingTimer.current=window.setTimeout(()=>client.typing(activeId,false),1200);}
  function onPaste(e:React.ClipboardEvent<HTMLTextAreaElement>){const item=[...e.clipboardData.items].find(x=>x.type.startsWith('image/'));if(!item)return;const blob=item.getAsFile();if(!blob)return;e.preventDefault();const ext=blob.type.split('/')[1]?.replace('jpeg','jpg')||'png';queueFile(new File([blob],`clipboard-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`,{type:blob.type}));}
  async function direct(u:User){const {id}=await client.createDirect(u.id);await refresh();setActiveId(id);setNewChat(false);}
  async function saved(){const {id}=await client.savedMessages();await refresh();setActiveId(id);setNewChat(false);}
  async function group(name:string,ids:number[]){const {id}=await client.createGroup(name,ids);await refresh();setActiveId(id);setNewChat(false);}
  async function changeAvatar(file:File){if(!file.type.startsWith('image/'))return;try{const user=await client.uploadAvatar(file);setMe(user);const next={token:session.token,user};onSessionChange(next);await refresh();}finally{if(avatarRef.current)avatarRef.current.value='';}}

  async function startRecording(){
    if(recording)return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){alert('Voice recording needs HTTPS (or localhost) in modern browsers. Audio files can still be attached normally.');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});recordStreamRef.current=stream;recordChunksRef.current=[];
      const preferred=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined);recorderRef.current=recorder;
      recorder.ondataavailable=e=>{if(e.data.size)recordChunksRef.current.push(e.data);};
      recorder.onstop=()=>{const type=recorder.mimeType||'audio/webm';const blob=new Blob(recordChunksRef.current,{type});const ext=type.includes('ogg')?'ogg':type.includes('mp4')?'m4a':'webm';queueFile(new File([blob],`voice-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`,{type}));recordStreamRef.current?.getTracks().forEach(t=>t.stop());recordStreamRef.current=null;recordChunksRef.current=[];};
      recorder.start(250);setRecording(true);setRecordingSeconds(0);window.clearInterval(recordTimerRef.current);recordTimerRef.current=window.setInterval(()=>setRecordingSeconds(x=>x+1),1000);
    }catch{alert('Microphone permission was not granted.');}
  }
  function stopRecording(){const r=recorderRef.current;if(!r||r.state==='inactive')return;r.stop();setRecording(false);window.clearInterval(recordTimerRef.current);recordTimerRef.current=undefined;}

  return <div className="app-shell" onClick={()=>{if(audioRef.current?.state==='suspended')void audioRef.current.resume();}}>
    <aside className="sidebar">
      <div className="sidebar-top"><div className="me"><input ref={avatarRef} hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)changeAvatar(f)}}/><Avatar name={me.displayName} avatarUrl={me.avatarUrl} online onClick={()=>avatarRef.current?.click()}/><div><strong>{me.displayName}</strong><small>HID {me.hid||'—'}</small></div></div><div className="top-actions"><button title={notificationPermission==='granted'?'Notifications enabled':'Enable notifications'} className={notificationPermission==='granted'?'enabled':''} onClick={enableNotifications}>{notificationPermission==='granted'?'🔔':'🔕'}</button>{me.isAdmin&&<button title="Add user" onClick={()=>setAdmin(true)}>＋</button>}<button title="New chat" onClick={()=>setNewChat(true)}>✎</button><button title="Log out" onClick={onLogout}>↪</button></div></div>
      <div className="search"><input placeholder="Search conversations" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="conversation-list">{filtered.length?filtered.map(c=>{const lm=c.lastMessage;return <button key={c.id} className={'conversation '+(c.id===activeId?'active':'')} onClick={()=>setActiveId(c.id)}><Avatar name={conversationName(c)} avatarUrl={conversationAvatar(c)} online={c.isSelf?false:conversationOnline(c)}/><div className="conv-main"><div className="conv-line"><strong>{c.isSelf?'★ ':''}{conversationName(c)}</strong><time>{lm?fmtTime(lm.createdAt):''}</time></div><div className="conv-line"><span className="preview">{previewText(lm)}</span>{c.unreadCount>0&&<b className="badge">{c.unreadCount}</b>}</div></div></button>}):<div className="empty-side"><p>No conversations yet.</p><button className="secondary" onClick={()=>setNewChat(true)}>Start one</button></div>}</div>
    </aside>

    <main className="chat-panel" onDragOver={e=>{if(active)e.preventDefault()}} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files?.[0];if(f&&active)queueFile(f)}}>
      {!active?<div className="welcome"><div className="brand-mark big">H</div><h2>HomeChat</h2><p>Pick a conversation or start a new one.</p></div>:<>
        <header className="chat-head"><Avatar name={conversationName(active)} avatarUrl={conversationAvatar(active)} online={conversationOnline(active)}/><div className="chat-head-copy"><strong>{conversationName(active)}</strong><small>{typingNames(active)?`${typingNames(active)} typing…`:conversationSubline(active)}</small></div><button className="info-button" title="Shared media, files and links" onClick={()=>setInventoryOpen(x=>!x)}>ⓘ</button></header>
        <section className="messages">{(messages[active.id]||[]).map(m=><div className={'message-row '+(m.sender.id===me.id?'mine':'theirs')} key={m.id}><div className="bubble">{active.type==='group'&&m.sender.id!==me.id&&<b className="sender-name">{m.sender.displayName}</b>}{m.body&&<MessageBody client={client} body={m.body}/>}<Attachment client={client} message={m}/><span className="stamp">{fmtTime(m.createdAt)}</span></div></div>)}<div ref={bottomRef}/></section>
        <footer className="composer-wrap">
          {recording&&<div className="recording-strip"><span className="record-dot"/><strong>Recording voice</strong><span>{Math.floor(recordingSeconds/60)}:{String(recordingSeconds%60).padStart(2,'0')}</span><button onClick={stopRecording}>Stop</button></div>}
          {pendingFile&&<div className="pending-file">{pendingFile.type.startsWith('image/')&&pendingUrl?<img src={pendingUrl} alt="Preview"/>:pendingFile.type.startsWith('audio/')&&pendingUrl?<audio src={pendingUrl} controls/>:<span className="file-glyph">{fileGlyph(pendingFile.name,pendingFile.type)}</span>}<div><strong>{pendingFile.type.startsWith('audio/')?'Voice message':pendingFile.name}</strong><small>{fmtBytes(pendingFile.size)} · ready to send</small></div><button title="Remove attachment" onClick={()=>setPendingFile(null)}>×</button></div>}
          <div className="composer"><input ref={fileRef} type="file" hidden onChange={e=>{const f=e.target.files?.[0];if(f)queueFile(f)}}/><button className="clip" onClick={()=>fileRef.current?.click()} disabled={uploading||recording}>＋</button><textarea rows={1} value={text} onPaste={onPaste} onChange={e=>onText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Type a message or paste an image"/><button className={`mic ${recording?'recording':''}`} title={recording?'Stop recording':'Record voice message'} onClick={recording?stopRecording:startRecording} disabled={uploading}>{recording?'■':'🎤'}</button><button className="send" onClick={send} disabled={uploading||recording||(!text.trim()&&!pendingFile)}>{uploading?'…':'➤'}</button></div>
        </footer>
      </>}
    </main>
    {active&&inventoryOpen&&<InventoryDrawer client={client} conversation={active} title={conversationName(active)} onClose={()=>setInventoryOpen(false)}/>} 
    {newChat&&<NewChatModal users={users} current={me} onClose={()=>setNewChat(false)} onDirect={direct} onGroup={group} onSaved={saved}/>} 
    {admin&&<AdminModal client={client} onClose={()=>setAdmin(false)} onCreated={refresh}/>} 
  </div>;
}
