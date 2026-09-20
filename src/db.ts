import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { hashPassword, hashToken, newSessionToken } from './security.js';
import type { ContactRequestsView, ConversationInventory, ConversationSummary, DirectoryUser, LinkPreview, MessageSearchResult, MessageView, PublicUser, ReplyPreview } from './types.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'homechat.db'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
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
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(blocker_id, blocked_id)
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
CREATE TABLE IF NOT EXISTS server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_session ON push_subscriptions(session_token_hash);
CREATE TABLE IF NOT EXISTS user_privacy (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dm_policy TEXT NOT NULL DEFAULT 'everyone' CHECK(dm_policy IN ('everyone','contacts','nobody')),
  contact_policy TEXT NOT NULL DEFAULT 'everyone' CHECK(contact_policy IN ('everyone','nobody')),
  presence_policy TEXT NOT NULL DEFAULT 'everyone' CHECK(presence_policy IN ('everyone','contacts','nobody')),
  directory_visible INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
`);

// v0.11.5 deliberately starts the simplified HID + display-name identity model fresh.
// Do not silently mutate or delete a pre-release username-based database.
const identityColumns = db.prepare('PRAGMA table_info(users)').all() as any[];
if (identityColumns.some(c => String(c.name) === 'username')) {
  throw new Error('legacy_username_database: v0.11.5 requires a fresh homechat.db; back up and remove the old pre-production database before starting');
}

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
db.exec('CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);');

// v0.10 migration: service settings and per-user privacy.
const defaultSettings: Record<string,string> = {
  registration_enabled: '0',
  registration_invite_hash: '',
  max_upload_bytes: String(config.maxUploadBytes),
};
for (const [key,value] of Object.entries(defaultSettings)) {
  db.prepare('INSERT OR IGNORE INTO server_settings(key,value) VALUES(?,?)').run(key,value);
}
for (const row of db.prepare('SELECT id FROM users').all() as any[]) {
  db.prepare('INSERT OR IGNORE INTO user_privacy(user_id) VALUES(?)').run(Number(row.id));
}

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
    displayName: String(row.display_name),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    isAdmin: Boolean(row.is_admin),
  };
}

export function userCount(): number {
  return Number((db.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n);
}

function cleanAccountFields(displayName:string, password:string): {displayName:string;password:string} {
  const d=String(displayName ?? '').trim();
  if(d.length<1 || d.length>64) throw new Error('invalid_display_name');
  if(typeof password!=='string' || password.length<8 || password.length>256) throw new Error('invalid_password');
  return {displayName:d,password};
}

function displayNameInUse(displayName:string, exceptUserId?:number): boolean {
  const d=String(displayName ?? '').trim();
  if(!d) return false;
  return Boolean(exceptUserId
    ? db.prepare('SELECT 1 FROM users WHERE display_name=? COLLATE NOCASE AND id<>?').get(d,exceptUserId)
    : db.prepare('SELECT 1 FROM users WHERE display_name=? COLLATE NOCASE').get(d));
}

export function createUser(displayName: string, password: string, isAdmin = false): PublicUser {
  const clean=cleanAccountFields(displayName,password);
  if(displayNameInUse(clean.displayName)) throw new Error('display_name_exists');
  const info = db.prepare(`INSERT INTO users(hid,display_name,password_hash,is_admin) VALUES(?,?,?,?)`)
    .run(newHid(), clean.displayName, hashPassword(clean.password), isAdmin ? 1 : 0);
  const id=Number(info.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO user_privacy(user_id) VALUES(?)').run(id);
  return getUserById(id)!;
}

export function getUserById(id: number): PublicUser | null {
  const row = db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(id) as any;
  return row ? publicUser(row) : null;
}

export function getUserForLogin(displayName: string): any | null {
  return (db.prepare('SELECT * FROM users WHERE display_name=? COLLATE NOCASE').get(displayName.trim()) as any) ?? null;
}

export function listUsers(): PublicUser[] {
  return (db.prepare('SELECT * FROM users WHERE disabled=0 ORDER BY display_name COLLATE NOCASE').all() as any[]).map(publicUser);
}

export function pruneExpiredSessions(): number {
  return Number(db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date().toISOString()).changes);
}

export function createSession(userId: number): string {
  pruneExpiredSessions();
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
  const tokenHash=hashToken(token);
  db.prepare('DELETE FROM push_subscriptions WHERE session_token_hash=?').run(tokenHash);
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
}


export type StoredPushSubscription = { endpoint:string;p256dh:string;auth:string;deviceId:string };

function cleanPushField(value:unknown,max:number,name:string):string{
  const v=String(value??'').trim();
  if(!v || v.length>max)throw new Error(`invalid_${name}`);
  return v;
}

export function upsertPushSubscription(userId:number,token:string,input:{endpoint:unknown;p256dh:unknown;auth:unknown;deviceId:unknown;userAgent?:unknown}):void{
  const endpoint=cleanPushField(input.endpoint,4096,'endpoint');
  if(!endpoint.startsWith('https://'))throw new Error('invalid_endpoint');
  const p256dh=cleanPushField(input.p256dh,1024,'p256dh');
  const auth=cleanPushField(input.auth,512,'auth');
  const deviceId=cleanPushField(input.deviceId,128,'device_id');
  const userAgent=String(input.userAgent??'').slice(0,512);
  const sessionHash=hashToken(token);
  const valid=db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?').get(sessionHash,userId,new Date().toISOString());
  if(!valid)throw new Error('invalid_session');
  db.prepare(`INSERT INTO push_subscriptions(user_id,session_token_hash,device_id,endpoint,p256dh,auth,user_agent,updated_at)
    VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,session_token_hash=excluded.session_token_hash,device_id=excluded.device_id,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,updated_at=CURRENT_TIMESTAMP`)
    .run(userId,sessionHash,deviceId,endpoint,p256dh,auth,userAgent);
}

export function deletePushSubscription(userId:number,endpoint:string):void{
  db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(userId,String(endpoint??''));
}

export function deletePushSubscriptionByEndpoint(endpoint:string):void{
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);
}

export function pushSubscriptionsForUser(userId:number):StoredPushSubscription[]{
  const rows=db.prepare(`SELECT p.endpoint,p.p256dh,p.auth,p.device_id
    FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_token_hash AND s.user_id=p.user_id
    JOIN users u ON u.id=p.user_id
    WHERE p.user_id=? AND s.expires_at>? AND u.disabled=0`).all(userId,new Date().toISOString()) as any[];
  return rows.map(r=>({endpoint:String(r.endpoint),p256dh:String(r.p256dh),auth:String(r.auth),deviceId:String(r.device_id)}));
}

export function pruneStalePushSubscriptions():number{
  return Number(db.prepare(`DELETE FROM push_subscriptions WHERE NOT EXISTS(
    SELECT 1 FROM sessions s WHERE s.token_hash=push_subscriptions.session_token_hash AND s.user_id=push_subscriptions.user_id AND s.expires_at>?
  )`).run(new Date().toISOString()).changes);
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
  const r = db.prepare(`SELECT m.*, u.hid,u.display_name,u.avatar_url,u.is_admin FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(id) as any;
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
    const q=db.prepare(`SELECT m.id,m.type,m.body,m.file_id,m.deleted_at,u.hid,u.display_name,u.avatar_url,u.is_admin FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(Number(r.reply_to_id)) as any;
    if(q) replyTo={id:Number(q.id),sender:publicUser(q),type:q.type,body:q.deleted_at?null:(q.body??null),file:q.deleted_at?null:fileForMessage(q.file_id?Number(q.file_id):null),deletedAt:q.deleted_at?String(q.deleted_at):null};
  }
  const deletedAt=r.deleted_at?String(r.deleted_at):null;
  return { id:Number(r.id), conversationId:Number(r.conversation_id), sender:publicUser(r), type:r.type, body:deletedAt?null:(r.body ?? null), file:deletedAt?null:fileForMessage(r.file_id ? Number(r.file_id) : null), createdAt:String(r.created_at), editedAt:r.edited_at ?? null, deletedAt, replyTo, receipts, reactions, clientNonce:r.client_nonce?String(r.client_nonce):null };
}

export function createMessage(conversationId: number, senderId: number, body: string | null, fileId: number | null, clientNonce: string | null = null, replyToId: number | null = null): MessageView {
  const cleanBody=body?.trim() || null;
  if(cleanBody && cleanBody.length>16000) throw new Error('message_too_long');
  if(clientNonce){const existing=db.prepare('SELECT id FROM messages WHERE sender_id=? AND client_nonce=?').get(senderId,clientNonce) as any;if(existing)return messageById(Number(existing.id))!;}
  const file = fileId ? (db.prepare('SELECT mime_type FROM files WHERE id=? AND owner_id=?').get(fileId, senderId) as any) : null;
  if (fileId && !file) throw new Error('invalid_file');
  if (replyToId) {
    const reply=db.prepare('SELECT conversation_id,deleted_at FROM messages WHERE id=?').get(replyToId) as any;
    if(!reply || Number(reply.conversation_id)!==conversationId) throw new Error('invalid_reply');
  }
  const type = file ? (String(file.mime_type).startsWith('image/') ? 'image' : 'file') : 'text';
  const info = db.prepare('INSERT INTO messages(conversation_id,sender_id,type,body,file_id,client_nonce,reply_to_id) VALUES(?,?,?,?,?,?,?)').run(conversationId,senderId,type,cleanBody,fileId,clientNonce,replyToId);
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
  const clean=body.trim(); if(!clean) throw new Error('invalid_body'); if(clean.length>16000) throw new Error('message_too_long');
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

export function setDisplayName(userId:number, displayName:string): PublicUser {
  const d=String(displayName ?? '').trim();
  if(d.length<1 || d.length>64) throw new Error('invalid_display_name');
  if(displayNameInUse(d,userId)) throw new Error('display_name_exists');
  const info=db.prepare('UPDATE users SET display_name=? WHERE id=?').run(d,userId);
  if(!info.changes) throw new Error('not_found');
  return getUserById(userId)!;
}

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
           u.hid,u.display_name,u.avatar_url,u.is_admin,
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


export function searchMessages(userId:number,q:string,limit=50): MessageSearchResult[] {
  const term=q.trim(); if(!term) return [];
  const rows=db.prepare(`
    SELECT m.id FROM messages m
    JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
    WHERE m.deleted_at IS NULL AND m.body IS NOT NULL AND m.body LIKE ? COLLATE NOCASE
    ORDER BY m.id DESC LIMIT ?
  `).all(userId,`%${term}%`,Math.min(100,Math.max(1,limit))) as any[];
  return rows.map(r=>messageById(Number(r.id))).filter(Boolean).map(message=>({message:message!}));
}

export function isBlockedPair(a:number,b:number): boolean {
  return Boolean(db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(a,b,b,a));
}

export function listBlocked(userId:number): PublicUser[] {
  return (db.prepare('SELECT u.* FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=? AND u.disabled=0 ORDER BY u.display_name COLLATE NOCASE').all(userId) as any[]).map(publicUser);
}

export function blockUser(blockerId:number,blockedId:number): void {
  if(blockerId===blockedId||!getUserById(blockedId)) throw new Error('invalid_user');
  db.exec('BEGIN');
  try{
    db.prepare('INSERT OR IGNORE INTO blocks(blocker_id,blocked_id) VALUES(?,?)').run(blockerId,blockedId);
    db.prepare('DELETE FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)').run(blockerId,blockedId,blockedId,blockerId);
    db.prepare('DELETE FROM contact_requests WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)').run(blockerId,blockedId,blockedId,blockerId);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}

export function unblockUser(blockerId:number,blockedId:number): void {
  db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(blockerId,blockedId);
}

export function directConversationBlocked(conversationId:number,userId:number): boolean {
  const row=db.prepare("SELECT type FROM conversations WHERE id=?").get(conversationId) as any;
  if(!row||String(row.type)!=='direct') return false;
  const others=conversationMemberIds(conversationId).filter(id=>id!==userId);
  return others.some(id=>isBlockedPair(userId,id));
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
  const rows=(term?db.prepare(`SELECT u.* FROM users u LEFT JOIN user_privacy p ON p.user_id=u.id WHERE u.disabled=0 AND (u.id=? OR COALESCE(p.directory_visible,1)=1 OR EXISTS(SELECT 1 FROM contacts c WHERE c.user_id=? AND c.contact_id=u.id)) AND (u.display_name LIKE ? COLLATE NOCASE OR u.hid LIKE ? COLLATE NOCASE) ORDER BY u.display_name COLLATE NOCASE LIMIT 100`).all(userId,userId,like,like):db.prepare(`SELECT u.* FROM users u LEFT JOIN user_privacy p ON p.user_id=u.id WHERE u.disabled=0 AND (u.id=? OR COALESCE(p.directory_visible,1)=1 OR EXISTS(SELECT 1 FROM contacts c WHERE c.user_id=? AND c.contact_id=u.id)) ORDER BY u.display_name COLLATE NOCASE LIMIT 100`).all(userId,userId)) as any[];
  return rows.map(row=>{
    const u=publicUser(row); let relationship:DirectoryUser['relationship']='none';
    if(u.id===userId) relationship='self';
    else if(db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(userId,u.id)) relationship='blocked';
    else if(db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(userId,u.id)) relationship='contact';
    else if(db.prepare('SELECT 1 FROM contact_requests WHERE sender_id=? AND recipient_id=?').get(userId,u.id)) relationship='outgoing';
    else if(db.prepare('SELECT 1 FROM contact_requests WHERE sender_id=? AND recipient_id=?').get(u.id,userId)) relationship='incoming';
    return {...u,relationship};
  });
}

export function sendContactRequest(senderId:number,recipientId:number): void {
  if(senderId===recipientId) throw new Error('invalid_user');
  if(!getUserById(recipientId)) throw new Error('invalid_user');
  if(isBlockedPair(senderId,recipientId)) throw new Error('blocked');
  if(!canSendContactRequest(senderId,recipientId)) throw new Error('contact_requests_disabled');
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


export type PrivacySettings = {
  dmPolicy:'everyone'|'contacts'|'nobody';
  contactPolicy:'everyone'|'nobody';
  presencePolicy:'everyone'|'contacts'|'nobody';
  directoryVisible:boolean;
};

export type ServiceSettings = {
  registrationEnabled:boolean;
  inviteRequired:boolean;
  maxUploadBytes:number;
};

export type AdminUserView = PublicUser & { disabled:boolean; createdAt:string };

function ensurePrivacy(userId:number): void {
  db.prepare('INSERT OR IGNORE INTO user_privacy(user_id) VALUES(?)').run(userId);
}

export function getPrivacy(userId:number): PrivacySettings {
  ensurePrivacy(userId);
  const r=db.prepare('SELECT * FROM user_privacy WHERE user_id=?').get(userId) as any;
  return {
    dmPolicy:String(r.dm_policy) as PrivacySettings['dmPolicy'],
    contactPolicy:String(r.contact_policy) as PrivacySettings['contactPolicy'],
    presencePolicy:String(r.presence_policy) as PrivacySettings['presencePolicy'],
    directoryVisible:Boolean(r.directory_visible),
  };
}

export function setPrivacy(userId:number, next:Partial<PrivacySettings>): PrivacySettings {
  const cur=getPrivacy(userId);
  const dm=next.dmPolicy??cur.dmPolicy;
  const contact=next.contactPolicy??cur.contactPolicy;
  const presence=next.presencePolicy??cur.presencePolicy;
  const visible=next.directoryVisible??cur.directoryVisible;
  if(!['everyone','contacts','nobody'].includes(dm)) throw new Error('invalid_dm_policy');
  if(!['everyone','nobody'].includes(contact)) throw new Error('invalid_contact_policy');
  if(!['everyone','contacts','nobody'].includes(presence)) throw new Error('invalid_presence_policy');
  db.prepare('UPDATE user_privacy SET dm_policy=?,contact_policy=?,presence_policy=?,directory_visible=? WHERE user_id=?').run(dm,contact,presence,visible?1:0,userId);
  return getPrivacy(userId);
}

export function areContacts(a:number,b:number): boolean {
  return Boolean(db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(a,b));
}

export function canMessageUser(senderId:number,recipientId:number): boolean {
  if(senderId===recipientId) return true;
  if(!getUserById(recipientId)) return false;
  if(isBlockedPair(senderId,recipientId)) return false;
  // An accepted contact/chat request is explicit permission for the two users to DM.
  // This also prevents the initiator's restrictive default DM policy from making
  // an accepted request unusable in the reverse direction.
  if(areContacts(recipientId,senderId) || areContacts(senderId,recipientId)) return true;
  const p=getPrivacy(recipientId);
  if(p.dmPolicy==='nobody') return false;
  if(p.dmPolicy==='contacts') return false;
  return true;
}

export function canSendContactRequest(senderId:number,recipientId:number): boolean {
  if(senderId===recipientId || isBlockedPair(senderId,recipientId)) return false;
  return getPrivacy(recipientId).contactPolicy==='everyone';
}

export function canSeePresence(viewerId:number,subjectId:number): boolean {
  if(viewerId===subjectId) return true;
  if(isBlockedPair(viewerId,subjectId)) return false;
  const p=getPrivacy(subjectId);
  if(p.presencePolicy==='nobody') return false;
  if(p.presencePolicy==='contacts') return areContacts(subjectId,viewerId);
  return true;
}

export function directConversationPrivacyBlocked(conversationId:number,senderId:number): boolean {
  const row=db.prepare("SELECT type FROM conversations WHERE id=?").get(conversationId) as any;
  if(!row||String(row.type)!=='direct') return false;
  const others=conversationMemberIds(conversationId).filter(id=>id!==senderId);
  return others.some(id=>!canMessageUser(senderId,id));
}

export function setting(key:string, fallback=''): string {
  const row=db.prepare('SELECT value FROM server_settings WHERE key=?').get(key) as any;
  return row?String(row.value):fallback;
}

export function setSetting(key:string,value:string): void {
  db.prepare('INSERT INTO server_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
}

export function getServiceSettings(): ServiceSettings {
  return {
    registrationEnabled:setting('registration_enabled','0')==='1',
    inviteRequired:Boolean(setting('registration_invite_hash','')),
    maxUploadBytes:Math.max(1024,Number(setting('max_upload_bytes',String(config.maxUploadBytes)))||config.maxUploadBytes),
  };
}

export function updateServiceSettings(input:{registrationEnabled?:boolean;inviteHash?:string|null;maxUploadBytes?:number}): ServiceSettings {
  if(typeof input.registrationEnabled==='boolean') setSetting('registration_enabled',input.registrationEnabled?'1':'0');
  if(input.inviteHash!==undefined) setSetting('registration_invite_hash',input.inviteHash??'');
  if(input.maxUploadBytes!==undefined){
    const n=Math.floor(Number(input.maxUploadBytes));
    if(!Number.isFinite(n)||n<1024*1024||n>20*1024*1024*1024) throw new Error('invalid_upload_limit');
    setSetting('max_upload_bytes',String(n));
  }
  return getServiceSettings();
}

export function adminUsers(): AdminUserView[] {
  return (db.prepare('SELECT * FROM users ORDER BY created_at DESC,id DESC').all() as any[]).map(r=>({
    ...publicUser(r),disabled:Boolean(r.disabled),createdAt:String(r.created_at)
  }));
}

export function userExists(userId:number): boolean {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE id=?').get(userId));
}

export function setUserDisabled(userId:number,disabled:boolean): void {
  const result=db.prepare('UPDATE users SET disabled=? WHERE id=?').run(disabled?1:0,userId);
  if(!result.changes) throw new Error('not_found');
  if(disabled){db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(userId);db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);}
}

export function resetUserPassword(userId:number,password:string): void {
  if(typeof password!=='string' || password.length<8 || password.length>256) throw new Error('invalid_password');
  const result=db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),userId);
  if(!result.changes) throw new Error('not_found');
  db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(userId);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

export function pruneOrphanFiles(beforeIso:string): number {
  const rows=db.prepare(`
    SELECT f.id,f.stored_name FROM files f
    WHERE datetime(f.created_at) < datetime(?)
      AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.file_id=f.id)
      AND NOT EXISTS(SELECT 1 FROM users u WHERE u.avatar_url='/api/avatars/' || f.id)
  `).all(beforeIso) as any[];
  if(!rows.length)return 0;
  const del=db.prepare('DELETE FROM files WHERE id=?');
  let removed=0;
  for(const row of rows){
    try{fs.unlinkSync(path.join(config.uploadDir,String(row.stored_name)));}
    catch(e:any){if(e?.code!=='ENOENT')continue;}
    if(del.run(Number(row.id)).changes)removed++;
  }
  return removed;
}

export function storageStats(): {fileCount:number;bytes:number;messageCount:number;userCount:number} {
  const f=db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(size),0) AS bytes FROM files').get() as any;
  const m=db.prepare('SELECT COUNT(*) AS n FROM messages').get() as any;
  const u=db.prepare('SELECT COUNT(*) AS n FROM users').get() as any;
  return {fileCount:Number(f.n),bytes:Number(f.bytes),messageCount:Number(m.n),userCount:Number(u.n)};
}
