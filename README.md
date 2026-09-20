# HomeChat

HomeChat is a small self-hosted messenger for a household or other trusted private network. It provides direct messages, group chats, contacts, presence, file sharing, voice snippets, Saved Messages, and an installable web app for desktop and mobile.

**Current version:** `0.11.8`

HomeChat is designed for LAN/VPN use. It is not intended to be an Internet-scale public messaging service.

## Features

- Direct messages and group chats
- Permanent **HID** identity, for example `7A3F-19C2-B84D`
- Unique display names used for sign-in and display
- Saved Messages for private notes, links, images, and files
- Contacts and contact requests
- Searchable user directory by display name or HID
- Presence and typing indicators
- Delivered/read receipts
- Unread counts and unread-message divider
- Message history pagination
- Reactions
- Reply/quote, edit, and soft-delete for messages
- Clipboard image paste and drag/drop uploads
- Inline image, video, and audio playback
- Browser-recorded voice snippets
- Per-conversation Media / Files / Links views
- Link previews
- User avatars
- Privacy controls and block list
- Administration screen
- Installable PWA for Windows, Android, and iOS
- SQLite persistence
- Socket.IO realtime updates
- Docker deployment

## Identity and sign-in

HomeChat uses two identity fields:

- **Display name** — the human-readable name used to sign in and shown throughout the UI.
- **HID** — a permanent generated public identifier.

Display names are unique case-insensitively, so `Dave` and `dave` cannot both exist.

Users sign in with:

```text
Display name
Password
```

The HID does not change when a display name changes.

## Network layout

The default Docker deployment exposes two ports:

```text
http://SERVER-IP:8092
https://SERVER-IP:8093
```

### Port 8092 — HTTP bootstrap

Port `8092` is intentionally limited to setup/onboarding.

It provides:

- the HomeChat setup page
- the public HomeChat root CA certificate
- a link to the secure HomeChat site
- a health check

It does **not** serve login, chat, API, or Socket.IO traffic.

### Port 8093 — secure HomeChat

Port `8093` is the actual application.

It provides:

- login and registration
- REST API
- Socket.IO
- messages and attachments
- microphone access
- service worker
- installable PWA

## Quick start

### 1. Clone the repository

```bash
git clone https://github.com/davidkeeton/homechat.git
cd homechat
```

### 2. Create the appdata directory

```bash
mkdir -p /home/dkeeton/docker/appdata/homechat
```

The default Compose configuration persists HomeChat data there.

### 3. Generate the local TLS certificate

For the current test server:

```bash
./tools/create-test-tls.sh 192.168.98.43
```

The generated files are stored under:

```text
/home/dkeeton/docker/appdata/homechat/tls/
```

Expected files include:

```text
homechat.crt
homechat.key
homechat-root-ca.crt
homechat-root-ca.key
```

Private `.key` files must not be committed or exposed over HTTP.

### 4. Configure the bootstrap administrator

Create a local `.env` file beside `docker-compose.yml`:

```env
HOMECHAT_ADMIN_NAME=Dave
HOMECHAT_ADMIN_PASSWORD=choose-a-strong-password
```

`.env` is ignored by Git.

These values are **bootstrap-only**. HomeChat uses them only when the users table is empty. Once any user exists, changing these variables does not rename the administrator, reset a password, or create another user.

If the database is empty and only one of the two variables is set, HomeChat refuses to start rather than creating an incomplete account.

If neither variable is supplied, the first administrator can still be created through the fresh-install setup endpoint.

### 5. Build and start

```bash
docker compose up -d --build
```

Check startup:

```bash
docker compose ps
docker logs homechat --tail 50
```

Expected host ports:

```text
8092 -> HTTP bootstrap
8093 -> HTTPS HomeChat
```

## First connection from a phone or computer

Open:

```text
http://SERVER-IP:8092
```

Use **Install certificate** to download `homechat-root-ca.crt`.

Trust that certificate as a root CA on the device, then continue to:

```text
https://SERVER-IP:8093
```

Only the public root certificate is served by the bootstrap page. Private keys are never web-accessible.

### iOS

After installing the certificate, iOS may require explicit trust:

**Settings → General → About → Certificate Trust Settings**

Enable full trust for the HomeChat root certificate.

Then open the HTTPS HomeChat site in Safari.

To add HomeChat to the home screen:

**Share → Add to Home Screen**

### Android

Install the downloaded certificate as a trusted CA certificate, then open the HTTPS HomeChat site in Chrome.

Use:

**Chrome menu → Install app**

or **Add to Home screen**, depending on the browser/device.

### Windows

After trusting the HomeChat CA, open the HTTPS site in Edge or Chrome and use the browser's **Install app** option.

## Administration

Administrators have access to a separate Administration screen.

Current administration features include:

- user, message, file, and storage statistics
- enable/disable self-registration
- optional registration invite code
- attachment-size limit
- create users and administrators
- enable/disable accounts
- reset user passwords
- revoke sessions

Disabled users have their sessions revoked and active sockets disconnected.

## Self-registration

Self-registration is disabled by default.

Administrators can enable it from the Administration screen and optionally require an invite code.

Registration requires:

```text
Display name
Password
```

New accounts receive a generated HID automatically.

## Contacts and direct messages

Incoming contact/chat requests appear in the main Chats view rather than being hidden only inside Contacts.

Accepting a request creates or opens the direct conversation.

Accepted contacts can message each other even when the recipient is offline, unless one user has blocked the other.

Messages are submitted through the authenticated HTTP API and stored server-side. Socket.IO handles realtime delivery, presence, typing, receipts, and other live events.

## Privacy

Each user can configure:

- direct-message policy
- contact-request policy
- presence visibility
- directory visibility

Blocking is enforced server-side for contact requests and direct messaging.

## Files and media

HomeChat supports:

- file uploads
- image paste
- drag/drop upload
- inline images
- inline video
- inline audio
- voice snippets
- Media / Files / Links inventories

The upload limit starts from `MAX_UPLOAD_BYTES` and can later be changed from Administration.

## Voice snippets

Voice recording uses the browser `MediaRecorder` API.

Microphone capture requires a secure browser context, which is why the main HomeChat application is served over HTTPS.

## Saved Messages

Saved Messages is a private conversation with yourself for:

- notes
- links
- images
- files
- voice snippets

## Data and backups

Persistent data is stored under:

```text
/home/dkeeton/docker/appdata/homechat
```

This includes the SQLite database, uploads, and TLS material.

Back up that directory before making destructive database changes.

Example:

```bash
docker compose down

cp -a /home/dkeeton/docker/appdata/homechat       /home/dkeeton/docker/appdata/homechat-backup

docker compose up -d
```

## Updating

On the Docker host:

```bash
cd ~/docker/homechat
git pull --ff-only
docker compose down
docker compose up -d --build
```

Check the result:

```bash
docker compose ps
docker logs homechat --tail 50
```

## Health checks

HTTP bootstrap:

```bash
curl http://localhost:8092/health
```

Secure application:

```bash
curl --cacert /home/dkeeton/docker/appdata/homechat/tls/homechat-root-ca.crt   https://192.168.98.43:8093/health
```

## Version control

`main` is currently the active development branch and source of truth.

A typical development release:

```bash
git status
git add .
git commit -m "HomeChat v0.11.8"
git push origin main
```

After a release has been tested, it can be tagged:

```bash
git tag -a v0.11.8 -m "HomeChat v0.11.8"
git push origin v0.11.8
```

Versioning currently follows:

- `0.x.0` — feature or milestone release
- `0.x.y` — bug-fix or stabilization release
- `1.0.0` — reserved for a later stable release

## Files that must not be committed

Keep runtime data, secrets, and generated build artifacts out of Git.

At minimum:

```text
.env
node_modules/
dist/
client/dist/
*.db
*.sqlite
*.sqlite3
uploads/
data/
appdata/
*.key
*.pem
*.p12
*.pfx
```

Public certificate files can be shared when required, but private server keys and private CA keys must remain private.

## Notable API endpoints

```text
POST /api/setup
POST /api/auth/login
POST /api/auth/logout
GET  /api/me
GET  /api/users
POST /api/users
GET  /api/conversations
POST /api/conversations/self
POST /api/conversations/direct
POST /api/conversations/group
GET  /api/conversations/:id/messages
GET  /api/conversations/:id/inventory
POST /api/files
GET  /api/files/:id
GET  /api/link-preview?url=...
```

`POST /api/setup` is only available while the database has no users.

## Security notes

HomeChat is intended for trusted LAN/VPN environments.

Current protections include:

- authenticated API access
- server-side privacy/block enforcement
- session revocation
- attachment-size enforcement
- basic HTTP hardening headers
- link-preview SSRF restrictions
- separation of HTTP certificate bootstrap from the HTTPS application

HomeChat does **not** currently provide:

- end-to-end encryption
- Internet-scale abuse protection
- native mobile push notifications
- voice/video calling

Do not expose HomeChat directly to the public Internet without additional review and hardening.

## Troubleshooting

### Container exits with `legacy_username_database`

The current identity model no longer uses the old username-based schema.

For a disposable pre-production database, stop HomeChat, back up appdata, and remove the old SQLite database:

```bash
docker compose down

cp -a /home/dkeeton/docker/appdata/homechat       /home/dkeeton/docker/appdata/homechat-backup-pre-v0.11.5

rm -f /home/dkeeton/docker/appdata/homechat/homechat.db*

docker compose up -d --build
```

Do not use this procedure on a database whose data must be preserved.

### HTTPS certificate error

Confirm:

1. the TLS files exist under `/home/dkeeton/docker/appdata/homechat/tls/`
2. the HomeChat root CA is installed and trusted on the client
3. the certificate was generated for the IP/hostname being used
4. the secure site is being opened on port `8093`

### No administrator exists

On a fresh database, set:

```env
HOMECHAT_ADMIN_NAME=Dave
HOMECHAT_ADMIN_PASSWORD=choose-a-strong-password
```

and restart HomeChat.

If no bootstrap variables are configured and the database is still empty, `/api/setup` can be used once to create the first administrator.
