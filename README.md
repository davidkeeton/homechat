# HomeChat

A small self-hosted household messenger backend: direct messages, group chats, presence, typing, read/delivery receipts, file/image uploads, SQLite persistence, and Socket.IO realtime delivery.

## Why this shape

The project intentionally uses a small Kandan-like stack (Node/TypeScript/Express/Socket.IO/SQLite) and borrows local-first architectural ideas from LOAM while remaining original MIT-licensed code.

## Run with Docker

```bash
mkdir -p /home/dkeeton/docker/appdata/homechat
docker compose up -d --build
```

Server: `http://SERVER-IP:8092`

Health check:

```bash
curl http://localhost:8092/health
```

## First account

The first account becomes administrator:

```bash
curl -X POST http://localhost:8092/api/setup \
  -H 'Content-Type: application/json' \
  -d '{"username":"dave","displayName":"Dave","password":"change-this-password"}'
```

Save the returned token. Subsequent users are created by the admin using `POST /api/users`.

## REST API

- `POST /api/setup` first admin only
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/users`
- `POST /api/users` admin
- `GET /api/conversations`
- `POST /api/conversations/direct`
- `POST /api/conversations/group`
- `PATCH /api/conversations/:id/group` rename group
- `POST /api/conversations/:id/members` add member
- `DELETE /api/conversations/:id/members/:userId` remove member
- `GET /api/conversations/:id/messages`
- `POST /api/files` multipart field `file`
- `GET /api/files/:id`

## Socket.IO events

Client → server:

- `conversation:join`
- `message:send`
- `typing:set`
- `receipt:set`

Server → client:

- `message:new`
- `typing:update`
- `receipt:update`
- `presence:update`
- `presence:snapshot`

## Client integration

`sdk/homeClient.ts` is the boundary between the UI and the backend. The Retrogram-style React/Electron UI should call this adapter rather than importing Socket.IO throughout the component tree.

## v0.1 limitations

- No end-to-end encryption.
- No voice/video.
- No mobile push notifications.
- Group permissions are intentionally simple in v0.1: any current member can rename/add/remove members. Add group-owner/admin roles before Internet exposure.
- File downloads are limited to the uploader or a member of a conversation referencing the file.
- Intended for LAN/VPN use in this version.

## v0.2 browser client

The Docker image now builds and serves a React client from the same HomeChat service. After rebuilding, browse to:

    http://SERVER-IP:8092

Implemented in the first client pass:

- Username/password login and persistent browser session
- Direct conversations and group creation
- Conversation list and unread badges
- Realtime messages over Socket.IO
- Online/offline presence
- Typing indicators
- Drag-and-drop / picker file uploads
- Inline authenticated image previews
- Admin "add user" dialog
- Responsive WhatsApp/ICQ-style two-pane interface

Rebuild after pulling the v0.2 files:

    docker compose down
    docker compose up -d --build
