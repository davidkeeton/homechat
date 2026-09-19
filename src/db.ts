import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { hashPassword, hashToken, newSessionToken } from './security.js';
import type { ConversationSummary, MessageView, PublicUser } from './types.js';

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
CREATE TABLE IF NOT EXISTS message_receipts (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TEXT,
  read_at TEXT,
  PRIMARY KEY(message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
`);

function publicUser(row: any): PublicUser {
  return {
    id: Number(row.id),
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
  const info = db.prepare(`INSERT INTO users(username,display_name,password_hash,is_admin) VALUES(?,?,?,?)`)
    .run(username.trim(), displayName.trim(), hashPassword(password), isAdmin ? 1 : 0);
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
  const r = db.prepare(`SELECT m.*, u.username,u.display_name,u.avatar_url,u.is_admin FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?`).get(id) as any;
  if (!r) return null;
  return { id:Number(r.id), conversationId:Number(r.conversation_id), sender:publicUser(r), type:r.type, body:r.body ?? null, file:fileForMessage(r.file_id ? Number(r.file_id) : null), createdAt:String(r.created_at), editedAt:r.edited_at ?? null };
}

export function createMessage(conversationId: number, senderId: number, body: string | null, fileId: number | null): MessageView {
  const file = fileId ? (db.prepare('SELECT mime_type FROM files WHERE id=? AND owner_id=?').get(fileId, senderId) as any) : null;
  if (fileId && !file) throw new Error('invalid_file');
  const type = file ? (String(file.mime_type).startsWith('image/') ? 'image' : 'file') : 'text';
  const info = db.prepare('INSERT INTO messages(conversation_id,sender_id,type,body,file_id) VALUES(?,?,?,?,?)').run(conversationId,senderId,type,body?.trim() || null,fileId);
  const messageId = Number(info.lastInsertRowid);
  for (const uid of conversationMemberIds(conversationId)) {
    db.prepare('INSERT OR IGNORE INTO message_receipts(message_id,user_id) VALUES(?,?)').run(messageId,uid);
  }
  return messageById(messageId)!;
}

export function history(conversationId: number, beforeId: number | null, limit = 50): MessageView[] {
  const rows = beforeId
    ? db.prepare('SELECT id FROM messages WHERE conversation_id=? AND id<? ORDER BY id DESC LIMIT ?').all(conversationId,beforeId,limit)
    : db.prepare('SELECT id FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?').all(conversationId,limit);
  return (rows as any[]).reverse().map(r => messageById(Number(r.id))!);
}

export function markReceipt(messageId: number, userId: number, kind: 'delivered'|'read'): void {
  const col = kind === 'read' ? 'read_at' : 'delivered_at';
  db.prepare(`UPDATE message_receipts SET ${col}=? WHERE message_id=? AND user_id=?`).run(new Date().toISOString(),messageId,userId);
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
  const rows = db.prepare(`SELECT c.* FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE cm.user_id=? ORDER BY c.id DESC`).all(userId) as any[];
  return rows.map(c => {
    const members = (db.prepare(`SELECT u.* FROM users u JOIN conversation_members cm ON cm.user_id=u.id WHERE cm.conversation_id=? ORDER BY u.display_name`).all(c.id) as any[]).map(publicUser);
    const lm = db.prepare('SELECT id FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1').get(c.id) as any;
    const unread = db.prepare(`SELECT COUNT(*) AS n FROM message_receipts mr JOIN messages m ON m.id=mr.message_id WHERE mr.user_id=? AND m.conversation_id=? AND mr.read_at IS NULL AND m.sender_id<>?`).get(userId,c.id,userId) as any;
    return { id:Number(c.id), type:c.type, name:c.name ?? null, avatarUrl:c.avatar_url ?? null, members, unreadCount:Number(unread.n), lastMessage:lm ? messageById(Number(lm.id)) : null };
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
