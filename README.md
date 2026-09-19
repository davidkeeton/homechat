# HomeChat

A small self-hosted household messenger with direct/group chat, presence, reactions, attachments, voice snippets, Saved Messages, HIDs, contacts, and a searchable user directory.

## v0.8 social + message interaction pass

- Contact list and contact requests
- Searchable user directory by name, username, or HID
- Reply/quote messages
- Edit your own text messages
- Soft-delete your own messages
- @username mention highlighting
- Existing realtime, optimistic-send, reactions, receipts, pagination, media/files/links inventory, and details UI remain intact

# HomeChat

A small self-hosted household messenger with a built-in web client. HomeChat is intentionally direct-message/group-chat first rather than a Teams/Discord-style workspace.

### Details & identity
- Reusable right-side Details / Media / Files / Links flyout
- HID moved into contact/profile details with one-click copy
- My Details panel with username, role and avatar change
- Contact details from the chat header
- Group details with rename, member list, add/remove member and leave-group controls
- Flyout closes on Escape, conversation change, or when returning to the chat

## v0.7 features

- Direct messages and group chats
- **HID**: permanent public hexadecimal identity such as `7A3F-19C2-B84D`
- **Saved Messages**: a private chat with yourself for notes, links, images and files
- Presence, typing indicators and unread counts
- **Message history pagination**: older messages load as you scroll to the top without jumping the viewport
- **Delivered/read state** on sent messages, including group read counts
- Auto-growing message composer
- Date separators and an unread-message divider
- Reconnect/offline status feedback
- Unified non-blocking error toasts instead of browser `alert()` dialogs
- Drag/drop file and image uploads
- Clipboard image paste
- User avatars
- Inline images, video and audio playback
- **Voice snippets** recorded in the browser (requires HTTPS or localhost for microphone access in modern browsers)
- Per-conversation **Media / Files / Links** inventory
- Clickable hyperlinks and cached Open Graph/title link previews
- SQLite persistence and Socket.IO realtime delivery
- Docker deployment

## Run with Docker

```bash
mkdir -p /home/dkeeton/docker/appdata/homechat
docker compose up -d --build
```

Server and web client:

```text
http://SERVER-IP:8092
```

Health check:

```bash
curl http://localhost:8092/health
```

Existing databases are upgraded automatically on startup. Existing users without an HID are assigned one automatically.

## First account

The first account becomes administrator:

```bash
curl -X POST http://localhost:8092/api/setup \
  -H 'Content-Type: application/json' \
  -d '{"username":"dave","displayName":"Dave","password":"change-this-password"}'
```

The response contains the user's generated HID and session token.

## Notable REST API

- `POST /api/setup` first admin only
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/users`
- `POST /api/users` admin
- `GET /api/conversations`
- `POST /api/conversations/self` Saved Messages
- `POST /api/conversations/direct`
- `POST /api/conversations/group`
- `GET /api/conversations/:id/messages`
- `GET /api/conversations/:id/inventory`
- `POST /api/files`
- `GET /api/files/:id`
- `GET /api/link-preview?url=...`

## Link previews

Link preview requests are fetched server-side and cached in SQLite. HomeChat only accepts HTTP/HTTPS destinations on standard web ports and rejects loopback, private, link-local and `.local` destinations to reduce SSRF risk.

## Voice snippets

The web client uses the browser `MediaRecorder` API. Browsers normally allow microphone capture only in a secure context, so recording works over HTTPS or when accessing HomeChat from `localhost`. Uploaded audio files work over ordinary HTTP as well.

## Data

The Compose file persists the database and uploads at:

```text
/home/dkeeton/docker/appdata/homechat
```

Back up that directory to preserve users, messages and files.

## Current scope

HomeChat is intended for LAN/VPN use. It does not currently provide end-to-end encryption, Internet-scale abuse controls, native mobile push notifications, or voice/video calling.

## v0.7 interaction/responsiveness pass

- Optimistic local echo for outgoing messages with **Sending…**, failure state, and retry.
- Idempotent client nonces prevent duplicate messages when a retry races a lost acknowledgement.
- Emoji reactions with quick reactions and live updates across clients.
- Copy-text action on messages.
- Local unread-count reconciliation for active/inactive conversations without a full conversation refresh.
- In-memory authenticated attachment object-URL cache so scrolling does not repeatedly download the same media.
- No forwarding; message forwarding remains intentionally out of scope.
