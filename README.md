# rokid-spatial-studio-xr

**WebXR spatial studio for Rokid Max** — an AI Studio / `xrblocks` +
three.js application that runs **both in desktop browsers and as a
standalone Android APK**, driving the glasses' IMU over raw USB HID.

**Languages**: [Русский](README.ru.md) · [Deutsch](README.de.md) · English (this file)

> Companion project: the native Kotlin/Filament host lives in
> **`rokid-spatial-host`** (360° video, glTF pipeline, Jolt physics,
> export). This repository is the web/experimental counterpart —
> same glasses, WebXR stack.

View the original AI Studio app:
https://ai.studio/apps/17882e8a-8547-466a-b15d-07d4302a0fd7

## Features

* **Rokid IMU driver with two transports** (`VertoRokidWebHIDDriver`):
  * **Desktop Chrome/Edge** — WebHID (`navigator.hid`) out of the box;
  * **Android APK (Capacitor)** — native `RokidUsbPlugin`
    (`android.hardware.usb.UsbManager`) streams **400 Hz raw HID**
    packets (`0x11` reports, f32 accel @ byte 9, f32 gyro @ byte 21,
    Rx(−90°) frame mapping) into the same filter chain.
* **Live telemetry**: Madgwick AHRS orientation filter + Recharts IMU
  chart (`RokidImuChart`), connection overlay (`RokidConnectOverlay`).
* **WebXR session** with polyfills for the APK WebView
  (`XRRigidTransform` etc.), quieted Capacitor logging.
* **360° panorama environment** (`Panorama360Manager`).
* **Physics sandbox** on Rapier3d (`PhysicsSandbox`).
* **Universal model I/O** — glTF/OBJ-style import/export
  (`UniversalModelIO`), material library, prototype factory.
* **AI-assisted features**: Gemini API key in `.env.local`
  (`@google/genai`), OpenAI SDK bundled; MediaPipe vision/audio tasks.
* **Cloud sync** scaffold (`CloudSyncManager`).
* **Spatial control deck** UI (`SpatialControlDeck`).

## Run locally

**Prerequisites:** Node.js 20+

```bash
npm install
# put your Gemini API key into .env.local:  GEMINI_API_KEY=...
npm run dev            # Vite dev server on http://localhost:3000
```

Other scripts:

```bash
npm run build          # production bundle → dist/
npm run lint           # tsc --noEmit
npm run preview        # serve the built bundle
npm run android:setup  # install native USB plugin into android/
```

## Build the Android APK (400 Hz USB-C IMU)

Prerequisites: Node.js 20+, JDK 17/21, Android SDK (`ANDROID_HOME`).

```bash
npm install
npm run build               # Vite WebXR bundle
npx cap add android         # generate the Capacitor project
node scripts/setup-android-usb.mjs   # RokidUsbPlugin + USB filters + manifest
npx cap sync android        # copy dist/ into the Android project
cd android && ./gradlew assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`, then
`adb install -r …`. The package id is `com.rokid.spatialstudio`.

Detailed steps: [ANDROID_APK_GUIDE.md](ANDROID_APK_GUIDE.md).

**On the control box**: stop `com.rokid.spatialstudio` before starting
`rokid-spatial-host` — only one app can hold the USB device.

## Architecture

```
src/
  index.ts / SpatialStudioApp.ts   app entry, WebXR session wiring
  sdk/
    VertoRokidWebHIDDriver.ts      IMU transport switch (WebHID ↔ native USB)
    RokidAndroidUsbBridge.ts       Capacitor bridge to RokidUsbPlugin
    RokidPluginAPI.ts              plugin typings
  environment/Panorama360Manager   360° backdrop
  physics/PhysicsSandbox           Rapier3d rigid bodies
  io/UniversalModelIO              model import/export
  materials/MaterialLibrary        shared materials
  prototypes/PrototypeFactory      scene object factory
  sync/CloudSyncManager            cloud sync scaffold
  ui/                              control deck, IMU chart, connect overlay
  polyfills/                       webxr.ts, quiet-capacitor.ts
android-native/                    RokidUsbPlugin.java + USB device filter
scripts/setup-android-usb.mjs      one-shot native project patching
```

## Status & next steps

- [x] Dual-transport IMU (WebHID desktop /400 Hz native USB in APK)
- [x] Madgwick filter + live IMU chart, connection overlay
- [x] WebXR polyfills for the Capacitor WebView
- [x] APK build pipeline (`android:setup` + `cap sync` + gradle)
- [ ] Known issue: room/WebXR scene orientation has reported an
      upside-down case — verify the pose convention end-to-end
      (the native host fixed the equivalent video bug in
      `rokid-spatial-host` commit `821ec87`)
- [ ] Replace remaining AI Studio scaffold with project docs/screenshots
- [ ] Align feature set with `rokid-spatial-host` over time (glTF
      pipeline maturity, physics, export)

## License

No license file yet — add one (MIT/Apache-2.0) before publishing.
