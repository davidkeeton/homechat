import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { hashPassword, hashToken, newSessionToken } from './security.js';
import type { ContactRequestsView, ConversationInventory, ConversationSummary, DirectoryUser, LinkPreview, MessageView, PublicUser, ReplyPreview } from './types.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'homechat.db'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('direct','group')),
  name TEXT,
  avatar_url TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('text','image','file')),
  body TEXT,
  file_id INTEGER REFERENCES files(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT
);
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS message_receipts (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TEXT,
  read_at TEXT,
  PRIMARY KEY(message_id, user_id)
);
CREATE TABLE IF NOT EXISTS contacts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, contact_id)
);
CREATE TABLE IF NOT EXISTS contact_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sender_id, recipient_id)
);
CREATE TABLE IF NOT EXISTS link_previews (
  url TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  image_url TEXT,
  site_name TEXT,
  hostname TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
`);


// v0.7 migration: idempotent client nonces make optimistic-send retries safe.
const messageColumns = db.prepare('PRAGMA table_info(messages)').all() as any[];
if (!messageColumns.some(c => String(c.name) === 'client_nonce')) db.exec('ALTER TABLE messages ADD COLUMN client_nonce TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_nonce ON messages(sender_id,client_nonce) WHERE client_nonce IS NOT NULL');

// v0.8 migration: replies and soft-deleted messages.
const messageColumnsV08 = db.prepare('PRAGMA table_info(messages)').all() as any[];
if (!messageColumnsV08.some(c => String(c.name) === 'reply_to_id')) db.exec('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id)');
if (!messageColumnsV08.some(c => String(c.name) === 'deleted_at')) db.exec('ALTER TABLE messages ADD COLUMN deleted_at TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_contact_requests_recipient ON contact_requests(recipient_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);');

// v0.4 migration: existing v0.1-v0.3 databases do not have HIDs.
const userColumns = db.prepare('PRAGMA table_info(users)').all() as any[];
if (!userColumns.some(c => String(c.name) === 'hid')) db.exec('ALTER TABLE users ADD COLUMN hid TEXT');

function newHid(): string {
  for (;;) {
    const raw = randomBytes(6).toString('hex').toUpperCase();
    const hid = `${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;
    if (!db.prepare('SELECT 1 FROM users WHERE hid=?').get(hid)) return hid;
  }
}

for (const row of db.prepare(`SELECT id FROM users WHERE hid IS NULL OR TRIM(hid)=''`).all() as any[]) {
  db.prepare('UPDATE users SET hid=? WHERE id=?').run(newHid(), Number(row.id));
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_hid ON users(hid);');

function publicUser(row: any): PublicUser {
  return {
    id: Number(row.id),
    hid: String(row.hid),
    username: String(row.username),
    displayName: String(row.display_name),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    isAdmin: Boolean(row.is_admin),
  };
}

export function userCount(): number {
  return Number((db.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n);
}

export function createUser(username: string, displayName: string, password: string, isAdmin = false): PublicUser {
  const info = db.prepare(`INSERT INTO users(hid,username,display_name,password_hash,is_admin) VALUES(?,?,?,?,?)`)
    .run(newHid(), username.trim(), displayName.trim(), hashPassword(password), isAdmin ? 1 : 0);
  return getUserById(Number(info.lastInsertRowid))!;
}

export function getUserById(id: number): PublicUser | null {
  const row = db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(id) as any;
  return row ? publicUser(row) : null;
}

export function getUserForLogin(username: string): any | null {
  return (db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username) as any) ?? null;
}

export function listUsers(): PublicUser[] {
  return (db.prepare('SELECT * FROM users WHERE disabled=0 ORDER BY display_name COLLATE NOCASE').all() as any[]).map(publicUser);
}

export function createSession(userId: number): string {
  const { token, hash } = newSessionToken();
  const expires = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  db.prepare('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)').run(userId, hash, expires);
  return token;
}

export function userFromToken(token: string): PublicUser | null {
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > ? AND u.disabled=0
  `).get(hashToken(token), new Date().toISOString()) as any;
  return row ? publicUser(row) : null;
}

export function revokeToken(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
}

export function isMember(conversationId: number, userId: number): boolean {
  return Boolean(db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId));
}

export function conversationMemberIds(conversationId: number): number[] {
  return (db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=?').all(conversationId) as any[]).map(r => Number(r.user_id));
}

export function findOrCreateDirect(a: number, b: number): number {
  const existing = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id=c.id AND m1.user_id=?
    JOIN conversation_members m2 ON m2.conversation_id=c.id AND m2.user_id=?
    WHERE c.type='direct' AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id=c.id)=2
    LIMIT 1
  `).get(a, b) as any;
  if (existing) return Number(existing.id);
  db.exec('BEGIN');
  try {
    const info = db.prepare(`INSERT INTO conversations(type,created_by) VALUES('direct',?)`).run(a);
    const id = Number(info.lastInsertRowid);
    const stmt = db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)');
    stmt.run(id, a); stmt.run(id, b);
    db.exec('COMMIT');
    return id;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Saved Messages is represented as a direct conversation with exactly one member.
// This avoids a destructive migration of the existing conversation type CHECK constraint.
export function findOrCreateSelf(userId: number): number {
  const existing = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=?
    WHERE c.type='direct'
      AND c.created_by=?
      AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id=c.id)=1
    LIMIT 1
  `).get(userId, userId) as any;
  if (existing) return Number(existing.id);
  db.exec('BEGIN');
  try {
    const info = db.prepare(`INSERT INTO conversations(type,name,created_by) VALUES('direct','Saved Messages',?)`).run(userId);
    const id = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)').run(id, userId);
    db.exec('COMMIT');
    return id;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function createGroup(creatorId: number, name: string, memberIds: number[]): number {
  const unique = [...new Set([creatorId, ...memberIds])];
  db.exec('BEGIN');
  try {
    const info = db.prepare(`INSERT INTO conversations(type,name,created_by) VALUES('group',?,?)`).run(name.trim(), creatorId);
    const id = Number(info.lastInsertRowid);
    const stmt = db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)');
    for (const uid of unique) stmt.run(id, uid);
    db.exec('COMMIT');
    return id;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function fileForMessage(fileId: number | null): any | null {
  if (!fileId) return null;
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(fileId) as any;
  return f ? { id:Number(f.id), name:String(f.original_name), mimeType:String(f.mime_type), size:Number(f.size), url:`/api/files/${f.id}` } : null;
}

export function messageById(id: number): MessageView | null {
  const r = db.prepare(`SELECT m.*, u.hid,u.username,u.display_name,u.avatar_url,u.is_admin FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(id) as any;
  if (!r) return null;
  const receipts=(db.prepare('SELECT user_id,delivered_at,read_at FROM message_receipts WHERE message_id=? ORDER BY user_id').all(id) as any[]).map(x=>({
    userId:Number(x.user_id), deliveredAt:x.delivered_at?String(x.delivered_at):null, readAt:x.read_at?String(x.read_at):null
  }));
  const reactionRows=db.prepare('SELECT emoji,user_id FROM message_reactions WHERE message_id=? ORDER BY emoji,user_id').all(id) as any[];
  const reactionMap=new Map<string,number[]>();
  for(const x of reactionRows){const emoji=String(x.emoji);const arr=reactionMap.get(emoji)||[];arr.push(Number(x.user_id));reactionMap.set(emoji,arr);}
  const reactions=[...reactionMap.entries()].map(([emoji,userIds])=>({emoji,userIds}));
  let replyTo: ReplyPreview | null = null;
  if (r.reply_to_id) {
    const q=db.prepare(`SELECT m.id,m.type,m.body,m.file_id,m.deleted_at,u.hid,u.username,u.display_name,u.avatar_url,u.is_admin FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(Number(r.reply_to_id)) as any;
    if(q) replyTo={id:Number(q.id),sender:publicUser(q),type:q.type,body:q.deleted_at?null:(q.body??null),file:q.deleted_at?null:fileForMessage(q.file_id?Number(q.file_id):null),deletedAt:q.deleted_at?String(q.deleted_at):null};
  }
  const deletedAt=r.deleted_at?String(r.deleted_at):null;
  return { id:Number(r.id), conversationId:Number(r.conversation_id), sender:publicUser(r), type:r.type, body:deletedAt?null:(r.body ?? null), file:deletedAt?null:fileForMessage(r.file_id ? Number(r.file_id) : null), createdAt:String(r.created_at), editedAt:r.edited_at ?? null, deletedAt, replyTo, receipts, reactions, clientNonce:r.client_nonce?String(r.client_nonce):null };
}

export function createMessage(conversationId: number, senderId: number, body: string | null, fileId: number | null, clientNonce: string | null = null, replyToId: number | null = null): MessageView {
  if(clientNonce){const existing=db.prepare('SELECT id FROM messages WHERE sender_id=? AND client_nonce=?').get(senderId,clientNonce) as any;if(existing)return messageById(Number(existing.id))!;}
  const file = fileId ? (db.prepare('SELECT mime_type FROM files WHERE id=? AND owner_id=?').get(fileId, senderId) as any) : null;
  if (fileId && !file) throw new Error('invalid_file');
  if (replyToId) {
    const reply=db.prepare('SELECT conversation_id,deleted_at FROM messages WHERE id=?').get(replyToId) as any;
    if(!reply || Number(reply.conversation_id)!==conversationId) throw new Error('invalid_reply');
  }
  const type = file ? (String(file.mime_type).startsWith('image/') ? 'image' : 'file') : 'text';
  const info = db.prepare('INSERT INTO messages(conversation_id,sender_id,type,body,file_id,client_nonce,reply_to_id) VALUES(?,?,?,?,?,?,?)').run(conversationId,senderId,type,body?.trim() || null,fileId,clientNonce,replyToId);
  const messageId = Number(info.lastInsertRowid);
  for (const uid of conversationMemberIds(conversationId)) {
    db.prepare('INSERT OR IGNORE INTO message_receipts(message_id,user_id) VALUES(?,?)').run(messageId,uid);
  }
  return messageById(messageId)!;
}

export function editMessage(messageId:number,userId:number,body:string): MessageView {
  const row=db.prepare('SELECT sender_id,deleted_at FROM messages WHERE id=?').get(messageId) as any;
  if(!row) throw new Error('not_found');
  if(Number(row.sender_id)!==userId) throw new Error('forbidden');
  if(row.deleted_at) throw new Error('deleted');
  const clean=body.trim(); if(!clean) throw new Error('invalid_body');
  db.prepare('UPDATE messages SET body=?,edited_at=? WHERE id=?').run(clean,new Date().toISOString(),messageId);
  return messageById(messageId)!;
}

export function deleteMessage(messageId:number,userId:number): MessageView {
  const row=db.prepare('SELECT sender_id,deleted_at FROM messages WHERE id=?').get(messageId) as any;
  if(!row) throw new Error('not_found');
  if(Number(row.sender_id)!==userId) throw new Error('forbidden');
  if(!row.deleted_at) db.prepare('UPDATE messages SET body=NULL,file_id=NULL,deleted_at=? WHERE id=?').run(new Date().toISOString(),messageId);
  db.prepare('DELETE FROM message_reactions WHERE message_id=?').run(messageId);
  return messageById(messageId)!;
}

export function history(conversationId: number, beforeId: number | null, limit = 50): MessageView[] {
  const rows = beforeId
    ? db.prepare('SELECT id FROM messages WHERE conversation_id=? AND id<? ORDER BY id DESC LIMIT ?').all(conversationId,beforeId,limit)
    : db.prepare('SELECT id FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?').all(conversationId,limit);
  return (rows as any[]).reverse().map(r => messageById(Number(r.id))!);
}

export function toggleReaction(messageId:number,userId:number,emoji:string): {emoji:string; userIds:number[]}[] {
  const clean=emoji.trim().slice(0,16); if(!clean) throw new Error('invalid_reaction');
  const exists=db.prepare('SELECT 1 FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?').get(messageId,userId,clean);
  if(exists) db.prepare('DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=?').run(messageId,userId,clean);
  else db.prepare('INSERT INTO message_reactions(message_id,user_id,emoji) VALUES(?,?,?)').run(messageId,userId,clean);
  return messageById(messageId)?.reactions ?? [];
}

export function markReceipt(messageId: number, userId: number, kind: 'delivered'|'read'): void {
  const now=new Date().toISOString();
  if(kind==='read'){
    db.prepare('UPDATE message_receipts SET delivered_at=COALESCE(delivered_at,?), read_at=? WHERE message_id=? AND user_id=?').run(now,now,messageId,userId);
  } else {
    db.prepare('UPDATE message_receipts SET delivered_at=COALESCE(delivered_at,?) WHERE message_id=? AND user_id=?').run(now,messageId,userId);
  }
}

export function insertFile(ownerId:number, originalName:string, storedName:string, mimeType:string, size:number): number {
  const info = db.prepare('INSERT INTO files(owner_id,original_name,stored_name,mime_type,size) VALUES(?,?,?,?,?)').run(ownerId,originalName,storedName,mimeType,size);
  return Number(info.lastInsertRowid);
}

export function getFile(id:number): any | null { return (db.prepare('SELECT * FROM files WHERE id=?').get(id) as any) ?? null; }

export function setUserAvatar(userId:number,fileId:number): PublicUser {
  const f=db.prepare('SELECT * FROM files WHERE id=? AND owner_id=?').get(fileId,userId) as any;
  if(!f || !String(f.mime_type).startsWith('image/')) throw new Error('invalid_avatar');
  const url=`/api/avatars/${fileId}`;
  db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(url,userId);
  return getUserById(userId)!;
}

export function getAvatarFile(fileId:number): any | null {
  const url=`/api/avatars/${fileId}`;
  return (db.prepare(`
    SELECT f.* FROM files f
    JOIN users u ON u.avatar_url=?
    WHERE f.id=? LIMIT 1
  `).get(url,fileId) as any) ?? null;
}

export function conversationSummaries(userId:number): ConversationSummary[] {
  const rows = db.prepare(`
    SELECT c.*,
      COALESCE((SELECT MAX(m.id) FROM messages m WHERE m.conversation_id=c.id),0) AS last_message_id
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id=c.id
    WHERE cm.user_id=?
    ORDER BY last_message_id DESC, c.id DESC
  `).all(userId) as any[];
  return rows.map(c => {
    const members = (db.prepare(`SELECT u.* FROM users u JOIN conversation_members cm ON cm.user_id=u.id WHERE cm.conversation_id=? ORDER BY u.display_name`).all(c.id) as any[]).map(publicUser);
    const lm = Number(c.last_message_id) ? {id:Number(c.last_message_id)} : null;
    const unread = db.prepare(`SELECT COUNT(*) AS n FROM message_receipts mr JOIN messages m ON m.id=mr.message_id WHERE mr.user_id=? AND m.conversation_id=? AND mr.read_at IS NULL AND m.sender_id<>?`).get(userId,c.id,userId) as any;
    const isSelf = c.type === 'direct' && members.length === 1 && members[0]?.id === userId;
    return { id:Number(c.id), type:c.type, isSelf, name:c.name ?? null, avatarUrl:c.avatar_url ?? null, members, unreadCount:Number(unread.n), lastMessage:lm ? messageById(Number(lm.id)) : null };
  });
}

export function conversationType(conversationId:number): string | null {
  const r=db.prepare('SELECT type FROM conversations WHERE id=?').get(conversationId) as any;
  return r ? String(r.type) : null;
}

export function addGroupMember(conversationId:number,userId:number): void {
  if (conversationType(conversationId)!=='group') throw new Error('not_group');
  db.prepare('INSERT OR IGNORE INTO conversation_members(conversation_id,user_id) VALUES(?,?)').run(conversationId,userId);
}

export function removeGroupMember(conversationId:number,userId:number): void {
  if (conversationType(conversationId)!=='group') throw new Error('not_group');
  db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?').run(conversationId,userId);
}

export function renameGroup(conversationId:number,name:string): void {
  if (conversationType(conversationId)!=='group') throw new Error('not_group');
  db.prepare('UPDATE conversations SET name=? WHERE id=?').run(name.trim(),conversationId);
}

export function fileIsReferencedForUser(fileId:number,userId:number): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM messages m
    JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
    WHERE m.file_id=? AND cm.user_id=? LIMIT 1
  `).get(fileId,userId));
}

const URL_RE = /https?:\/\/[^\s<>'"`]+/gi;
function urlsFromText(text: string | null): string[] {
  if (!text) return [];
  return [...text.matchAll(URL_RE)].map(m => m[0].replace(/[),.;!?]+$/g,''));
}

export function conversationInventory(conversationId:number): ConversationInventory {
  const rows = db.prepare(`
    SELECT m.id,m.body,m.created_at,m.sender_id,m.file_id,
           u.hid,u.username,u.display_name,u.avatar_url,u.is_admin,
           f.original_name,f.mime_type,f.size
    FROM messages m
    JOIN users u ON u.id=m.sender_id
    LEFT JOIN files f ON f.id=m.file_id
    WHERE m.conversation_id=? AND m.deleted_at IS NULL
    ORDER BY m.id DESC
  `).all(conversationId) as any[];
  const media: ConversationInventory['media'] = [];
  const files: ConversationInventory['files'] = [];
  const links: ConversationInventory['links'] = [];
  const seenLinks = new Set<string>();
  for (const r of rows) {
    const sender=publicUser(r);
    if (r.file_id) {
      const file={id:Number(r.file_id),name:String(r.original_name),mimeType:String(r.mime_type),size:Number(r.size),url:`/api/files/${r.file_id}`};
      const item={messageId:Number(r.id),sender,file,createdAt:String(r.created_at)};
      if (/^(image|video|audio)\//i.test(file.mimeType)) media.push(item); else files.push(item);
    }
    for (const url of urlsFromText(r.body ?? null)) {
      const key=`${r.id}:${url}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({messageId:Number(r.id),sender,url,createdAt:String(r.created_at)});
    }
  }
  return {media,files,links};
}

export function getCachedLinkPreview(url:string,maxAgeMs=7*86400000): LinkPreview | null {
  const row=db.prepare('SELECT * FROM link_previews WHERE url=?').get(url) as any;
  if(!row) return null;
  if(Date.now()-Date.parse(String(row.fetched_at))>maxAgeMs) return null;
  return {url:String(row.url),title:row.title??null,description:row.description??null,imageUrl:row.image_url??null,siteName:row.site_name??null,hostname:String(row.hostname)};
}

export function saveLinkPreview(preview:LinkPreview): void {
  db.prepare(`
    INSERT INTO link_previews(url,title,description,image_url,site_name,hostname,fetched_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(url) DO UPDATE SET title=excluded.title,description=excluded.description,image_url=excluded.image_url,site_name=excluded.site_name,hostname=excluded.hostname,fetched_at=excluded.fetched_at
  `).run(preview.url,preview.title,preview.description,preview.imageUrl,preview.siteName,preview.hostname,new Date().toISOString());
}


export function listContacts(userId:number): PublicUser[] {
  return (db.prepare(`SELECT u.* FROM contacts c JOIN users u ON u.id=c.contact_id WHERE c.user_id=? AND u.disabled=0 ORDER BY u.display_name COLLATE NOCASE`).all(userId) as any[]).map(publicUser);
}

function requestView(row:any) {
  const sender=getUserById(Number(row.sender_id)); const recipient=getUserById(Number(row.recipient_id));
  if(!sender||!recipient) return null;
  return {id:Number(row.id),sender,recipient,createdAt:String(row.created_at)};
}

export function contactRequests(userId:number): ContactRequestsView {
  const incoming=(db.prepare('SELECT * FROM contact_requests WHERE recipient_id=? ORDER BY id DESC').all(userId) as any[]).map(requestView).filter(Boolean) as any[];
  const outgoing=(db.prepare('SELECT * FROM contact_requests WHERE sender_id=? ORDER BY id DESC').all(userId) as any[]).map(requestView).filter(Boolean) as any[];
  return {incoming,outgoing};
}

export function searchDirectory(userId:number,q:string): DirectoryUser[] {
  const term=q.trim(); const like=`%${term}%`;
  const rows=(term?db.prepare(`SELECT * FROM users WHERE disabled=0 AND (display_name LIKE ? COLLATE NOCASE OR username LIKE ? COLLATE NOCASE OR hid LIKE ? COLLATE NOCASE) ORDER BY display_name COLLATE NOCASE LIMIT 100`).all(like,like,like):db.prepare('SELECT * FROM users WHERE disabled=0 ORDER BY display_name COLLATE NOCASE LIMIT 100').all()) as any[];
  return rows.map(row=>{
    const u=publicUser(row); let relationship:DirectoryUser['relationship']='none';
    if(u.id===userId) relationship='self';
    else if(db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(userId,u.id)) relationship='contact';
    else if(db.prepare('SELECT 1 FROM contact_requests WHERE sender_id=? AND recipient_id=?').get(userId,u.id)) relationship='outgoing';
    else if(db.prepare('SELECT 1 FROM contact_requests WHERE sender_id=? AND recipient_id=?').get(u.id,userId)) relationship='incoming';
    return {...u,relationship};
  });
}

export function sendContactRequest(senderId:number,recipientId:number): void {
  if(senderId===recipientId) throw new Error('invalid_user');
  if(!getUserById(recipientId)) throw new Error('invalid_user');
  if(db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(senderId,recipientId)) throw new Error('already_contact');
  const reverse=db.prepare('SELECT id FROM contact_requests WHERE sender_id=? AND recipient_id=?').get(recipientId,senderId) as any;
  if(reverse){acceptContactRequest(Number(reverse.id),senderId);return;}
  db.prepare('INSERT OR IGNORE INTO contact_requests(sender_id,recipient_id) VALUES(?,?)').run(senderId,recipientId);
}

export function acceptContactRequest(requestId:number,recipientId:number): void {
  const row=db.prepare('SELECT * FROM contact_requests WHERE id=? AND recipient_id=?').get(requestId,recipientId) as any;
  if(!row) throw new Error('not_found');
  db.exec('BEGIN');
  try{
    db.prepare('INSERT OR IGNORE INTO contacts(user_id,contact_id) VALUES(?,?)').run(Number(row.sender_id),recipientId);
    db.prepare('INSERT OR IGNORE INTO contacts(user_id,contact_id) VALUES(?,?)').run(recipientId,Number(row.sender_id));
    db.prepare('DELETE FROM contact_requests WHERE id=?').run(requestId);
    db.prepare('DELETE FROM contact_requests WHERE sender_id=? AND recipient_id=?').run(recipientId,Number(row.sender_id));
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}

export function declineContactRequest(requestId:number,userId:number): void {
  db.prepare('DELETE FROM contact_requests WHERE id=? AND (recipient_id=? OR sender_id=?)').run(requestId,userId,userId);
}

export function removeContact(userId:number,contactId:number): void {
  db.exec('BEGIN');
  try{db.prepare('DELETE FROM contacts WHERE user_id=? AND contact_id=?').run(userId,contactId);db.prepare('DELETE FROM contacts WHERE user_id=? AND contact_id=?').run(contactId,userId);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
