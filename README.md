# HomeChat

HomeChat is a self-hosted messenger for a household or other trusted private network. It provides direct and group messaging, contacts, presence, attachments, Saved Messages, background notifications, an installable PWA, and a native Windows client.

**Current version:** `0.15.2`

HomeChat is intended primarily for LAN/VPN use. It is not intended to be exposed directly to the public Internet without additional review and hardening.

## Features

- Direct messages and group chats
- Permanent HID identity, for example `7A3F-19C2-B84D`
- Unique display-name sign-in
- Saved Messages
- Contacts and contact requests
- Searchable user directory by display name or HID
- Presence and typing indicators
- Delivered/read receipts and unread counts
- Distinct unread mention indicators
- Message history pagination
- Reactions, replies, edit, and soft-delete
- Per-user **Delete chat** history clearing
- Image paste and drag/drop uploads
- Authenticated file downloads
- Inline image, video, and audio playback
- Browser-recorded voice snippets
- Group and user avatars
- Per-conversation Media / Files / Links views
- Link previews
- Styled fenced code and log blocks
- Dark and light color-scheme support
- Privacy controls and block list
- Administration screen
- Installable PWA for Windows, Android, and iOS
- Native Windows desktop client with system tray and native notifications
- Windows-client download links on the sign-in and certificate/bootstrap pages
- Web Push notifications for installed/backgrounded web clients
- SQLite persistence
- Socket.IO realtime updates
- Docker deployment
- Experimental Xbox Game Bar client under `gamebar/`

## Network layout

The default deployment exposes:

```text
http://SERVER:8092
https://SERVER:8093
```

### Port 8092 — bootstrap/onboarding

Provides:

- certificate-install page
- `homechat-root-ca.crt`
- Windows client download link
- link to secure HomeChat
- `/health`

It does not serve login, chat, API, or Socket.IO traffic.

### Port 8093 — secure HomeChat

Provides the application, REST API, Socket.IO, attachments, authenticated downloads, service worker, Web Push registration, PWA functionality, and the Windows client download route.

## Quick start

### 1. Clone

```bash
git clone https://github.com/davidkeeton/homechat.git
cd homechat
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set the address clients will use:

```env
HOMECHAT_HOST=192.168.1.50
HOMECHAT_HTTP_PORT=8092
HOMECHAT_HTTPS_PORT=8093
HOMECHAT_ADMIN_NAME=Admin
HOMECHAT_ADMIN_PASSWORD=choose-a-strong-password
```

`HOMECHAT_HOST` is used when generating the HTTPS certificate, so it should match the IP address or hostname users enter in their browser.

### 3. Start

```bash
docker compose up -d --build
```

Check startup:

```bash
docker compose ps
docker logs homechat --tail 100
```

On first start, HomeChat creates its local CA and server certificate automatically inside the persistent data volume.

### 4. Trust the HomeChat CA

Open:

```text
http://SERVER:8092
```

Download and trust the HomeChat root certificate, then continue to:

```text
https://SERVER:8093
```

Only the public CA certificate is exposed by the bootstrap server. Private keys are never served.

## Persistent data

The default Compose configuration uses the Docker-managed volume:

```text
homechat-data
```

It is mounted inside the container at:

```text
/app/data
```

This contains the SQLite database, uploads, TLS material, VAPID keys, and optionally a locally hosted Windows installer.

Docker manages the host-side storage location, so HomeChat does not require a specific user's home directory.

### Optional bind mount

If you prefer a specific host path, set `HOMECHAT_DATA_PATH` in `.env`:

```env
HOMECHAT_DATA_PATH=/srv/homechat
```

Use the same path consistently so HomeChat continues using the same database, uploads, certificates, push identity, and downloads.

## Automatic TLS

By default:

```env
HOMECHAT_AUTO_TLS=true
```

If certificates do not exist, HomeChat generates:

```text
/app/data/tls/homechat-root-ca.crt
/app/data/tls/homechat-root-ca.key
/app/data/tls/homechat.crt
/app/data/tls/homechat.key
```

The server certificate includes `HOMECHAT_HOST`, plus localhost/127.0.0.1, in its Subject Alternative Names.

Existing certificates are reused.

To manage certificates yourself:

```env
HOMECHAT_AUTO_TLS=false
```

Then provide the expected certificate/key files in the data directory or override their paths with the corresponding environment variables.

## First administrator

On an empty database, HomeChat can create the first administrator from:

```env
HOMECHAT_ADMIN_NAME=Admin
HOMECHAT_ADMIN_PASSWORD=choose-a-strong-password
```

These settings are bootstrap-only. Once any user exists, they are ignored and cannot rename an account or reset its password.

For secret-file based deployments:

```env
HOMECHAT_ADMIN_NAME=Admin
HOMECHAT_ADMIN_PASSWORD_FILE=/run/secrets/homechat_admin_password
```

The password file takes precedence over `HOMECHAT_ADMIN_PASSWORD`.

If no bootstrap administrator is configured, `/api/setup` remains available only while the user table is empty.

## Identity and sign-in

A HomeChat account has:

- **Display name** — used for sign-in and shown in the UI
- **HID** — permanent generated public identity

Display names are unique case-insensitively. The HID remains unchanged if a display name changes.

## Attachments and downloads

Uploads are written into the persistent upload directory and stored in SQLite by metadata/reference.

File retrieval is authenticated. The web client fetches attachments with the active bearer token, waits for the blob to complete, then creates the browser download. This prevents empty placeholder downloads while a blob URL is still being prepared.

The configured upload limit is visible to clients and can be changed by an administrator.

## Delete chat

**Delete chat** is per-user history clearing. It does not erase another user's copy of the conversation.

When a user deletes a chat:

- their visible history is cleared through the current message
- the conversation is hidden for that user
- the other participant's history is unchanged
- a new incoming message can make the conversation visible again
- messages cleared by that user remain hidden from that user

Leaving a group and deleting a group-chat history remain separate actions.

## Background notifications

HomeChat supports standards-based Web Push in addition to realtime Socket.IO delivery.

- Messages are stored in SQLite first.
- Socket.IO handles realtime message/presence/typing updates.
- Web Push notifies closed/background web clients.
- Push subscriptions are per user, session, and device.
- Active-device push is suppressed while other subscribed devices may still receive it.
- Expired push subscriptions are removed automatically.

VAPID keys are generated once and persisted at:

```text
/app/data/push/vapid.json
```

Back this file up with the rest of HomeChat appdata.

Optional VAPID contact identity:

```env
HOMECHAT_VAPID_SUBJECT=mailto:homechat@example.invalid
```

The HomeChat server needs outbound HTTPS access to browser push services.

## Windows desktop client

HomeChat includes a Tauri-based Windows client under:

```text
desktop/
```

It reuses the React UI and connects to the same HomeChat API and Socket.IO service.

The first time the desktop client starts, enter the secure HomeChat server address, for example:

```text
https://192.168.1.50:8093
```

The HomeChat CA certificate must already be trusted by Windows. The desktop client does not bypass TLS validation.

Closing the main window hides HomeChat to the Windows system tray. Use **Quit HomeChat** from the tray menu to exit completely.

### Manual GitHub Actions build

Windows builds are intentionally **on demand**. They do not run on every push.

Open:

```text
GitHub → Actions → Build Windows client → Run workflow
```

The workflow:

1. verifies version consistency
2. builds the Tauri Windows client
3. uploads the `.exe` and `.msi` as workflow artifacts
4. updates the `windows-client-latest` GitHub release
5. publishes the predictable filename `HomeChat-Windows-Setup.exe`

### Windows download link

HomeChat serves this route from both the bootstrap and secure servers:

```text
/downloads/HomeChat-Windows-Setup.exe
```

If this local file exists:

```text
/app/data/downloads/HomeChat-Windows-Setup.exe
```

HomeChat serves it directly.

Otherwise it redirects to:

```text
https://github.com/davidkeeton/homechat/releases/download/windows-client-latest/HomeChat-Windows-Setup.exe
```

Override the fallback URL with:

```env
HOMECHAT_WINDOWS_CLIENT_URL=https://example.invalid/HomeChat-Windows-Setup.exe
```

For a bind-mounted installation, the local installer would normally be placed at:

```text
HOMECHAT_DATA_PATH/downloads/HomeChat-Windows-Setup.exe
```

## Build the Windows client locally

On Windows, install the Microsoft C++ build tools, WebView2, Rust, and Node.js.

```powershell
npm install --prefix client
npm install --prefix desktop
npm --prefix desktop run build
```

Installers are produced under:

```text
desktop/src-tauri/target/release/bundle/nsis/
desktop/src-tauri/target/release/bundle/msi/
```

Unsigned development builds may trigger Microsoft SmartScreen.

## Experimental Xbox Game Bar client

The repository includes an experimental UWP/XAML Game Bar client under:

```text
gamebar/
```

It is an alpha client and is not part of the normal Docker or Tauri build. See `gamebar/README.md` for Visual Studio requirements and current limitations.

## Administration

Administrators can:

- view user/message/file/storage statistics
- enable or disable self-registration
- require an optional invite code
- change the attachment-size limit
- create users and administrators
- enable or disable accounts
- reset passwords
- revoke sessions

## PWA and mobile installation

### iPhone/iPad

1. Open the HTTPS HomeChat site in Safari.
2. Tap **Share**.
3. Choose **Add to Home Screen**.

After installing the CA certificate, iOS may also require:

**Settings → General → About → Certificate Trust Settings → Full Trust**

### Android

Open the HTTPS site in Chrome and use **Install app** or **Add to Home screen**.

### Windows

Use the native HomeChat Windows client, or install the HTTPS site as a PWA from Edge/Chrome.

## Service-worker updates

The repository root `package.json` is the authoritative HomeChat version.

The client build generates `client/public/sw.js` from `client/sw.template.js` using that root version. Older `homechat-*` caches are removed when a new service worker activates.

Do not manually maintain the service-worker cache version.

## Version control and releases

`main` is the active development branch and source of truth.

HomeChat uses semantic versioning:

- bug fix: patch bump, for example `0.15.2 → 0.15.3`
- backward-compatible feature: minor bump, for example `0.15.x → 0.16.0`
- intentionally incompatible release: major bump when appropriate

### One authoritative version

The root `package.json` version is authoritative. The release tooling keeps these synchronized:

```text
package.json
client/package.json
desktop/package.json
desktop/src-tauri/Cargo.toml
desktop/src-tauri/tauri.conf.json
client/public/sw.js
README.md
```

The server `/health` value is read from the root package version at runtime.

### Change the version

From the repository root:

```bash
npm run version:set -- 0.15.3
```

Then verify all versioned files agree:

```bash
npm run version:check
```

Do not manually edit version strings in individual package/config files.

### Commit a release

After the change is tested:

```bash
git status
git add .
git commit -m "HomeChat v0.15.3"
git push origin main
```

Tag the exact tested commit:

```bash
git tag -a v0.15.3 -m "HomeChat v0.15.3"
git push origin v0.15.3
```

The Windows workflow remains manual even when a tag is pushed. Run it after the tagged commit is ready if a new Windows installer should be published.

## Updating an existing server

```bash
git pull --ff-only
docker compose down
docker compose up -d --build
```

Verify:

```bash
docker compose ps
curl http://SERVER:8092/health
curl https://SERVER:8093/health
```

The secure `curl` request requires the HomeChat CA to be trusted by that system.

## Backup

Back up persistent HomeChat data, including:

```text
/app/data/homechat.db
/app/data/uploads/
/app/data/tls/
/app/data/push/
/app/data/downloads/
```

For the default Docker volume:

```bash
docker volume inspect homechat_homechat-data
```

For a bind-mounted installation, back up the configured host data directory.

Stop HomeChat before taking a simple filesystem-level copy of the SQLite database if you want a consistent snapshot.

## Files that must not be committed

```text
.env
secrets/
node_modules/
dist/
data/
*.db
*.sqlite
*.sqlite3
*.key
*.pem
*.p12
*.pfx
desktop/src-tauri/target/
```

Private TLS keys, VAPID private keys, administrator secrets, databases, and runtime uploads must remain private.

## Security notes

HomeChat currently provides authenticated API access, server-side privacy/block enforcement, session revocation, upload limits, basic HTTP hardening, link-preview SSRF restrictions, HTTPS, and standards-based Web Push.

It does not currently provide:

- end-to-end encryption
- Internet-scale abuse protection
- native mobile push infrastructure
- voice/video calling

Do not expose HomeChat directly to the public Internet without additional review and hardening.

## Troubleshooting

### HomeChat looks like a fresh install

Check whether the deployment is using a different persistent volume or bind-mounted data path than before.

If using a bind mount, confirm `.env` contains the expected path:

```env
HOMECHAT_DATA_PATH=/path/to/existing/appdata
```

### HTTPS certificate name error

Confirm `HOMECHAT_HOST` matches the address used in the browser.

If the host changes after certificates have already been generated, regenerate the server certificate deliberately. Avoid deleting the root CA unless you intend to reinstall trust on every client.

### Windows installer link says no file

Run the manual **Build Windows client** GitHub Action at least once so the `windows-client-latest` release contains `HomeChat-Windows-Setup.exe`, or place a local copy at:

```text
/app/data/downloads/HomeChat-Windows-Setup.exe
```

### Downloaded chat attachment is empty

This release uses explicit authenticated blob downloads rather than clicking an empty placeholder URL. If a file still downloads as zero bytes, check the corresponding stored file in `/app/data/uploads/` and compare it with the size recorded in HomeChat.
