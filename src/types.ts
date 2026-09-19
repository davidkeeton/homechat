export type ConversationType = 'direct' | 'group';
export type MessageType = 'text' | 'image' | 'file';

export interface PublicUser {
  id: number;
  hid: string;
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
  isSelf: boolean;
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

export interface MessageReceiptView {
  userId: number;
  deliveredAt: string | null;
  readAt: string | null;
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
  receipts: MessageReceiptView[];
}

export interface InventoryAttachment {
  messageId: number;
  sender: PublicUser;
  file: FileView;
  createdAt: string;
}

export interface InventoryLink {
  messageId: number;
  sender: PublicUser;
  url: string;
  createdAt: string;
}

export interface ConversationInventory {
  media: InventoryAttachment[];
  files: InventoryAttachment[];
  links: InventoryLink[];
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  hostname: string;
}
