import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HomeClient,
  type Conversation,
  type ContactRequests,
  type ConversationInventory,
  type DirectoryUser,
  type FileView,
  type InventoryAttachment,
  type LinkPreview,
  type Message,
  type MessageSearchResult,
  type User,
} from './lib/homeClient';

const BASE_URL = window.location.origin;
const URL_RE = /https?:\/\/[^\s<>'"`]+/gi;

type Session = { token:string; user:User };
type Lightbox = { url:string; name:string } | null;
type InventoryTab = 'media'|'files'|'links';
type UiMessage = Message & { sendState?:'sending'|'failed'; temp?:boolean; localFileUrl?:string; retry?:{body?:string;fileId?:number;clientNonce:string;file?:File;replyToId?:number} };
const fileUrlCache=new Map<string,string>();
const fileUrlPending=new Map<string,Promise<string>>();

function initials(name:string){ return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()).join('') || '?'; }
function fmtTime(ts:string){ const d=new Date(ts); return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
function fmtDateTime(ts:string){ const d=new Date(ts); return d.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function fmtBytes(bytes:number){ if(bytes<1024)return `${bytes} B`; if(bytes<1024*1024)return `${(bytes/1024).toFixed(bytes<10*1024?1:0)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB`; }
function avatarTone(name:string){ let h=0; for(const ch of name) h=(h*31+ch.charCodeAt(0))>>>0; return h%8; }
function fileGlyph(name:string,mime=''){ const ext=name.split('.').pop()?.toLowerCase(); if(mime.includes('pdf')||ext==='pdf')return 'PDF'; if(/zip|rar|7z|tar|gzip/.test(mime)||['zip','rar','7z','tar','gz'].includes(ext||''))return 'ZIP'; if(mime.startsWith('audio/'))return '♪'; if(mime.startsWith('video/'))return '▶'; if(/word|document/.test(mime)||['doc','docx','odt'].includes(ext||''))return 'DOC'; if(/sheet|excel/.test(mime)||['xls','xlsx','csv'].includes(ext||''))return 'XLS'; return 'FILE'; }
function extractUrls(text:string|null|undefined){ if(!text)return []; return [...text.matchAll(URL_RE)].map(m=>m[0].replace(/[),.;!?]+$/g,'')); }
function previewText(m:Message|null){ if(!m)return 'No messages yet'; if(m.deletedAt)return 'Message deleted'; if(m.file?.mimeType.startsWith('audio/'))return '🎤 Voice message'; if(m.file?.mimeType.startsWith('video/'))return '🎬 Video'; if(m.type==='image')return '📷 Photo'; if(m.type==='file')return `📎 ${m.file?.name||'File'}`; return m.body||'Message'; }

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
  const key=file?`${client.baseUrl}:${file.id}`:'';
  const [url,setUrl]=useState(()=>key?fileUrlCache.get(key)||'':'');
  useEffect(()=>{let alive=true;if(!file||file.id<=0){setUrl('');return;}const cached=fileUrlCache.get(key);if(cached){setUrl(cached);return;}let pending=fileUrlPending.get(key);if(!pending){pending=client.fileBlob(file.id).then(b=>{const object=URL.createObjectURL(b);fileUrlCache.set(key,object);fileUrlPending.delete(key);return object;}).catch(e=>{fileUrlPending.delete(key);throw e;});fileUrlPending.set(key,pending);}pending.then(x=>alive&&setUrl(x)).catch(()=>{});return()=>{alive=false};},[client,key,file?.id]);
  return url;
}

function Attachment({client,message}:{client:HomeClient;message:UiMessage}){
  const fetched=useFileUrl(client,message.file); const url=message.localFileUrl||fetched; const [lightbox,setLightbox]=useState<Lightbox>(null);
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

function MessageBody({client,body,me}:{client:HomeClient;body:string;me:User}){
  const urls=extractUrls(body); const pieces:React.ReactNode[]=[]; let last=0;
  const tokenRe=/(https?:\/\/[^\s<>'"`]+)|(@[A-Za-z0-9_.-]+)/gi; let match:RegExpExecArray|null;
  while((match=tokenRe.exec(body))){const raw=match[0];if(match.index>last)pieces.push(body.slice(last,match.index));if(raw.startsWith('@')){const mine=raw.slice(1).toLowerCase()===me.username.toLowerCase();pieces.push(<span key={`${match.index}-${raw}`} className={`mention ${mine?'mine':''}`}>{raw}</span>);}else{const clean=raw.replace(/[),.;!?]+$/g,'');const trailing=raw.slice(clean.length);pieces.push(<a key={`${match.index}-${clean}`} href={clean} target="_blank" rel="noreferrer noopener" className="message-link">{clean}</a>);if(trailing)pieces.push(trailing);}last=match.index+raw.length;}
  if(last<body.length)pieces.push(body.slice(last));
  return <><div className="body">{pieces.length?pieces:body}</div>{urls[0]&&<LinkPreviewCard client={client} url={urls[0]}/>}</>;
}

function ReplyQuote({message}:{message:UiMessage}){
  const r=message.replyTo;if(!r)return null;
  const text=r.deletedAt?'Message deleted':r.body||(r.file?`📎 ${r.file.name}`:'Message');
  return <div className="reply-quote"><strong>{r.sender.displayName}</strong><span>{text}</span></div>;
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

function ContextDrawer({client,conversation,me,users,online,view,target,onView,onClose,onCopy,onChangeAvatar,onRenameGroup,onAddMember,onRemoveMember,onLeaveGroup}:{client:HomeClient;conversation:Conversation|null;me:User;users:User[];online:Set<number>;view:'details'|'media'|'files'|'links';target:'me'|'conversation';onView:(v:'details'|'media'|'files'|'links')=>void;onClose:()=>void;onCopy:(text:string,label:string)=>void;onChangeAvatar:()=>void;onRenameGroup:(name:string)=>Promise<void>;onAddMember:(userId:number)=>Promise<void>;onRemoveMember:(userId:number)=>Promise<void>;onLeaveGroup:()=>Promise<void>}){
  const [inventory,setInventory]=useState<ConversationInventory|null>(null); const [loading,setLoading]=useState(false); const [groupName,setGroupName]=useState(conversation?.name||''); const [addUserId,setAddUserId]=useState('');
  useEffect(()=>{setGroupName(conversation?.name||'');setAddUserId('');},[conversation?.id,conversation?.name]);
  useEffect(()=>{if(!conversation)return;let alive=true;setLoading(true);client.inventory(conversation.id).then(x=>{if(alive){setInventory(x);setLoading(false);}}).catch(()=>alive&&setLoading(false));return()=>{alive=false};},[client,conversation?.id]);
  const isMe=target==='me'||Boolean(conversation?.isSelf);
  const person=isMe?me:conversation?.type==='direct'?conversation.members.find(m=>m.id!==me.id)||me:null;
  const available=conversation?.type==='group'?users.filter(u=>!conversation.members.some(m=>m.id===u.id)):[];
  const title=isMe?'My Details':conversation?.type==='group'?(conversation.name||'Group'):(person?.displayName||'Details');
  async function rename(){const name=groupName.trim();if(!name||name===conversation?.name)return;await onRenameGroup(name);}
  async function add(){const id=Number(addUserId);if(!id)return;await onAddMember(id);setAddUserId('');}
  return <aside className="inventory-drawer context-drawer" onMouseDown={e=>e.stopPropagation()}>
    <div className="inventory-head"><div><strong>{title}</strong><small>{target==='me'?'Your HomeChat profile':conversation?.type==='group'?'Group details':'Contact details'}</small></div><button onClick={onClose}>×</button></div>
    {conversation&&target==='conversation'&&<div className="inventory-tabs context-tabs"><button className={view==='details'?'active':''} onClick={()=>onView('details')}>Details</button><button className={view==='media'?'active':''} onClick={()=>onView('media')}>Media <b>{inventory?.media.length||0}</b></button><button className={view==='files'?'active':''} onClick={()=>onView('files')}>Files <b>{inventory?.files.length||0}</b></button><button className={view==='links'?'active':''} onClick={()=>onView('links')}>Links <b>{inventory?.links.length||0}</b></button></div>}
    <div className="inventory-body context-body">{view==='details'?<>
      {conversation?.type==='group'&&target==='conversation'?<div className="details-stack">
        <div className="details-hero"><Avatar name={conversation.name||'Group'} avatarUrl={conversation.avatarUrl} size="large"/><div><h3>{conversation.name||'Group'}</h3><p>{conversation.members.length} members</p></div></div>
        <section className="details-section"><h4>Group name</h4><div className="inline-edit"><input value={groupName} onChange={e=>setGroupName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void rename();}}/><button className="secondary" disabled={!groupName.trim()||groupName.trim()===conversation.name} onClick={()=>void rename()}>Save</button></div></section>
        <section className="details-section"><h4>Members</h4><div className="member-list">{conversation.members.map(u=><div className="member-row" key={u.id}><Avatar name={u.displayName} avatarUrl={u.avatarUrl} online={online.has(u.id)}/><div><strong>{u.displayName}{u.id===me.id?' (you)':''}</strong><small>@{u.username}{u.isAdmin?' · Admin':''}</small></div>{u.id!==me.id&&<button title="Remove member" onClick={()=>void onRemoveMember(u.id)}>Remove</button>}</div>)}</div></section>
        {available.length>0&&<section className="details-section"><h4>Add member</h4><div className="inline-edit"><select value={addUserId} onChange={e=>setAddUserId(e.target.value)}><option value="">Choose a user…</option>{available.map(u=><option key={u.id} value={u.id}>{u.displayName} (@{u.username})</option>)}</select><button className="secondary" disabled={!addUserId} onClick={()=>void add()}>Add</button></div></section>}
        <section className="details-section danger-zone"><button className="danger-button" onClick={()=>void onLeaveGroup()}>Leave group</button></section>
      </div>:person?<div className="details-stack">
        <div className="details-hero"><Avatar name={person.displayName} avatarUrl={person.avatarUrl} online={isMe||online.has(person.id)} size="large"/><div><h3>{person.displayName}</h3><p>{isMe?'Your account':online.has(person.id)?'Online':'Offline'}</p></div></div>
        <section className="details-section"><div className="detail-line"><span>Username</span><strong>@{person.username}</strong><button onClick={()=>onCopy(person.username,'Username')}>Copy</button></div><div className="detail-line hid-line"><span>HID</span><strong>{person.hid}</strong><button onClick={()=>onCopy(person.hid,'HID')}>Copy</button></div>{person.isAdmin&&<div className="detail-line"><span>Role</span><strong>Administrator</strong></div>}</section>
        {isMe&&<section className="details-section"><button className="secondary full" onClick={onChangeAvatar}>Change profile picture</button></section>}
      </div>:<div className="inventory-empty">No details available.</div>}
    </>:loading?<div className="inventory-empty">Loading…</div>:view==='media'?<div className="media-grid">{inventory?.media.length?inventory.media.map(x=><InventoryMediaItem key={`${x.messageId}-${x.file.id}`} client={client} item={x}/>):<div className="inventory-empty">No shared media yet.</div>}</div>:view==='files'?<div className="inventory-files">{inventory?.files.length?inventory.files.map(x=><InventoryFileItem key={`${x.messageId}-${x.file.id}`} client={client} item={x}/>):<div className="inventory-empty">No shared files yet.</div>}</div>:<div className="inventory-links">{inventory?.links.length?inventory.links.map((x,i)=><div className="inventory-link" key={`${x.messageId}-${i}`}><LinkPreviewCard client={client} url={x.url} compact/><a href={x.url} target="_blank" rel="noreferrer noopener">{x.url}</a><small>{x.sender.displayName} · {fmtDateTime(x.createdAt)}</small></div>):<div className="inventory-empty">No shared links yet.</div>}</div>}</div>
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

function ContactsModal({client,me,online,onClose,onDirect,onChanged}:{client:HomeClient;me:User;online:Set<number>;onClose:()=>void;onDirect:(u:User)=>void;onChanged:()=>void}){
  const [contacts,setContacts]=useState<User[]>([]);const [blocked,setBlocked]=useState<User[]>([]);const [requests,setRequests]=useState<ContactRequests>({incoming:[],outgoing:[]});const [directory,setDirectory]=useState<DirectoryUser[]>([]);const [q,setQ]=useState('');const [busy,setBusy]=useState(false);
  async function reload(search=q){const [c,b,r,d]=await Promise.all([client.contacts(),client.blocked(),client.contactRequests(),client.directory(search)]);setContacts(c);setBlocked(b);setRequests(r);setDirectory(d);}
  useEffect(()=>{void reload('');},[]);
  useEffect(()=>{const id=window.setTimeout(()=>void client.directory(q).then(setDirectory).catch(()=>{}),220);return()=>window.clearTimeout(id);},[q]);
  async function action(fn:()=>Promise<unknown>){setBusy(true);try{await fn();await reload();onChanged();}finally{setBusy(false);}}
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal contacts-modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-head"><h3>Contacts</h3><button onClick={onClose}>×</button></div>
    {requests.incoming.length>0&&<section className="contact-section"><h4>Requests</h4>{requests.incoming.map(r=><div className="contact-row" key={r.id}><Avatar name={r.sender.displayName} avatarUrl={r.sender.avatarUrl} online={online.has(r.sender.id)}/><div><strong>{r.sender.displayName}</strong><small>@{r.sender.username} · {r.sender.hid}</small></div><button disabled={busy} onClick={()=>void action(()=>client.acceptContactRequest(r.id))}>Accept</button><button disabled={busy} onClick={()=>void action(()=>client.declineContactRequest(r.id))}>Decline</button></div>)}</section>}
    <section className="contact-section"><h4>My contacts</h4>{contacts.length?contacts.map(u=><div className="contact-row" key={u.id}><Avatar name={u.displayName} avatarUrl={u.avatarUrl} online={online.has(u.id)}/><div><strong>{u.displayName}</strong><small>@{u.username} · {u.hid}</small></div><button onClick={()=>onDirect(u)}>Message</button><button className="quiet-danger" disabled={busy} onClick={()=>void action(()=>client.removeContact(u.id))}>Remove</button></div>):<div className="inventory-empty">No contacts yet.</div>}</section>
    {blocked.length>0&&<section className="contact-section"><h4>Blocked</h4>{blocked.map(u=><div className="contact-row" key={u.id}><Avatar name={u.displayName} avatarUrl={u.avatarUrl}/><div><strong>{u.displayName}</strong><small>@{u.username} · {u.hid}</small></div><button disabled={busy} onClick={()=>void action(()=>client.unblock(u.id))}>Unblock</button></div>)}</section>}
    <section className="contact-section"><h4>User directory</h4><input className="directory-search" placeholder="Search name, username or HID" value={q} onChange={e=>setQ(e.target.value)}/><div className="directory-list">{directory.filter(u=>u.id!==me.id).map(u=><div className="contact-row" key={u.id}><Avatar name={u.displayName} avatarUrl={u.avatarUrl} online={online.has(u.id)}/><div><strong>{u.displayName}</strong><small>@{u.username} · {u.hid}</small></div>{u.relationship==='blocked'?<button disabled={busy} onClick={()=>void action(()=>client.unblock(u.id))}>Unblock</button>:u.relationship==='contact'?<><button onClick={()=>onDirect(u)}>Message</button><button className="quiet-danger" disabled={busy} onClick={()=>void action(()=>client.block(u.id))}>Block</button></>:u.relationship==='outgoing'?<><span className="relationship-label">Requested</span><button className="quiet-danger" disabled={busy} onClick={()=>void action(()=>client.block(u.id))}>Block</button></>:u.relationship==='incoming'?<><span className="relationship-label">Request waiting</span><button className="quiet-danger" disabled={busy} onClick={()=>void action(()=>client.block(u.id))}>Block</button></>:<><button disabled={busy} onClick={()=>void action(()=>client.requestContact(u.id))}>Add</button><button className="quiet-danger" disabled={busy} onClick={()=>void action(()=>client.block(u.id))}>Block</button></>}</div>)}</div></section>
  </div></div>;
}

function CommandPalette({client,me,users,conversations,onClose,onOpenConversation,onDirect,onSaved,onContacts}:{client:HomeClient;me:User;users:User[];conversations:Conversation[];onClose:()=>void;onOpenConversation:(id:number)=>void;onDirect:(u:User)=>void;onSaved:()=>void;onContacts:()=>void}){
  const [q,setQ]=useState(''); const [results,setResults]=useState<MessageSearchResult[]>([]); const [busy,setBusy]=useState(false);
  useEffect(()=>{if(q.startsWith('/')||q.trim().length<2){setResults([]);return;}const id=window.setTimeout(()=>{setBusy(true);client.searchMessages(q.trim()).then(setResults).catch(()=>setResults([])).finally(()=>setBusy(false));},220);return()=>window.clearTimeout(id);},[q,client]);
  const convName=(id:number)=>{const c=conversations.find(x=>x.id===id);if(!c)return `Conversation ${id}`;if(c.isSelf)return 'Saved Messages';if(c.type==='group')return c.name||'Group';return c.members.find(m=>m.id!==me.id)?.displayName||'Conversation';};
  function run(){const raw=q.trim();if(!raw)return;const parts=raw.split(/\s+/);const cmd=parts.shift()?.toLowerCase();if(cmd==='/saved'){onSaved();onClose();return;}if(cmd==='/contacts'){onContacts();onClose();return;}if(cmd==='/help'){setQ('Commands: /msg -friend NAME | /msg -hid XXXX-XXXX-XXXX | /saved | /contacts');return;}if(cmd==='/msg'){const mode=parts.shift()?.toLowerCase();const value=parts.join(' ').trim();let u:User|undefined;if(mode==='-friend')u=users.find(x=>x.displayName.toLowerCase()===value.toLowerCase()||x.username.toLowerCase()===value.toLowerCase());if(mode==='-hid')u=users.find(x=>x.hid.toLowerCase()===value.toLowerCase());if(u){onDirect(u);onClose();return;}setQ(`${raw} — user not found`);}}
  return <div className="command-backdrop" onMouseDown={onClose}><div className="command-palette" onMouseDown={e=>e.stopPropagation()}><input autoFocus value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&q.startsWith('/')){e.preventDefault();run();}if(e.key==='Escape')onClose();}} placeholder="Search messages or type /help"/>{q.startsWith('/')?<div className="command-help"><button onClick={()=>setQ('/msg -friend ')}>/msg -friend</button><button onClick={()=>setQ('/msg -hid ')}>/msg -hid</button><button onClick={()=>setQ('/saved')}>/saved</button><button onClick={()=>setQ('/contacts')}>/contacts</button><button onClick={()=>setQ('/help')}>/help</button>{q.includes('Commands:')&&<p>{q}</p>}</div>:<div className="command-results">{busy&&<div className="inventory-empty">Searching…</div>}{!busy&&q.trim().length>=2&&!results.length&&<div className="inventory-empty">No matching messages.</div>}{results.map(r=><button key={r.message.id} onClick={()=>{onOpenConversation(r.message.conversationId);onClose();}}><strong>{convName(r.message.conversationId)}</strong><span>{r.message.sender.displayName}: {r.message.body}</span><small>{fmtDateTime(r.message.createdAt)}</small></button>)}</div>}</div></div>;
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
  type ConnectionState='connected'|'reconnecting'|'offline';
  type Toast={id:number;text:string;kind:'error'|'info'};
  const PAGE_SIZE=50;
  const client=useMemo(()=>new HomeClient(BASE_URL,session.token),[session.token]);
  const [me,setMe]=useState(session.user);
  const [users,setUsers]=useState<User[]>([]);
  const [conversations,setConversations]=useState<Conversation[]>([]);
  const [activeId,setActiveId]=useState<number|null>(null);
  const [messages,setMessages]=useState<Record<number,UiMessage[]>>({});
  const [hasMore,setHasMore]=useState<Record<number,boolean>>({});
  const [loadingOlder,setLoadingOlder]=useState<Record<number,boolean>>({});
  const [unreadStart,setUnreadStart]=useState<Record<number,number|undefined>>({});
  const [online,setOnline]=useState<Set<number>>(new Set());
  const [typing,setTyping]=useState<Record<number,Set<number>>>({});
  const [text,setText]=useState('');
  const [drafts,setDrafts]=useState<Record<number,string>>(()=>{try{return JSON.parse(localStorage.getItem(`homechat.drafts.${session.user.id}`)||'{}')}catch{return {}}});
  const [newChat,setNewChat]=useState(false);
  const [admin,setAdmin]=useState(false);
  const [contactsOpen,setContactsOpen]=useState(false);
  const [commandOpen,setCommandOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [replyingTo,setReplyingTo]=useState<UiMessage|null>(null);
  const [editing,setEditing]=useState<UiMessage|null>(null);
  const [uploading,setUploading]=useState(false);
  const [pendingFile,setPendingFile]=useState<File|null>(null);
  const [pendingUrl,setPendingUrl]=useState<string>('');
  const [notificationPermission,setNotificationPermission]=useState<NotificationPermission>(()=>typeof Notification==='undefined'?'denied':Notification.permission);
  const [drawer,setDrawer]=useState<{view:'details'|'media'|'files'|'links';target:'me'|'conversation'}|null>(null);
  const [recording,setRecording]=useState(false);
  const [recordingSeconds,setRecordingSeconds]=useState(0);
  const [connection,setConnection]=useState<ConnectionState>('reconnecting');
  const [toasts,setToasts]=useState<Toast[]>([]);

  const typingTimer=useRef<number|undefined>(undefined);
  const bottomRef=useRef<HTMLDivElement>(null);
  const messagesRef=useRef<HTMLElement>(null);
  const composerRef=useRef<HTMLTextAreaElement>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const avatarRef=useRef<HTMLInputElement>(null);
  const activeIdRef=useRef<number|null>(null);
  const conversationsRef=useRef<Conversation[]>([]);
  const audioRef=useRef<AudioContext|null>(null);
  const recorderRef=useRef<MediaRecorder|null>(null);
  const recordStreamRef=useRef<MediaStream|null>(null);
  const recordChunksRef=useRef<Blob[]>([]);
  const recordTimerRef=useRef<number|undefined>(undefined);
  const toastIdRef=useRef(1);
  const tempIdRef=useRef(-1);
  const [reactionPicker,setReactionPicker]=useState<number|null>(null);
  const active=conversations.find(c=>c.id===activeId)||null;

  function toast(text:string,kind:'error'|'info'='error'){
    const id=toastIdRef.current++;
    setToasts(t=>[...t,{id,text,kind}].slice(-4));
    window.setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),4200);
  }
  function errorText(e:unknown,fallback:string){return e instanceof Error&&e.message?e.message:fallback;}
  function isNearBottom(){const el=messagesRef.current;return !el||el.scrollHeight-el.scrollTop-el.clientHeight<140;}
  function scrollBottom(behavior:ScrollBehavior='auto'){requestAnimationFrame(()=>bottomRef.current?.scrollIntoView({behavior}));}
  function dayKey(ts:string){const d=new Date(ts);return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;}
  function dayLabel(ts:string){const d=new Date(ts);const now=new Date();const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);if(dayKey(ts)===dayKey(now.toISOString()))return 'Today';if(dayKey(ts)===dayKey(yesterday.toISOString()))return 'Yesterday';return d.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:d.getFullYear()===now.getFullYear()?undefined:'numeric'});}

  const previousActiveRef=useRef<number|null>(null);
  useEffect(()=>{const prev=previousActiveRef.current;if(prev!==null&&!editing)setDrafts(d=>({...d,[prev]:text}));previousActiveRef.current=activeId;activeIdRef.current=activeId;setDrawer(null);setReplyingTo(null);setEditing(null);setText(activeId?drafts[activeId]||'':'');},[activeId]);
  useEffect(()=>{localStorage.setItem(`homechat.drafts.${me.id}`,JSON.stringify(drafts));},[drafts,me.id]);
  useEffect(()=>{function key(e:KeyboardEvent){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setCommandOpen(true);return;}if(e.key==='Escape'){setDrawer(null);setCommandOpen(false);}}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  useEffect(()=>{conversationsRef.current=conversations;const unread=conversations.reduce((n,c)=>n+c.unreadCount,0);document.title=unread?`(${unread}) HomeChat`:'HomeChat';},[conversations]);
  useEffect(()=>()=>{document.title='HomeChat';},[]);
  useEffect(()=>{if(!pendingFile){if(pendingUrl)URL.revokeObjectURL(pendingUrl);setPendingUrl('');return;}const url=URL.createObjectURL(pendingFile);setPendingUrl(url);return()=>URL.revokeObjectURL(url);},[pendingFile]);
  useEffect(()=>()=>{window.clearInterval(recordTimerRef.current);recordStreamRef.current?.getTracks().forEach(t=>t.stop());},[]);
  useEffect(()=>{const el=composerRef.current;if(!el)return;el.style.height='0px';el.style.height=`${Math.min(el.scrollHeight,140)}px`;},[text]);

  async function refresh(){
    const [freshMe,u,c]=await Promise.all([client.me(),client.users(),client.conversations()]);
    setMe(freshMe);setUsers(u);setConversations(c);
    if(freshMe.hid!==session.user.hid||freshMe.avatarUrl!==session.user.avatarUrl||freshMe.displayName!==session.user.displayName){onSessionChange({token:session.token,user:freshMe});}
    if(!activeIdRef.current&&c.length)setActiveId(c[0].id);
  }
  async function loadMessages(cid:number){
    try{
      const convo=conversationsRef.current.find(c=>c.id===cid);
      const unread=convo?.unreadCount??0;
      const list=await client.messages(cid);
      setMessages(m=>({...m,[cid]:list}));
      setHasMore(h=>({...h,[cid]:list.length===PAGE_SIZE}));
      setUnreadStart(s=>({...s,[cid]:unread&&list.length?list[Math.max(0,list.length-Math.min(unread,list.length))]?.id:undefined}));
      list.filter(x=>x.sender.id!==me.id).forEach(x=>client.receipt(x.id,'read'));
      setConversations(c=>c.map(x=>x.id===cid?{...x,unreadCount:0}:x));
      scrollBottom();
    }catch(e){toast(errorText(e,'Could not load messages.'));}
  }
  async function loadOlder(cid:number){
    const current=messages[cid]||[];
    if(!current.length||hasMore[cid]===false||loadingOlder[cid])return;
    const el=messagesRef.current;const oldHeight=el?.scrollHeight??0;const oldTop=el?.scrollTop??0;
    setLoadingOlder(x=>({...x,[cid]:true}));
    try{
      const older=await client.messages(cid,current[0].id);
      older.filter(x=>x.sender.id!==me.id).forEach(x=>client.receipt(x.id,'read'));
      setMessages(all=>{const merged=[...older,...(all[cid]||[])];const seen=new Set<number>();return {...all,[cid]:merged.filter(m=>!seen.has(m.id)&&!!seen.add(m.id))};});
      setHasMore(h=>({...h,[cid]:older.length===PAGE_SIZE}));
      requestAnimationFrame(()=>{const now=messagesRef.current;if(now&&activeIdRef.current===cid)now.scrollTop=now.scrollHeight-oldHeight+oldTop;});
    }catch(e){toast(errorText(e,'Could not load older messages.'));}
    finally{setLoadingOlder(x=>({...x,[cid]:false}));}
  }

  function conversationName(c:Conversation){if(c.isSelf)return 'Saved Messages';if(c.type==='group')return c.name||'Group';return c.members.find(m=>m.id!==me.id)?.displayName||'Conversation';}
  function conversationAvatar(c:Conversation){if(c.isSelf)return me.avatarUrl;if(c.type==='group')return c.avatarUrl;return c.members.find(m=>m.id!==me.id)?.avatarUrl||null;}
  function conversationOnline(c:Conversation){return !c.isSelf&&c.type==='direct'&&c.members.some(m=>m.id!==me.id&&online.has(m.id));}
  function conversationSubline(c:Conversation){if(c.isSelf)return 'Private notes & files';if(c.type==='group')return `${c.members.length} members`;return conversationOnline(c)?'online':'offline';}
  function typingNames(c:Conversation|null){if(!c)return '';const ids=[...(typing[c.id]||new Set())];return ids.map(id=>users.find(u=>u.id===id)?.displayName).filter(Boolean).join(', ');}
  function receiptView(m:UiMessage,c:Conversation){
    if(m.sender.id!==me.id||c.isSelf)return null;
    if(m.sendState==='sending')return <span className="receipt pending">Sending…</span>;
    if(m.sendState==='failed')return <span className="receipt failed">Failed</span>;
    const others=m.receipts.filter(r=>r.userId!==me.id);
    if(!others.length)return null;
    const read=others.filter(r=>r.readAt).length;const delivered=others.filter(r=>r.deliveredAt||r.readAt).length;
    if(c.type==='group'){
      if(read)return <span className="receipt read" title={`${read} of ${others.length} read`}>Seen {read}/{others.length}</span>;
      if(delivered)return <span className="receipt" title={`${delivered} of ${others.length} delivered`}>✓✓</span>;
      return <span className="receipt" title="Sent">✓</span>;
    }
    if(read)return <span className="receipt read" title="Read">✓✓</span>;
    if(delivered)return <span className="receipt" title="Delivered">✓✓</span>;
    return <span className="receipt" title="Sent">✓</span>;
  }

  function beep(){try{const Ctx=window.AudioContext||(window as any).webkitAudioContext;if(!Ctx)return;const ctx=audioRef.current??new Ctx();audioRef.current=ctx;if(ctx.state==='suspended')void ctx.resume();const osc=ctx.createOscillator();const gain=ctx.createGain();osc.frequency.value=680;gain.gain.setValueAtTime(.045,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.16);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.17);}catch{}}
  async function enableNotifications(){try{beep();if(typeof Notification==='undefined'){toast('Notifications are not supported by this browser.');return;}const p=await Notification.requestPermission();setNotificationPermission(p);if(p!=='granted')toast('Notifications were not enabled.','info');}catch(e){toast(errorText(e,'Could not enable notifications.'));}}
  function notifyIncoming(m:Message){const c=conversationsRef.current.find(x=>x.id===m.conversationId);const isVisible=!document.hidden&&activeIdRef.current===m.conversationId;if(isVisible)return;beep();if(typeof Notification!=='undefined'&&Notification.permission==='granted'){const title=c?conversationName(c):m.sender.displayName;const body=previewText(m);const n=new Notification(title,{body,tag:`homechat-${m.conversationId}`});n.onclick=()=>{window.focus();setActiveId(m.conversationId);n.close();};}}

  useEffect(()=>{
    refresh().catch(e=>toast(errorText(e,'Could not refresh HomeChat.')));
    const socket=client.connect();
    const manager=socket.io;
    const connected=()=>setConnection('connected');
    const disconnected=()=>setConnection('reconnecting');
    const reconnecting=()=>setConnection('reconnecting');
    const failed=()=>setConnection('offline');
    socket.on('connect',connected);socket.on('disconnect',disconnected);socket.on('connect_error',failed);
    manager.on('reconnect_attempt',reconnecting);manager.on('reconnect_failed',failed);
    socket.on('presence:snapshot',(p:{userIds:number[]})=>setOnline(new Set(p.userIds)));
    socket.on('presence:update',(p:{userId:number;online:boolean})=>setOnline(s=>{const n=new Set(s);p.online?n.add(p.userId):n.delete(p.userId);return n;}));
    socket.on('typing:update',(p:{conversationId:number;userId:number;typing:boolean})=>setTyping(t=>{const n={...t};const set=new Set(n[p.conversationId]||[]);p.typing?set.add(p.userId):set.delete(p.userId);n[p.conversationId]=set;return n;}));
    socket.on('receipt:update',(p:{messageId:number;userId:number;kind:'delivered'|'read'})=>setMessages(all=>{const next={...all};for(const [cid,list] of Object.entries(next)){if(!list.some(m=>m.id===p.messageId))continue;next[Number(cid)]=list.map(m=>{if(m.id!==p.messageId)return m;const now=new Date().toISOString();const receipts=[...(m.receipts||[])];const i=receipts.findIndex(r=>r.userId===p.userId);const current=i>=0?receipts[i]:{userId:p.userId,deliveredAt:null,readAt:null};const updated=p.kind==='read'?{...current,deliveredAt:current.deliveredAt||now,readAt:now}:{...current,deliveredAt:now};if(i>=0)receipts[i]=updated;else receipts.push(updated);return {...m,receipts};});break;}return next;}));
    socket.on('message:update',(m:Message)=>setMessages(all=>({...all,[m.conversationId]:(all[m.conversationId]||[]).map(x=>x.id===m.id?m:x)})));
    socket.on('reaction:update',(p:{messageId:number;reactions:Message['reactions']})=>setMessages(all=>{const next={...all};for(const [cid,list] of Object.entries(next)){if(list.some(m=>m.id===p.messageId)){next[Number(cid)]=list.map(m=>m.id===p.messageId?{...m,reactions:p.reactions}:m);break;}}return next;}));
    socket.on('message:new',(m:Message)=>{
      const shouldFollow=m.conversationId===activeIdRef.current&&isNearBottom();
      setMessages(all=>{const list=all[m.conversationId]||[];let oldLocal:UiMessage|undefined;const kept=list.filter(x=>{const same=x.id===m.id||Boolean(m.clientNonce&&x.clientNonce===m.clientNonce);if(same&&x.temp)oldLocal=x;return !same;});if(oldLocal?.localFileUrl)URL.revokeObjectURL(oldLocal.localFileUrl);return {...all,[m.conversationId]:[...kept,m]};});
      const visible=m.conversationId===activeIdRef.current&&!document.hidden;
      setConversations(cs=>{const found=cs.find(c=>c.id===m.conversationId);if(!found)return cs;const updated={...found,lastMessage:m,unreadCount:m.sender.id!==me.id&&!visible?found.unreadCount+1:0};return [updated,...cs.filter(c=>c.id!==m.conversationId)];});
      if(m.sender.id!==me.id){client.receipt(m.id,'delivered');if(visible)client.receipt(m.id,'read');notifyIncoming(m);}
      if(shouldFollow||m.sender.id===me.id)scrollBottom('smooth');
    });
    return()=>{socket.off();manager.off('reconnect_attempt',reconnecting);manager.off('reconnect_failed',failed);client.disconnect();};
  },[client]);
  useEffect(()=>{if(activeId){void loadMessages(activeId);setPendingFile(null);}},[activeId]);
  useEffect(()=>{function visible(){if(!document.hidden&&activeIdRef.current){const cid=activeIdRef.current;const list=messages[cid]||[];list.filter(x=>x.sender.id!==me.id).forEach(x=>client.receipt(x.id,'read'));setConversations(c=>c.map(x=>x.id===cid?{...x,unreadCount:0}:x));}}document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[client,messages,me.id]);

  const filtered=conversations.filter(c=>conversationName(c).toLowerCase().includes(search.toLowerCase()));
  const mentionMatch=active?.type==='group'?/(?:^|\s)@([A-Za-z0-9_.-]*)$/.exec(text):null;
  const mentionSuggestions=mentionMatch?active!.members.filter(u=>u.id!==me.id&&(u.username.toLowerCase().startsWith(mentionMatch[1].toLowerCase())||u.displayName.toLowerCase().startsWith(mentionMatch[1].toLowerCase()))).slice(0,6):[];
  function insertMention(u:User){setText(t=>t.replace(/(?:^|\s)@[A-Za-z0-9_.-]*$/,m=>`${m.startsWith(' ')?' ':''}@${u.username} `));requestAnimationFrame(()=>composerRef.current?.focus());}

  function queueFile(file:File){if(file.size>100*1024*1024){toast('File is larger than 100 MB.');return;}setPendingFile(file);}
  async function deliverOptimistic(tempId:number,cid:number,body:string,file:File|null,clientNonce:string,fileId?:number,replyToId?:number){
    let resolvedFileId=fileId;
    try{
      if(file&&!resolvedFileId){setUploading(true);const uploaded=await client.upload(file);resolvedFileId=uploaded.id;setMessages(all=>({...all,[cid]:(all[cid]||[]).map(m=>m.id===tempId?{...m,retry:{body:body||undefined,fileId:resolvedFileId,clientNonce,file,replyToId}}:m)}));}
      const sent=await client.send(cid,body||undefined,resolvedFileId,clientNonce,replyToId);
      setMessages(all=>{const list=all[cid]||[];const local=list.find(m=>m.id===tempId||m.clientNonce===clientNonce);if(local?.localFileUrl)URL.revokeObjectURL(local.localFileUrl);return {...all,[cid]:[...list.filter(m=>m.id!==tempId&&m.clientNonce!==clientNonce&&m.id!==sent.id),sent]};});
    }catch(e){setMessages(all=>({...all,[cid]:(all[cid]||[]).map(m=>m.id===tempId||m.clientNonce===clientNonce?{...m,sendState:'failed',retry:{body:body||undefined,fileId:resolvedFileId,clientNonce,file:file||undefined,replyToId}}:m)}));toast(errorText(e,'Message could not be sent.'));}
    finally{setUploading(false);if(fileRef.current)fileRef.current.value='';}
  }
  async function send(){
    const body=text.trim();if(!activeId)return;
    if(editing){if(!body)return;if(connection!=='connected'){toast('HomeChat is offline. Wait for it to reconnect.');return;}try{const updated=await client.editMessage(editing.id,body);setMessages(all=>({...all,[activeId]:(all[activeId]||[]).map(m=>m.id===updated.id?updated:m)}));setEditing(null);setText('');}catch(e){toast(errorText(e,'Message could not be edited.'));}return;}
    if(!body&&!pendingFile)return;
    if(connection!=='connected'){toast('HomeChat is offline. Wait for it to reconnect.');return;}
    const cid=activeId;const file=pendingFile;const clientNonce=crypto.randomUUID();const tempId=tempIdRef.current--;const localFileUrl=file?URL.createObjectURL(file):undefined;const replyToId=replyingTo?.id;
    const optimistic:UiMessage={id:tempId,conversationId:cid,sender:me,type:file?(file.type.startsWith('image/')?'image':'file'):'text',body:body||null,file:file?{id:tempId,name:file.name,mimeType:file.type||'application/octet-stream',size:file.size,url:''}:null,createdAt:new Date().toISOString(),editedAt:null,deletedAt:null,replyTo:replyingTo?{id:replyingTo.id,sender:replyingTo.sender,type:replyingTo.type,body:replyingTo.body,file:replyingTo.file,deletedAt:replyingTo.deletedAt}:null,receipts:[],reactions:[],clientNonce,sendState:'sending',temp:true,localFileUrl,retry:{body:body||undefined,clientNonce,file:file||undefined,replyToId}};
    setMessages(all=>({...all,[cid]:[...(all[cid]||[]),optimistic]}));setText('');if(activeId)setDrafts(d=>({...d,[activeId]:''}));setPendingFile(null);setReplyingTo(null);client.typing(cid,false);scrollBottom('smooth');
    void deliverOptimistic(tempId,cid,body,file,clientNonce,undefined,replyToId);
  }
  function retryMessage(m:UiMessage){if(!m.retry||connection!=='connected')return;setMessages(all=>({...all,[m.conversationId]:(all[m.conversationId]||[]).map(x=>x.id===m.id?{...x,sendState:'sending'}:x)}));void deliverOptimistic(m.id,m.conversationId,m.retry.body||'',m.retry.file||null,m.retry.clientNonce,m.retry.fileId,m.retry.replyToId);}
  function beginEdit(m:UiMessage){if(!m.body||m.sender.id!==me.id||m.deletedAt)return;setEditing(m);setReplyingTo(null);setText(m.body);requestAnimationFrame(()=>composerRef.current?.focus());}
  function beginReply(m:UiMessage){if(m.deletedAt)return;setReplyingTo(m);setEditing(null);requestAnimationFrame(()=>composerRef.current?.focus());}
  async function removeMessage(m:UiMessage){if(m.sender.id!==me.id||m.id<=0)return;try{const updated=await client.deleteMessage(m.id);setMessages(all=>({...all,[m.conversationId]:(all[m.conversationId]||[]).map(x=>x.id===m.id?updated:x)}));toast('Message deleted.','info');}catch(e){toast(errorText(e,'Message could not be deleted.'));}}
  async function toggleReaction(m:UiMessage,emoji:string){if(m.id<=0)return;try{const reactions=await client.reaction(m.id,emoji);setMessages(all=>({...all,[m.conversationId]:(all[m.conversationId]||[]).map(x=>x.id===m.id?{...x,reactions}:x)}));setReactionPicker(null);}catch(e){toast(errorText(e,'Could not update reaction.'));}}
  function onText(v:string){setText(v);if(activeId&&!editing)setDrafts(d=>({...d,[activeId]:v}));if(!activeId||connection!=='connected')return;client.typing(activeId,true);window.clearTimeout(typingTimer.current);typingTimer.current=window.setTimeout(()=>client.typing(activeId,false),1200);}
  function onPaste(e:React.ClipboardEvent<HTMLTextAreaElement>){const item=[...e.clipboardData.items].find(x=>x.type.startsWith('image/'));if(!item)return;const blob=item.getAsFile();if(!blob)return;e.preventDefault();const ext=blob.type.split('/')[1]?.replace('jpeg','jpg')||'png';queueFile(new File([blob],`clipboard-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`,{type:blob.type}));}
  async function direct(u:User){try{const {id}=await client.createDirect(u.id);await refresh();setActiveId(id);setNewChat(false);}catch(e){toast(errorText(e,'Could not create conversation.'));}}
  async function saved(){try{const {id}=await client.savedMessages();await refresh();setActiveId(id);setNewChat(false);}catch(e){toast(errorText(e,'Could not open Saved Messages.'));}}
  async function group(name:string,ids:number[]){try{const {id}=await client.createGroup(name,ids);await refresh();setActiveId(id);setNewChat(false);}catch(e){toast(errorText(e,'Could not create group.'));}}
  async function changeAvatar(file:File){if(!file.type.startsWith('image/')){toast('Choose an image for your avatar.');return;}try{const user=await client.uploadAvatar(file);setMe(user);onSessionChange({token:session.token,user});await refresh();}catch(e){toast(errorText(e,'Could not update avatar.'));}finally{if(avatarRef.current)avatarRef.current.value='';}}
  async function copyText(value:string,label:string){try{await navigator.clipboard.writeText(value);toast(`${label} copied.`,'info');}catch{toast(`Could not copy ${label.toLowerCase()}.`);}}
  async function renameActiveGroup(name:string){if(!active)return;try{await client.renameGroup(active.id,name);await refresh();toast('Group renamed.','info');}catch(e){toast(errorText(e,'Could not rename group.'));}}
  async function addActiveGroupMember(userId:number){if(!active)return;try{await client.addGroupMember(active.id,userId);await refresh();toast('Member added.','info');}catch(e){toast(errorText(e,'Could not add member.'));}}
  async function removeActiveGroupMember(userId:number){if(!active)return;try{await client.removeGroupMember(active.id,userId);await refresh();toast('Member removed.','info');}catch(e){toast(errorText(e,'Could not remove member.'));}}
  async function leaveActiveGroup(){if(!active||active.type!=='group')return;try{await client.removeGroupMember(active.id,me.id);setDrawer(null);setActiveId(null);activeIdRef.current=null;await refresh();toast('You left the group.','info');}catch(e){toast(errorText(e,'Could not leave group.'));}}

  async function startRecording(){
    if(recording)return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){toast('Voice recording needs HTTPS or localhost. Audio files can still be attached.');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});recordStreamRef.current=stream;recordChunksRef.current=[];
      const preferred=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined);recorderRef.current=recorder;
      recorder.ondataavailable=e=>{if(e.data.size)recordChunksRef.current.push(e.data);};
      recorder.onstop=()=>{const type=recorder.mimeType||'audio/webm';const blob=new Blob(recordChunksRef.current,{type});const ext=type.includes('ogg')?'ogg':type.includes('mp4')?'m4a':'webm';queueFile(new File([blob],`voice-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`,{type}));recordStreamRef.current?.getTracks().forEach(t=>t.stop());recordStreamRef.current=null;recordChunksRef.current=[];};
      recorder.start(250);setRecording(true);setRecordingSeconds(0);window.clearInterval(recordTimerRef.current);recordTimerRef.current=window.setInterval(()=>setRecordingSeconds(x=>x+1),1000);
    }catch(e){toast(errorText(e,'Microphone permission was not granted.'));}
  }
  function stopRecording(){const r=recorderRef.current;if(!r||r.state==='inactive')return;r.stop();setRecording(false);window.clearInterval(recordTimerRef.current);recordTimerRef.current=undefined;}

  function renderMessages(c:Conversation){
    const list=messages[c.id]||[];const nodes:React.ReactNode[]=[];let previousDay='';const unreadId=unreadStart[c.id];
    const sameGroup=(a:UiMessage,b:UiMessage)=>a.sender.id===b.sender.id&&dayKey(a.createdAt)===dayKey(b.createdAt)&&Math.abs(new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())<5*60*1000;
    list.forEach((m,i)=>{
      const dk=dayKey(m.createdAt);
      const dateBreak=dk!==previousDay;
      const unreadBreak=unreadId===m.id;
      if(dateBreak){nodes.push(<div className="date-separator" key={`date-${m.id}`}><span>{dayLabel(m.createdAt)}</span></div>);previousDay=dk;}
      if(unreadBreak)nodes.push(<div className="unread-divider" key={`unread-${m.id}`}><span>Unread messages</span></div>);
      const prev=list[i-1];
      const next=list[i+1];
      const grouped=!dateBreak&&!unreadBreak&&!!prev&&sameGroup(prev,m);
      const groupEnd=!next||unreadId===next.id||dayKey(next.createdAt)!==dk||!sameGroup(m,next);
      nodes.push(<div className={'message-row '+(m.sender.id===me.id?'mine':'theirs')+(m.sendState==='failed'?' failed-message':'')+(grouped?' grouped':'')+(groupEnd?' group-end':'')} key={m.id}>
        <div className="message-actions">{m.id>0&&!m.deletedAt&&<button title="Reply" onClick={()=>beginReply(m)}>↩</button>}{m.id>0&&!m.deletedAt&&<button title="React" onClick={()=>setReactionPicker(reactionPicker===m.id?null:m.id)}>☺</button>}{m.sender.id===me.id&&m.id>0&&!m.deletedAt&&m.body&&<button title="Edit message" onClick={()=>beginEdit(m)}>✎</button>}{m.sender.id===me.id&&m.id>0&&!m.deletedAt&&<button title="Delete message" onClick={()=>void removeMessage(m)}>⌫</button>}{m.body&&!m.deletedAt&&<button title="Copy message" onClick={()=>void copyText(m.body!,'Message')}>⧉</button>}</div>
        <div className="bubble">{c.type==='group'&&m.sender.id!==me.id&&!grouped&&<b className="sender-name">{m.sender.displayName}</b>}<ReplyQuote message={m}/>{m.deletedAt?<div className="deleted-message">Message deleted</div>:<>{m.body&&<MessageBody client={client} body={m.body} me={me}/>}<Attachment client={client} message={m}/></>}
          {m.reactions?.length>0&&<div className="reactions">{m.reactions.map(r=><button key={r.emoji} className={r.userIds.includes(me.id)?'mine':''} title={`${r.userIds.length} reaction${r.userIds.length===1?'':'s'}`} onClick={()=>void toggleReaction(m,r.emoji)}>{r.emoji} <span>{r.userIds.length}</span></button>)}</div>}
          {reactionPicker===m.id&&m.id>0&&<div className="reaction-picker">{['👍','❤️','😂','😮','😢','🎉'].map(e=><button key={e} onClick={()=>void toggleReaction(m,e)}>{e}</button>)}</div>}
          <span className="stamp">{m.editedAt&&!m.deletedAt?'edited · ':''}{fmtTime(m.createdAt)}{receiptView(m,c)}{m.sendState==='failed'&&<button className="retry-send" onClick={()=>retryMessage(m)}>Retry</button>}</span>
        </div></div>);
    });
    return nodes;
  }

  return <div className="app-shell" onClick={()=>{if(audioRef.current?.state==='suspended')void audioRef.current.resume();}}>
    {connection!=='connected'&&<div className={`connection-pill ${connection}`}>{connection==='reconnecting'?'Reconnecting…':'Offline'}</div>}
    <aside className="sidebar">
      <div className="sidebar-top"><div className="me profile-trigger" onClick={()=>setDrawer({view:'details',target:'me'})}><input ref={avatarRef} hidden type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void changeAvatar(f)}}/><Avatar name={me.displayName} avatarUrl={me.avatarUrl} online/><div><strong>{me.displayName}</strong><small>@{me.username}</small></div></div><div className="top-actions"><button title="Command palette (Ctrl+K)" onClick={()=>setCommandOpen(true)}>⌘</button><button title="Contacts & directory" onClick={()=>setContactsOpen(true)}>☷</button><button title={notificationPermission==='granted'?'Notifications enabled':'Enable notifications'} className={notificationPermission==='granted'?'enabled':''} onClick={()=>void enableNotifications()}>{notificationPermission==='granted'?'🔔':'🔕'}</button>{me.isAdmin&&<button title="Add user" onClick={()=>setAdmin(true)}>＋</button>}<button title="New chat" onClick={()=>setNewChat(true)}>✎</button><button title="Log out" onClick={onLogout}>↪</button></div></div>
      <div className="search"><input placeholder="Search conversations" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="conversation-list">{filtered.length?filtered.map(c=>{const lm=c.lastMessage;return <button key={c.id} className={'conversation '+(c.id===activeId?'active':'')} onClick={()=>setActiveId(c.id)}><Avatar name={conversationName(c)} avatarUrl={conversationAvatar(c)} online={c.isSelf?false:conversationOnline(c)}/><div className="conv-main"><div className="conv-line"><strong>{c.isSelf?'★ ':''}{conversationName(c)}</strong><time>{lm?fmtTime(lm.createdAt):''}</time></div><div className="conv-line"><span className="preview">{previewText(lm)}</span>{c.unreadCount>0&&<b className="badge">{c.unreadCount}</b>}</div></div></button>}):<div className="empty-side"><p>No conversations yet.</p><button className="secondary" onClick={()=>setNewChat(true)}>Start one</button></div>}</div>
    </aside>

    <main className="chat-panel" onDragOver={e=>{if(active)e.preventDefault()}} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files?.[0];if(f&&active)queueFile(f)}}>
      {!active?<div className="welcome"><div className="brand-mark big">H</div><h2>HomeChat</h2><p>Pick a conversation or start a new one.</p></div>:<>
        <header className="chat-head"><button className="head-profile" onClick={()=>setDrawer({view:'details',target:'conversation'})}><Avatar name={conversationName(active)} avatarUrl={conversationAvatar(active)} online={conversationOnline(active)}/><div className="chat-head-copy"><strong>{conversationName(active)}</strong><small>{typingNames(active)?`${typingNames(active)} typing…`:conversationSubline(active)}</small></div></button><button className="info-button" title="Conversation details" onClick={()=>setDrawer({view:'details',target:'conversation'})}>ⓘ</button></header>
        <section ref={messagesRef} className="messages" onMouseDown={()=>setDrawer(null)} onScroll={e=>{if(e.currentTarget.scrollTop<80)void loadOlder(active.id)}}>
          {loadingOlder[active.id]&&<div className="history-status">Loading older messages…</div>}
          {!loadingOlder[active.id]&&hasMore[active.id]===false&&(messages[active.id]?.length??0)>0&&<div className="history-status subtle">Start of conversation</div>}
          {renderMessages(active)}
          <div ref={bottomRef}/>
        </section>
        <footer className="composer-wrap" onMouseDown={()=>setDrawer(null)}>
          {replyingTo&&<div className="compose-context"><div><strong>Replying to {replyingTo.sender.displayName}</strong><span>{replyingTo.body||replyingTo.file?.name||'Message'}</span></div><button onClick={()=>setReplyingTo(null)}>×</button></div>}
          {editing&&<div className="compose-context editing"><div><strong>Editing message</strong><span>{editing.body}</span></div><button onClick={()=>{setEditing(null);setText('')}}>×</button></div>}
          {recording&&<div className="recording-strip"><span className="record-dot"/><strong>Recording voice</strong><span>{Math.floor(recordingSeconds/60)}:{String(recordingSeconds%60).padStart(2,'0')}</span><button onClick={stopRecording}>Stop</button></div>}
          {pendingFile&&<div className="pending-file">{pendingFile.type.startsWith('image/')&&pendingUrl?<img src={pendingUrl} alt="Preview"/>:pendingFile.type.startsWith('audio/')&&pendingUrl?<audio src={pendingUrl} controls/>:<span className="file-glyph">{fileGlyph(pendingFile.name,pendingFile.type)}</span>}<div><strong>{pendingFile.type.startsWith('audio/')?'Voice message':pendingFile.name}</strong><small>{fmtBytes(pendingFile.size)} · ready to send</small></div><button title="Remove attachment" onClick={()=>setPendingFile(null)}>×</button></div>}
          {mentionSuggestions.length>0&&<div className="mention-suggest">{mentionSuggestions.map(u=><button key={u.id} onClick={()=>insertMention(u)}><Avatar name={u.displayName} avatarUrl={u.avatarUrl}/><span><strong>@{u.username}</strong><small>{u.displayName}</small></span></button>)}</div>}
          <div className="composer"><input ref={fileRef} type="file" hidden onChange={e=>{const f=e.target.files?.[0];if(f)queueFile(f)}}/><button className="clip" onClick={()=>fileRef.current?.click()} disabled={uploading||recording||Boolean(editing)}>＋</button><textarea ref={composerRef} rows={1} value={text} onPaste={onPaste} onChange={e=>onText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}} placeholder={connection==='connected'?(editing?'Edit message':'Type a message or paste an image'):'Waiting for connection…'}/><button className={`mic ${recording?'recording':''}`} title={recording?'Stop recording':'Record voice message'} onClick={recording?stopRecording:()=>void startRecording()} disabled={uploading||connection!=='connected'||Boolean(editing)}>{recording?'■':'🎤'}</button><button className="send" onClick={()=>void send()} disabled={connection!=='connected'||uploading||recording||(!text.trim()&&!pendingFile)}>{uploading?'…':'➤'}</button></div>
        </footer>
      </>}
    </main>
    {drawer&&<ContextDrawer client={client} conversation={drawer.target==='conversation'?active:null} me={me} users={users} online={online} view={drawer.view} target={drawer.target} onView={view=>setDrawer(d=>d?{...d,view}:d)} onClose={()=>setDrawer(null)} onCopy={(text,label)=>void copyText(text,label)} onChangeAvatar={()=>avatarRef.current?.click()} onRenameGroup={renameActiveGroup} onAddMember={addActiveGroupMember} onRemoveMember={removeActiveGroupMember} onLeaveGroup={leaveActiveGroup}/>} 
    {contactsOpen&&<ContactsModal client={client} me={me} online={online} onClose={()=>setContactsOpen(false)} onDirect={u=>{setContactsOpen(false);void direct(u)}} onChanged={()=>void refresh()}/>}
    {newChat&&<NewChatModal users={users} current={me} onClose={()=>setNewChat(false)} onDirect={direct} onGroup={group} onSaved={saved}/>} 
    {admin&&<AdminModal client={client} onClose={()=>setAdmin(false)} onCreated={()=>void refresh()}/>} 
    {commandOpen&&<CommandPalette client={client} me={me} users={users} conversations={conversations} onClose={()=>setCommandOpen(false)} onOpenConversation={setActiveId} onDirect={u=>void direct(u)} onSaved={()=>void saved()} onContacts={()=>setContactsOpen(true)}/>}
    <div className="toast-stack">{toasts.map(t=><div key={t.id} className={`toast ${t.kind}`}><span>{t.text}</span><button onClick={()=>setToasts(x=>x.filter(y=>y.id!==t.id))}>×</button></div>)}</div>
  </div>;
}
