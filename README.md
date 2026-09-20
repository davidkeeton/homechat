# HomeChat

HomeChat is a small self-hosted messenger for a household or other trusted private network. It provides direct and group messaging, contacts, presence, attachments, voice snippets, Saved Messages, background notifications, and an installable PWA for desktop and mobile.

**Current version:** `0.15.0`

HomeChat is intended for LAN/VPN use. It is not designed to be exposed directly to the public Internet without additional hardening.

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
- Image paste and drag/drop uploads
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
- Native Windows desktop client with system tray and Windows notifications
- Web Push notifications for installed/backgrounded clients
- SQLite persistence
- Socket.IO realtime updates
- Docker deployment

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
- link to secure HomeChat
- `/health`

It does not serve login, chat, API, or Socket.IO traffic.

### Port 8093 — secure HomeChat

Provides the application, REST API, Socket.IO, attachments, service worker, Web Push registration, and PWA functionality.

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

This contains the SQLite database, uploads, TLS material, and VAPID keys used for Web Push.

Docker manages the host-side storage location, so HomeChat does not require a specific user's home directory.

### Optional bind mount

If you prefer a specific host path, set `HOMECHAT_DATA_PATH` in `.env`:

```env
HOMECHAT_DATA_PATH=/srv/homechat
```

Use the same path consistently so HomeChat continues using the same database, uploads, certificates, and push identity.

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

`tools/create-test-tls.sh` is also available for manual certificate creation.

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

## Background notifications

HomeChat supports standards-based Web Push in addition to realtime Socket.IO delivery.

When notifications are enabled, the browser creates a per-device push subscription and HomeChat stores it against the signed-in user and device.

- Messages remain stored in SQLite and delivered through the normal API/Socket.IO paths.
- Push is a notification channel, not the message transport.
- Active devices are excluded from redundant push notifications.
- Other subscribed devices can still be notified.
- Expired push subscriptions are removed automatically.
- Notification clicks open/focus HomeChat and select the relevant conversation.

VAPID keys are generated once and persisted at:

```text
/app/data/push/vapid.json
```

Back this file up with the rest of HomeChat appdata. Replacing the VAPID key pair requires clients to establish new push subscriptions.

Optional VAPID contact identity:

```env
HOMECHAT_VAPID_SUBJECT=mailto:homechat@example.invalid
```

The HomeChat server needs outbound HTTPS access to browser push services.

On iPhone and iPad, background Web Push requires HomeChat to be installed to the Home Screen and notification permission to be granted from the installed web app.


## Windows desktop client

HomeChat includes a Tauri-based Windows client in `desktop/`. It reuses the same React chat UI and connects to the same HomeChat server API and Socket.IO service.

The first time the desktop client starts, enter the secure HomeChat server address, for example:

```text
https://192.168.1.50:8093
```

The HomeChat CA certificate must already be trusted by Windows. The desktop client does not bypass TLS certificate validation.

Closing the main window hides HomeChat to the Windows system tray instead of terminating it. This keeps the Socket.IO connection alive so the desktop client can receive messages and display native Windows notifications while the window is hidden. Use **Quit HomeChat** from the tray menu to stop the client completely.

### Build locally on Windows

Tauri requires the Microsoft C++ build tools, WebView2, Rust, and Node.js. WebView2 is already present on current Windows versions.

Install the JavaScript dependencies:

```powershell
npm install --prefix client
npm install --prefix desktop
```

Build the Windows installers:

```powershell
npm --prefix desktop run build
```

Tauri produces NSIS (`-setup.exe`) and MSI installers under:

```text
desktop/src-tauri/target/release/bundle/nsis/
desktop/src-tauri/target/release/bundle/msi/
```

Unsigned development builds may trigger Microsoft SmartScreen. Code signing can be added later for public distribution.

### Build with GitHub Actions

The repository includes `.github/workflows/windows-client.yml`. Run **Build Windows client** manually from GitHub Actions, or push a version tag. The workflow builds both Windows installer formats and uploads them as artifacts. Tagged builds are also attached to the GitHub release.

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

Open the HTTPS site in Edge or Chrome and use the browser's **Install app** action.

## Service-worker updates

The client build generates `public/sw.js` from `sw.template.js` using the version in `client/package.json`.

The cache name is generated automatically from the application version. Older `homechat-*` caches are removed when a new service worker activates.

Do not manually maintain the cache version string.

## Offline behavior

The cached PWA shell can load without a network connection, but authentication requires the server.

When HomeChat is offline, the sign-in screen reports that the server must be reachable before signing in.

Offline message queuing is not currently implemented.

## Backup

Back up the persistent HomeChat data, including:

```text
/app/data/homechat.db
/app/data/uploads/
/app/data/tls/
/app/data/push/
```

For the default Docker volume:

```bash
docker volume inspect homechat_homechat-data
```

The exact Docker volume name may include the Compose project prefix.

For a bind-mounted installation, back up the configured host data directory.

Stop HomeChat before taking a filesystem-level copy of the SQLite database if you want a simple consistent backup.

## Updating

```bash
git pull --ff-only
docker compose down
docker compose up -d --build
```

Then verify:

```bash
docker compose ps
docker logs homechat --tail 100
```

## Health checks

Bootstrap:

```bash
curl http://SERVER:8092/health
```

Secure application after trusting the CA:

```bash
curl https://SERVER:8093/health
```

## Version control

`main` is the active development branch.

Typical release workflow:

```bash
git status
git add .
git commit -m "HomeChat v0.15.0"
git push origin main
```

After testing:

```bash
git tag -a v0.15.0 -m "HomeChat v0.15.0"
git push origin v0.15.0
```

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
```

Private TLS keys, VAPID private keys, and administrator secrets must remain private.

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

### No administrator exists

On an empty database, configure `HOMECHAT_ADMIN_NAME` plus either `HOMECHAT_ADMIN_PASSWORD` or `HOMECHAT_ADMIN_PASSWORD_FILE`, then restart.

`/api/setup` is also available until the first user is created.
