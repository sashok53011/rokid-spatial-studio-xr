# Building the Standalone Android APK (400 Hz USB-C IMU)

This project supports **both** transports automatically through `VertoRokidWebHIDDriver`:
- **Desktop Chrome / Edge:** Uses WebHID (`navigator.hid`) directly out of the box.
- **Android APK (Capacitor):** Uses the native `RokidUsbPlugin` (`android.hardware.usb.UsbManager`) streaming 400 Hz raw HID packets into the same Madgwick AHRS filter and Recharts IMU chart.

## Prerequisites (Local Machine)
- Node.js 20+
- Java JDK 17 or 21
- Android SDK (`ANDROID_HOME` configured) or Android Studio

## Build Steps
```bash
# 1. Install dependencies & build the Vite WebXR bundle
npm install
npm run build

# 2. Generate the Capacitor Android project
npx cap add android

# 3. Install RokidUsbPlugin.java, USB device filters, and AndroidManifest permissions
node scripts/setup-android-usb.mjs

# 4. Sync dist/ assets into Android
npx cap sync android

# 5. Compile the standalone APK
cd android
./gradlew assembleDebug
```

The debug APK will be written to:
`android/app/build/outputs/apk/debug/app-debug.apk`

Install onto an Android phone connected via ADB:
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
