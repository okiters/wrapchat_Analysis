# Capacitor Mobile Setup

This project now has Capacitor native shells for iOS and Android.

## Current App Identity

| Field | Value |
| --- | --- |
| App name | WrapChat |
| App id / bundle id | `com.wrapchat.app` |
| Web output directory | `dist` |

Important: `com.wrapchat.app` is a practical placeholder. Before App Store or Google Play setup, confirm the final bundle id you want to own permanently. Changing it later can complicate store records, RevenueCat product setup, and installed app upgrades.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the Vite web app into `dist`. |
| `npx cap sync` | Copy the latest web build into native projects and update native plugins. |
| `npm run cap:sync` | Build and sync in one command. |
| `npm run cap:ios` | Build, sync, and open the iOS project in Xcode. |
| `npm run cap:android` | Build, sync, and open the Android project in Android Studio. |

## Generated Native Projects

| Platform | Path |
| --- | --- |
| iOS | `ios/` |
| Android | `android/` |

Capacitor generated starter native app icons and splash assets. Replace these with final WrapChat production assets before store submission.

## Verified Locally

| Check | Result |
| --- | --- |
| Capacitor dependencies installed | Pass |
| iOS platform added | Pass |
| Android platform added | Pass |
| `npx cap sync` | Pass |
| `npx cap doctor` | Pass for iOS and Android project setup |
| `npm run build` | Pass |
| `npm test` | Pass |
| `npm run lint` | Pass with existing warnings |
| `npm audit` | Pass, 0 vulnerabilities |
| Local Xcode probe | Xcode 26.4.1 is selected |
| Local Java probe | Java 1.8 is installed; Android Studio/JDK 17+ should be configured for native builds |
| iOS simulator build | Passes with Xcode 26.4.1 |

## Before Native Testing

You still need local native tooling:

- Xcode for iOS simulator/device builds.
- Android Studio, Android SDK, and a modern JDK for Android emulator/device builds.
- Apple Developer Team selected in Xcode.
- Android signing setup later for release builds.

## Mobile-Specific Follow-Ups

These are not finished by the base Capacitor conversion:

- Confirm final bundle id/app id.
- Replace default native icons and splash screens with final assets.
- Test Supabase auth redirects inside the native WebView.
- Add native URL scheme/deep-link handling if auth confirmation links need to return directly into the app.
- Test file upload on iOS and Android.
- Test Android native share-to-WrapChat from WhatsApp export. Android now declares `SEND` and `SEND_MULTIPLE` share intents and forwards shared files/text into the existing import flow.
- Test iOS "Open in WrapChat" from WhatsApp export. iOS now declares supported document types and forwards opened files into the existing import flow.
- Add a full iOS Share Extension later if "Open in WrapChat" is not visible enough in the iOS share sheet or if a richer share-sheet UI is needed.
- Add RevenueCat SDK and store configuration in Phase 4/5.

## Android Native Share Import

Android share receiving is implemented in:

- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/wrapchat/app/MainActivity.java`
- `src/import/shareTargetClient.js`
- `src/ImportRoute.jsx`

Supported incoming share payloads:

- `text/plain`
- `application/zip`
- `application/json`
- `text/html`
- `application/octet-stream`

When Android launches WrapChat from the share sheet, the native activity reads the shared URI or text, stores it as a temporary JS payload, routes the WebView to `/import`, and the existing import parser receives it as a normal browser `File`.

## iOS Native File Import

iOS file-open receiving is implemented in:

- `ios/App/App/Info.plist`
- `ios/App/App/AppDelegate.swift`
- `src/import/shareTargetClient.js`
- `src/ImportRoute.jsx`

Supported incoming document types:

- `public.plain-text`
- `public.text`
- `public.zip-archive`
- `public.json`
- `public.html`
- `public.data`

When iOS opens a supported exported chat file with WrapChat, `AppDelegate` reads the file URL, stores it as a temporary JS payload, routes the WebView to `/import`, and the existing import parser receives it as a normal browser `File`.

This is lighter than a full Share Extension. It should support "Open in WrapChat" style flows, but a separate Share Extension target may still be needed if Apple does not show the app directly in the exact WhatsApp share-sheet placement desired for launch.
