# HomeChat Xbox Game Bar widget

This is a small native UWP/XAML Game Bar client for HomeChat. It intentionally covers the gaming use case only: sign in, choose an existing conversation, read recent messages, and send text messages.

## Repository location

Copy this entire `gamebar/` folder to the root of the HomeChat repository:

```text
homechat/
  gamebar/
    HomeChat.GameBar.sln
    HomeChat.GameBar/
```

No HomeChat server changes are required. The widget uses the existing HomeChat REST API:

- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`

The current alpha polls for new messages every 2 seconds and conversations every 4 seconds. It does not yet use Socket.IO, attachments, reactions, typing indicators, contacts, admin features, or voice messages.

## Requirements

- Windows 11 with Xbox Game Bar installed and enabled.
- Visual Studio 2022/2026 with **Universal Windows Platform development** installed.
- Windows 10/11 SDK 10.0.26100 or newer.
- x64 target for the first build.
- The HomeChat root CA installed in Windows if the server uses HomeChat's private TLS certificate.

The project pins `Microsoft.Gaming.XboxGameBar` to `7.2.240903001`, matching Microsoft's current C# sample manifest shape and avoiding the manifest/interface regression reported against newer 7.3 packages in 2026.

## Build and run

1. Open `gamebar/HomeChat.GameBar.sln` in Visual Studio.
2. Choose `Debug` and `x64`.
3. Restore NuGet packages.
4. Build the solution.
5. Deploy/start the app once from Visual Studio.
6. Focus a normal desktop application or game and press `Win+G`.
7. Open the Game Bar widget menu and choose **HomeChat**.
8. Enter the HomeChat HTTPS address, display name, and password.

The token and server URL are saved to the UWP app's local settings. The password is not persisted.

## TLS

Do not disable certificate validation. Install the HomeChat root CA in Windows and use the same HTTPS address whose IP/hostname appears in the server certificate SAN.

## Packaging

For development, Visual Studio deployment is enough. A distributable MSIX/AppX package requires a signing certificate whose subject matches the package manifest Publisher. Change the `Publisher` value in `Package.appxmanifest` to match the certificate you use before packaging.

## Next pass

After the alpha builds and launches successfully, the useful next changes are:

- Socket.IO realtime updates instead of polling.
- Game Bar theme/opacity integration.
- unread/read receipts.
- compact layout for narrow widgets.
- open/focus a conversation from notification/deep link.
- signed MSIX build workflow.
