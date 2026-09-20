# HomeChat

## v0.11.8 bootstrap administrator environment variables

Fresh installations can now create the first administrator automatically from local environment variables. This is intentionally bootstrap-only: once any user exists, the variables are ignored and can never overwrite an existing account or password.

- `HOMECHAT_ADMIN_NAME` sets the first administrator display name
- `HOMECHAT_ADMIN_PASSWORD` sets the first administrator password
- `.env` remains local and ignored by Git
- `.env.example` documents the two variables without containing a real secret
- `/api/setup` remains available only as a fresh-database fallback

HomeChat now uses a single human-readable account name plus a permanent generated HID. The separate username field has been removed.

- Register and sign in with **Display name + password**
- Display names are unique case-insensitively (`Dave` and `dave` cannot both exist)
- HID remains the permanent public identity
- Display-name changes are checked against the same uniqueness rule
- Admin-created users also need only display name + password
- Directory search uses display name or HID

The PWA/mobile work from v0.11.x remains unchanged:

- Web app manifest and install metadata
- Home-screen/app icons for Windows, Android and iOS
- Service worker with an offline app-shell cache (API and Socket.IO traffic are never cached)
- Standalone display mode and mobile safe-area handling
- `100dvh` mobile viewport handling
- Reconnect/refresh handling after sleep, app resume, focus and network return
- Optional built-in TLS mode for LAN PWA testing

### Test server

The current test host is `192.168.98.43`. HomeChat separates bootstrap/onboarding from the secure application:

    http://192.168.98.43:8092

Port **8092** is HTTP bootstrap only. It serves a small setup page, the public HomeChat root CA certificate, and a health check. It does **not** serve the login form, API, or Socket.IO.

    https://192.168.98.43:8093

Port **8093** is the actual HomeChat application: login, registration, REST API, Socket.IO, attachments, microphone access, service worker and installable PWA.

### LAN HTTPS / certificate onboarding

On the Docker host, generate the test CA and server certificate once:

    cd ~/docker/homechat
    ./tools/create-test-tls.sh 192.168.98.43

The generated files live outside Git under:

    /home/dkeeton/docker/appdata/homechat/tls/

The tracked `docker-compose.yml` now mounts the normal appdata directory and starts both listeners automatically. No local Compose override is required. The relevant files are read inside the container as:

    /app/data/tls/homechat.crt
    /app/data/tls/homechat.key
    /app/data/tls/homechat-root-ca.crt

On a new phone or computer, first open:

    http://192.168.98.43:8092

Tap **Install certificate**, install/trust `homechat-root-ca.crt` as a root CA, then tap **Continue to secure HomeChat**. That button opens:

    https://192.168.98.43:8093

Only the public root certificate is exposed by the HTTP bootstrap service. `homechat.key` and `homechat-root-ca.key` are never served.

Once HTTPS is trusted, Windows/Android can install HomeChat through the browser's Install/Add to Home Screen action. On iOS, open the HTTPS site in Safari and use Share -> Add to Home Screen.


Current version: **0.11.8** (HTTP bootstrap on 8092, secure HomeChat on 8093).

A small self-hosted household messenger with direct/group chat, presence, reactions, attachments, voice snippets, Saved Messages, HIDs, contacts, and a searchable user directory.

## Version control

GitHub `main` is the current source of truth during active development. HomeChat does not currently maintain a separate long-lived development branch because there is no production user base yet. Each tested milestone should be committed with an explicit version and, when useful, tagged so it is easy to compare or roll back.

Recommended workflow:

```bash
# Development machine / repository clone
git status
git add .
git commit -m "HomeChat v0.11.8 bootstrap administrator environment variables"
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
git tag -a v0.11.8 -m "HomeChat v0.11.8"
git push origin v0.11.8
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
- Searchable user directory by display name or HID
- Reply/quote messages
- Edit your own text messages
- Soft-delete your own messages
- display-name mention highlighting
- Existing realtime, optimistic-send, reactions, receipts, pagination, media/files/links inventory, and details UI remain intact

## Overview

A small self-hosted household messenger with a built-in web client. HomeChat is intentionally direct-message/group-chat first rather than a Teams/Discord-style workspace.

### Details & identity
- Reusable right-side Details / Media / Files / Links flyout
- HID moved into contact/profile details with one-click copy
- My Details panel with HID, role, display-name edit and avatar change
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

Bootstrap / certificate setup:

```text
http://SERVER-IP:8092
```

Secure HomeChat app:

```text
https://SERVER-IP:8093
```

Bootstrap health check:

```bash
curl http://localhost:8092/health
```

Secure app health check (after the CA is trusted by curl/system):

```bash
curl --cacert /home/dkeeton/docker/appdata/homechat/tls/homechat-root-ca.crt https://192.168.98.43:8093/health
```

**v0.11.5 intentionally does not migrate the old username-based user schema.** Before first start of this version, stop HomeChat, back up the appdata folder, then remove the pre-production SQLite database:

```bash
docker compose down
cp -a /home/dkeeton/docker/appdata/homechat /home/dkeeton/docker/appdata/homechat-backup-pre-v0.11.5
rm /home/dkeeton/docker/appdata/homechat/homechat.db*
docker compose up -d --build
```

HomeChat will create a fresh database using unique display names and HIDs. TLS files and uploads under the appdata directory are not removed by the database reset.

## First administrator

The preferred first-run setup is a local `.env` file beside `docker-compose.yml`:

```env
HOMECHAT_ADMIN_NAME=Dave
HOMECHAT_ADMIN_PASSWORD=choose-a-strong-password
```

`docker-compose.yml` passes these values into the container. They are **bootstrap-only**: HomeChat checks them only when the users table is empty. If any user already exists, both variables are ignored. Updating `.env` later therefore does not rename the administrator, reset a password, or create a duplicate user.

`.env` is ignored by Git. `.env.example` is included as a template and contains no real secret.

On a completely fresh database, startup creates the configured display name as the first administrator and generates its HID normally. HomeChat never logs the bootstrap password.

If the variables are omitted, `/api/setup` remains available while the users table is empty as a manual fallback:

```bash
curl --cacert /home/dkeeton/docker/appdata/homechat/tls/homechat-root-ca.crt -X POST https://192.168.98.43:8093/api/setup \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"Dave","password":"change-this-password"}'
```

If only one of `HOMECHAT_ADMIN_NAME` or `HOMECHAT_ADMIN_PASSWORD` is provided on an empty database, HomeChat fails startup with a clear configuration error rather than creating a partial account.

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
- Group mention autocomplete using display names.
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


## v0.11.4 certificate onboarding

- Plain-HTTP login page shows a **Secure HomeChat setup** banner.
- **Install certificate** downloads the public HomeChat root CA from `/homechat-root-ca.crt`.
- The route reads the certificate from `tls/homechat-root-ca.crt` under the existing appdata directory (`/app/data/tls/homechat-root-ca.crt` in the container).
- The route exposes only the public `.crt`; private `.key` files are not web-accessible.
- TLS server certificate/key paths in the sample Compose file now use the existing appdata mount (`/app/data/tls/...`) rather than requiring a second volume mount.
