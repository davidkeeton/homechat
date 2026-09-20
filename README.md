# HomeChat

## v0.11.3 PWA / cross-platform test pass

HomeChat's existing React client is now installable as a Progressive Web App on supported browsers. The same UI continues to work as an ordinary web client.

- Web app manifest and install metadata
- Home-screen/app icons for Windows, Android and iOS
- Service worker with an offline app-shell cache (API and Socket.IO traffic are never cached)
- Standalone display mode and mobile safe-area handling
- `100dvh` mobile viewport handling
- Reconnect/refresh handling after sleep, app resume, focus and network return
- Optional built-in TLS mode for LAN PWA testing

### Test server

The current test host remains `192.168.98.43`. Because the web client and API are served by the same HomeChat process, there is no separate server-address setting in v0.11.

Ordinary browser use continues to work at:

    http://192.168.98.43:8092

Full PWA behavior (service worker/installability, microphone access, etc.) requires a trusted secure origin. For LAN testing, v0.11 includes an optional local TLS mode.

### LAN HTTPS for PWA testing

On the Docker host:

    cd ~/docker/homechat
    ./tools/create-test-tls.sh 192.168.98.43

This creates a local test CA and a server certificate under `/home/dkeeton/docker/appdata/homechat/tls`. Install `homechat-root-ca.crt` as a trusted root CA on each Windows/Android/iOS test device. Keep `homechat-root-ca.key` private on the server.

Then uncomment the `TLS_CERT_FILE`, `TLS_KEY_FILE`, and `/app/tls` lines in `docker-compose.yml`, rebuild, and use:

    https://192.168.98.43:8092

Windows/Android can then install HomeChat through the browser's Install/Add to Home Screen action. On iOS, open the HTTPS site in Safari and use Share -> Add to Home Screen.


Current version: **0.11.3** (mobile/offline message-send reliability fix).

A small self-hosted household messenger with direct/group chat, presence, reactions, attachments, voice snippets, Saved Messages, HIDs, contacts, and a searchable user directory.

## Version control

GitHub `main` is the current source of truth during active development. HomeChat does not currently maintain a separate long-lived development branch because there is no production user base yet. Each tested milestone should be committed with an explicit version and, when useful, tagged so it is easy to compare or roll back.

Recommended workflow:

```bash
# Development machine / repository clone
git status
git add .
git commit -m "HomeChat v0.11.3 chat request fixes"
git push origin main
```

On the Docker host, deploy exactly what is in GitHub:

```bash
cd ~/docker/homechat
git pull --ff-only
docker compose down
docker compose up -d --build
```

Before deploying, `git status` should normally report a clean working tree. Runtime data under `/home/dkeeton/docker/appdata/homechat` is deliberately outside the repository and must never be committed.

### Version numbering

HomeChat currently uses simple semantic-style milestone numbering:

- `0.x.0` — feature/milestone release, for example `0.11.0`
- `0.x.y` — bug-fix or stabilization update, for example `0.11.1`
- `1.0.0` — reserved for a later stable release once the protocol/data model and upgrade path are considered mature

Keep the application version synchronized in the server health response, package metadata, README, and release/tag name.

### Tagging a tested release

After a version has been built and smoke-tested:

```bash
git tag -a v0.11.3 -m "HomeChat v0.11.3"
git push origin v0.11.3
```

Tags are useful checkpoints even while development continues directly on `main`.

### Rollback

To inspect previous releases:

```bash
git tag --list
git log --oneline --decorate -20
```

To temporarily deploy a previous tagged version on the Docker host:

```bash
cd ~/docker/homechat
git fetch --tags
git checkout v0.11.1
docker compose down
docker compose up -d --build
```

To return to current development:

```bash
git checkout main
git pull --ff-only
docker compose down
docker compose up -d --build
```

Database migrations are forward-moving, so source rollback does **not** automatically roll the SQLite schema backward. Back up `/home/dkeeton/docker/appdata/homechat` before releases that include database migrations.

### Files that must stay out of Git

At minimum, keep these runtime/build artifacts ignored:

```text
node_modules/
dist/
client/dist/
.env
*.db
*.sqlite
*.sqlite3
uploads/
data/
appdata/
```

TLS private keys and local CA private keys must also stay outside the repository.


## v0.9 social + message interaction pass

- Contact list and contact requests
- Searchable user directory by name, username, or HID
- Reply/quote messages
- Edit your own text messages
- Soft-delete your own messages
- @username mention highlighting
- Existing realtime, optimistic-send, reactions, receipts, pagination, media/files/links inventory, and details UI remain intact

## Overview

A small self-hosted household messenger with a built-in web client. HomeChat is intentionally direct-message/group-chat first rather than a Teams/Discord-style workspace.

### Details & identity
- Reusable right-side Details / Media / Files / Links flyout
- HID moved into contact/profile details with one-click copy
- My Details panel with username, role and avatar change
- Contact details from the chat header
- Group details with rename, member list, add/remove member and leave-group controls
- Flyout closes on Escape, conversation change, or when returning to the chat

## Core features

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

## v0.10.1 stabilization

- Socket acknowledgement timeouts prevent messages from remaining stuck in `Sending…` forever.
- Client upload-size validation now follows the administrator-configured server limit instead of a hard-coded 100 MB value.
- Contact/block changes immediately refresh presence visibility for contacts-only privacy policies.
- Expired sessions and abandoned uploads older than 24 hours are pruned automatically.
- Account field validation is centralized and rejects whitespace-only/oversized account data.
- Admin user mutation paths now return proper not-found errors.
- API errors carry structured status/error codes, allowing stale sessions to return to login cleanly.
- Basic response hardening headers are enabled and the Express signature header is disabled.

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

## Interaction/responsiveness

- Optimistic local echo for outgoing messages with **Sending…**, failure state, and retry.
- Idempotent client nonces prevent duplicate messages when a retry races a lost acknowledgement.
- Emoji reactions with quick reactions and live updates across clients.
- Copy-text action on messages.
- Local unread-count reconciliation for active/inactive conversations without a full conversation refresh.
- In-memory authenticated attachment object-URL cache so scrolling does not repeatedly download the same media.
- No forwarding; message forwarding remains intentionally out of scope.


## v0.9 additions

- Global message search via the command palette (`Ctrl+K` / `Cmd+K`).
- IRC-inspired command palette: `/msg -friend`, `/msg -hid`, `/saved`, `/contacts`, `/help`.
- Persistent per-conversation drafts stored locally in the browser.
- Group mention autocomplete for `@username`.
- Block/unblock list with server-side enforcement for direct contact requests, direct-conversation creation, and direct messages.

## v0.10 identity, privacy and administration

v0.10 adds the service-management layer without changing HomeChat's direct/group-chat focus.

### Self-registration

Self-registration is disabled by default. Administrators can enable it from the Administration screen and optionally require an invite code. New self-registered accounts receive an HID automatically and are standard users.

### Privacy

Each user can manage privacy from **My Details**:

- Direct messages: Everyone / Contacts only / Nobody
- Contact requests: Everyone / Nobody
- Presence: Everyone / Contacts only / Nobody
- User-directory visibility

Direct-message and contact-request rules are enforced on the server, not only in the browser. Presence snapshots and updates respect presence visibility.

### Administration

Administrators now open a separate Administration screen instead of an admin modal inside chat. It includes:

- user, message, file and storage totals
- enable/disable self-registration
- optional registration invite code
- runtime server attachment-size limit
- create local users/admins
- enable/disable accounts
- reset user passwords and revoke their sessions

Disabled accounts have their sessions revoked and connected sockets are disconnected.

### Upload limit

`MAX_UPLOAD_BYTES` remains the initial default for a fresh database. Once changed from Administration, the database-backed value is used immediately for new uploads.


## v0.11.3 chat request fixes

- Incoming chat/contact requests now appear at the top of the normal conversation list instead of being buried in Contacts.
- Incoming requests expose Accept/Decline directly from the chat list.
- Accepting a request automatically creates/opens the direct conversation.
- Accepted contacts can always DM each other unless one user blocks the other; accepting the request is treated as explicit chat permission.
- Contact-request changes are pushed over Socket.IO so both clients refresh without requiring a manual reload.
- The restrictive DM privacy label is now **No new DMs** to reflect that accepted contacts remain allowed.

## v0.11.1 mobile navigation fix

- Adds persistent mobile bottom navigation for Chats, People, New, and Me.
- Adds a back button to active conversations on mobile.
- Contacts/directory and new-chat dialogs become full-screen mobile sheets.
- Adds a coarse-pointer/phone-screen fallback so Android phones still use the mobile shell if Chrome reports a desktop-sized layout viewport.


## v0.11.3 message-send reliability

- Message submission now uses the authenticated HTTP API rather than requiring a live Socket.IO acknowledgement.
- Socket.IO remains responsible for realtime incoming-message delivery, presence, typing, receipts and other live events.
- Recipients do not need to be online for a message to be accepted and stored by the server.
- Accepted contacts are recognized in either direction to tolerate legacy/asymmetric contact rows from earlier builds.
- The existing Socket.IO `message:send` handler remains available for backward compatibility with older clients.
