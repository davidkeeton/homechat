export type ConversationType = 'direct' | 'group';
export type MessageType = 'text' | 'image' | 'file';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export interface AuthUser extends PublicUser {
  disabled: boolean;
}

export interface ConversationSummary {
  id: number;
  type: ConversationType;
  name: string | null;
  avatarUrl: string | null;
  members: PublicUser[];
  unreadCount: number;
  lastMessage: MessageView | null;
}

export interface FileView {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface MessageView {
  id: number;
  conversationId: number;
  sender: PublicUser;
  type: MessageType;
  body: string | null;
  file: FileView | null;
  createdAt: string;
  editedAt: string | null;
}
