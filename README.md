# HomeChat

HomeChat is a small self-hosted messenger for a household or other trusted private network. It provides direct and group messaging, contacts, presence, attachments, voice snippets, Saved Messages, and an installable PWA for desktop and mobile.

**Current version:** `0.13.1`

HomeChat is intended for LAN/VPN use. It is not currently designed to be exposed directly to the public Internet.

## What v0.13.0 changes

v0.13.0 adds standards-based Web Push on top of the portable v0.12 deployment foundation.

- Push subscriptions are stored per signed-in user and device.
- VAPID keys are generated once and persisted under HomeChat appdata.
- Closed/background installed PWAs can receive message notifications through the browser/OS push service.
- Active Socket.IO devices are excluded from server push to avoid duplicate notifications on the same device.
- Other subscribed devices can still receive push even when one device is actively connected.
- Notification clicks focus/open HomeChat and select the relevant conversation.
- Expired push endpoints are removed automatically when a push service reports them gone.
- Push subscriptions are invalidated by logout/session expiry, account disable, and password reset.
- iPhone/iPad users are guided to install HomeChat to the Home Screen before enabling background notifications.
- The service-worker cache continues to be generated from the package version at build time.

Existing messages, users, uploads, TLS certificates, and normal Socket.IO delivery are unchanged. Web Push is an additional notification channel, not a replacement for message storage or realtime delivery.

## Features

- Direct messages and group chats
- Permanent HID identity, for example `7A3F-19C2-B84D`
- Unique display-name sign-in
- Saved Messages
- Contacts and contact requests
- Searchable user directory by display name or HID
- Presence and typing indicators
- Delivered/read receipts and unread counts
- Message history pagination
- Reactions, replies, edit, and soft-delete
- Image paste and drag/drop uploads
- Inline image, video, and audio playback
- Browser-recorded voice snippets
- Per-conversation Media / Files / Links views
- Link previews
- User avatars
- Privacy controls and block list
- Administration screen
- Installable PWA for Windows, Android, and iOS
- Web Push notifications that continue when the installed PWA is closed
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

- the certificate-install page
- `homechat-root-ca.crt`
- a link to secure HomeChat
- `/health`

It does not serve chat, login, API, or Socket.IO traffic.

### Port 8093 — secure HomeChat

Provides the actual application, REST API, Socket.IO, attachments, service worker, and PWA functionality.

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

Edit `.env` and set at least the address clients will use:

```env
HOMECHAT_HOST=192.168.1.50
HOMECHAT_HTTP_PORT=8092
HOMECHAT_HTTPS_PORT=8093
HOMECHAT_ADMIN_NAME=Admin
HOMECHAT_ADMIN_PASSWORD=choose-a-strong-password
```

`HOMECHAT_HOST` is used when generating the HTTPS certificate, so it should match the IP address or hostname users will enter in their browser.

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

This contains the SQLite database, uploads, and TLS material.

Docker manages the host-side storage location, so HomeChat no longer requires a specific user's home directory.

### Optional bind mount

If you prefer a specific host path, set `HOMECHAT_DATA_PATH` in `.env`:

```env
HOMECHAT_DATA_PATH=/srv/homechat
```

The same Compose file accepts either a Docker named volume or an absolute host path.

## Upgrading an existing installation

If the existing installation uses a host bind mount, keep using that same path during the v0.13.0 upgrade:

```env
HOMECHAT_DATA_PATH=/path/to/your/existing/homechat/appdata
```

Then deploy normally:

```bash
docker compose down
git pull --ff-only
docker compose up -d --build
```

Do **not** omit `HOMECHAT_DATA_PATH` on the first v0.13.0 start if the current installation relies on an existing bind-mounted database. If it is omitted, Docker creates/uses the new `homechat-data` volume and HomeChat will look like a fresh installation. The old bind-mounted files are not deleted.

After confirming the upgrade, you can continue using the bind path indefinitely or migrate the data into the named volume later.

## Automatic TLS

By default:

```env
HOMECHAT_AUTO_TLS=true
```

If the CA/server certificates do not exist, HomeChat generates:

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

and provide the expected certificate/key files in the data directory or override their paths with the corresponding environment variables.

`tools/create-test-tls.sh` remains available for manual certificate creation and no longer contains a user-specific output path.

## First administrator

On an empty database, HomeChat can create the first administrator from:

```env
HOMECHAT_ADMIN_NAME=Admin
HOMECHAT_ADMIN_PASSWORD=choose-a-strong-password
```

These settings are bootstrap-only. Once any user exists, they are ignored and cannot rename an account or reset its password.

For secret-file based deployments, set:

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


## Background notifications (Web Push)

HomeChat 0.13 adds standards-based Web Push. Messages are still stored in SQLite and delivered through the normal HomeChat API/Socket.IO paths; push is only a notification channel.

When a user enables notifications, the browser creates a per-device push subscription and HomeChat stores the subscription against that signed-in user and device. If that device has an active Socket.IO connection, HomeChat does not also push to the same device. Other subscribed devices can still receive background notifications.

VAPID keys are generated once on first startup and persisted under:

```text
/app/data/push/vapid.json
```

Back up this file with the rest of HomeChat appdata. Replacing the VAPID key pair requires clients to create new push subscriptions. The private key must never be committed or exposed.

The optional VAPID contact identity can be configured in `.env`:

```env
HOMECHAT_VAPID_SUBJECT=mailto:homechat@example.invalid
```

The HomeChat server needs outbound HTTPS access to browser push services. iPhone and iPad background push requires HomeChat to be added to the Home Screen and notification permission to be requested from the installed web app. iOS/iPadOS 16.4 or later supports this standards-based Web Push model.

Push subscriptions are tied to an authenticated session. Logging out removes the server-side association; the browser subscription can be reused after the next login. If logout happens while the server is unreachable, the client unsubscribes locally so a stale server record cannot continue delivering notifications. Expired/revoked sessions are not eligible for push, and disabling an account or resetting its password removes its stored push subscriptions.

## Administration

Administrators can:

- view user/message/file/storage statistics
- enable or disable self-registration
- require an optional invite code
- change the attachment-size limit
- create users/admins
- enable/disable accounts
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

Open the HTTPS site in Edge/Chrome and use the browser's **Install app** action.

## Service-worker updates

The client build generates `public/sw.js` from `sw.template.js` using the version in `client/package.json`.

For v0.13.0 the cache name is generated as:

```text
homechat-v0.13.0
```

When a new service worker activates, older `homechat-*` caches are removed automatically.

Do not manually maintain the cache version string.

## Notifications

Current notifications use the browser Notification API when a realtime message reaches the active HomeChat client.

That means notifications work while the PWA/browser is alive, but a fully suspended or closed PWA cannot currently be awakened for a new message.

Background Web Push (VAPID + push subscriptions + service-worker push handling) is planned separately. It is intentionally not part of the v0.13.0 portability release.

## Offline behavior

The cached PWA shell can load without a network connection, but authentication requires the server.

When HomeChat is offline, the sign-in screen now reports:

```text
HomeChat is offline. Reconnect before signing in.
```

Offline message queuing is not currently implemented.

## Backup

For a bind-mounted installation, back up the configured data directory.

For the default Docker volume, inspect it with:

```bash
docker volume inspect homechat_homechat-data
```

The exact Docker volume name may include the Compose project prefix.

Stop HomeChat before taking a filesystem-level copy of the SQLite database if you want a simple consistent backup.

## Updating

Upgrading an existing 0.12.x database to 0.13.0 is automatic. HomeChat adds the push-subscription table without resetting users, messages, uploads, sessions, or TLS material. VAPID keys are created separately under the existing appdata directory.


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
git commit -m "HomeChat v0.13.0 portable deployment"
git push origin main
```

After testing:

```bash
git tag -a v0.13.0 -m "HomeChat v0.13.0"
git push origin v0.13.0
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

Private TLS keys and administrator secrets must remain private.

## Security notes

HomeChat currently provides authenticated API access, server-side privacy/block enforcement, session revocation, upload limits, basic HTTP hardening, and link-preview SSRF restrictions.

It does not currently provide:

- end-to-end encryption
- Internet-scale abuse protection
- background Web Push notifications
- native mobile push
- voice/video calling

## Troubleshooting

### HomeChat looks like a fresh install after upgrading

Check whether the new deployment is using `homechat-data` instead of the previous bind-mounted data path.

Set the old path in `.env`:

```env
HOMECHAT_DATA_PATH=/path/to/existing/appdata
```

and restart.

### HTTPS certificate name error

Confirm `HOMECHAT_HOST` matches the address being used in the browser. If you change the host after certificates have already been generated, remove/regenerate only the server certificate deliberately or use the manual TLS helper. Do not casually delete the root CA if devices already trust it.

### No administrator exists

On an empty database, configure `HOMECHAT_ADMIN_NAME` plus either `HOMECHAT_ADMIN_PASSWORD` or `HOMECHAT_ADMIN_PASSWORD_FILE`, then restart. `/api/setup` is also available until the first user is created.
