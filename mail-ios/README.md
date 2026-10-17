# Cloudmail for iOS

Native SwiftUI client for iOS 18 and later. Open `Cloudmail.xcodeproj` in Xcode 16 or later (validated here with Xcode 27.1). No third-party iOS packages are required.

## Connect

Deploy the accompanying Worker changes and run database initialization before signing in. Enter the server origin (for example `https://mail.example.com`), installation secret, and a Cloudmail user's email/password. Add additional users through Mailboxes or Settings; each keeps separate credentials, mailboxes, drafts, cache, sync cursor, and notification preferences. All users belong to one configurable server.

The installation secret is distinct from the Cloudmail administrator password and the backend signing key. It is stored only in device-only Keychain items accessible after first unlock. User passwords are not retained. An expired session prompts only that user to sign in again. Update a rotated installation secret in Settings.

## Build and install

1. Open `Cloudmail.xcodeproj`, select the Cloudmail target, and choose your Apple development team under Signing & Capabilities.
2. Keep the bundle identifier `app.cloudmail.internal` or change it to an identifier available to your team. The background task identifier in `Info.plist` and `MailStore.backgroundID` must match each other.
3. Connect and trust your iPhone, enable Developer Mode if requested, select the device, and Run. Xcode can create the development provisioning profile. Development signing and profiles require renewal according to the account and provisioning used.
4. For registered-device distribution, Archive and choose Development or Ad Hoc as appropriate to your Apple account. Ad Hoc export requires a distribution certificate and a profile containing every target device. This repository does not include signing identities or provisioning profiles.

Simulator validation:

```sh
xcodebuild -project mail-ios/Cloudmail.xcodeproj -scheme Cloudmail \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/cloudmail-ios-build CODE_SIGNING_ALLOWED=NO test
```

A Debug launch argument `-ui-testing` supplies isolated, in-memory sample mail for UI tests. It does not log in to any server or load production caches. Release builds do not contain sample mail.

## Background checking

The app requests a `BGAppRefreshTask` after approximately 15 minutes, refreshes on activation, checks once a minute while active, and supports pull-to-refresh. These are requests to iOS, not a promised interval: checks may be delayed for hours, and force quitting, Low Power Mode, or disabled Background App Refresh can prevent them. There is no Firebase SDK, APNs setup, or push relay.

On a physical device, enable notifications and Background App Refresh, sign in to two users, background the app, and deliver mail to both users. Verify the last successful check, separate alerts, and correct conversation routing when alerts are tapped. Repeat with notifications denied, refresh disabled, Low Power Mode, an expired user session, and interrupted connectivity. Xcode's simulated background launch is useful for execution/expiration checks, but does not prove real scheduling frequency. Never promise a delivery deadline based on simulator tests.

## Data and behavior

- Conversation lists and opened bodies are cached. Downloaded files and draft attachments remain available offline. Drafts are local to this device and do not sync to the web.
- Sending, read/unread changes, stars, and deletion require a connection. A failed send preserves its draft. After an ambiguous send failure, inspect Sent and server activity before retrying.
- The plain-text composer sends HTML and text, supports To/Cc/Bcc, replies/reply-all, forwards, files, and photos. Forwarded ordinary attachments are copied into the saved draft.
- HTML runs in a nonpersistent web view with scripts disabled and a restrictive content policy. Remote resources are blocked until explicitly allowed. Stored inline images use authenticated, message-scoped downloads. External links open outside the authenticated client.
- The SwiftData store, files, and Keychain credentials are accessible after the device's first unlock so scheduled refresh can operate while locked. Cache/draft data stays within the application sandbox; CloudKit sync is disabled.
- The notification outbox and incremental cursor are committed with cache updates. Historical mail does not alert on first sign-in. Notifications show sender and subject by default, with per-user privacy controls.
- Deletion uses the server's existing behavior and may be permanent. Archive, recoverable Trash, server drafts, offline mutation queues, and native administration are not included.
- Sign-out revokes the current session when connected and removes that user's credentials, cache, files, drafts, and notifications. Removal of unsent drafts requires confirmation. A shared installation secret cannot revoke access for one device individually; rotate it if it is exposed.

## Tests

Worker integration tests cover installation access, private files, ownership, conversation relationships, cursor pagination/replay, complete-receipt notifications, and Cc/Bcc privacy. iOS unit tests cover credential request boundaries, offline body preservation, per-user caching/drafts, reply-all filtering, notification eligibility, and cursor/outbox commits. UI tests exercise the inbox and saved-draft composer. Live binary sending and actual background timing require device/server checks.
