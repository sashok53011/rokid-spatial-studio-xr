# rokid-spatial-studio-xr

**WebXR-Spatial-Studio für Rokid Max** — eine Anwendung auf Basis von
AI Studio / `xrblocks` + three.js, die **sowohl in Desktop-Browsern als
auch als eigenständiges Android-APK** läuft und die IMU der Brille über
rohes USB HID steuert.

**Sprachen**: [English](README.md) · [Русский](README.ru.md) · Deutsch (diese Datei)

> Begleitprojekt: der native Kotlin/Filament-Host liegt in
> **`rokid-spatial-host`** (360°-Video, glTF-Pipeline, Jolt-Physik,
> Export). Dieses Repository ist das Web-/Experimentier-Gegenstück —
> dieselbe Brille, anderer Stack (WebXR).

Ursprüngliche AI-Studio-App:
https://ai.studio/apps/17882e8a-8547-466a-b15d-07d4302a0fd7

## Funktionen

* **Rokid-IMU-Treiber mit zwei Transporten** (`VertoRokidWebHIDDriver`):
  * **Desktop Chrome/Edge** — WebHID (`navigator.hid`) out of the box;
  * **Android-APK (Capacitor)** — nativer `RokidUsbPlugin`
    (`android.hardware.usb.UsbManager`) streamt **rohe HID mit400 Hz**
    (`0x11`-Reports, f32 accel ab Byte 9, f32 gyro ab Byte 21,
    Rx(−90°)-Rahmenzuordnung) in dieselbe Filterkette.
* **Live-Telemetrie**: Madgwick-AHRS-Orientierungsfilter + Recharts-
  IMU-Chart (`RokidImuChart`), Verbindungs-Overlay
  (`RokidConnectOverlay`).
* **WebXR-Sitzung** mit Polyfills für die APK-WebView
  (`XRRigidTransform` usw.), stille Capacitor-Logs.
* **360°-Panorama-Umgebung** (`Panorama360Manager`).
* **Physik-Sandbox** auf Rapier3d (`PhysicsSandbox`).
* **Universeller Modell-I/O** — Import/Export im glTF/OBJ-Stil
  (`UniversalModelIO`), Materialbibliothek, Prototypen-Fabrik.
* **KI-Features**: Gemini-API-Schlüssel in `.env.local`
  (`@google/genai`), OpenAI-SDK gebündelt; MediaPipe- vision/audio-
  Tasks.
* **Cloud-Sync-Grundgerüst** (`CloudSyncManager`).
* **Spatial Control Deck**-UI (`SpatialControlDeck`).

## Lokal ausführen

**Voraussetzungen:** Node.js 20+

```bash
npm install
# Gemini-Schlüssel in .env.local eintragen:  GEMINI_API_KEY=...
npm run dev            # Vite-Dev-Server auf http://localhost:3000
```

Weitere Skripte:

```bash
npm run build          # Produktions-Bundle → dist/
npm run lint           # tsc --noEmit
npm run preview        # gebautes Bundle ausliefern
npm run android:setup  # nativen USB-Plugin in android/ einbauen
```

## Android-APK bauen (400 Hz USB-C-IMU)

Voraussetzungen: Node.js 20+, JDK 17/21, Android SDK (`ANDROID_HOME`).

```bash
npm install
npm run build               # Vite-WebXR-Bundle
npx cap add android         # Capacitor-Projekt erzeugen
node scripts/setup-android-usb.mjs   # RokidUsbPlugin + USB-Filter + Manifest
npx cap sync android        # dist/ ins Android-Projekt kopieren
cd android && ./gradlew assembleDebug
```

APK-Ausgabe: `android/app/build/outputs/apk/debug/app-debug.apk`,
dann `adb install -r …`. Package-Id: `com.rokid.spatialstudio`.

Detaillierte Schritte: [ANDROID_APK_GUIDE.md](ANDROID_APK_GUIDE.md).

**Auf der Box**: `com.rokid.spatialstudio` stoppen, bevor
`rokid-spatial-host` startet — nur eine App darf das USB-Gerät halten.

## Architektur

```
src/
  index.ts / SpatialStudioApp.ts   Einstieg, WebXR-Sitzungs-Verdrahtung
  sdk/
    VertoRokidWebHIDDriver.ts      IMU-Transport-Umschalter (WebHID ↔ USB)
    RokidAndroidUsbBridge.ts       Capacitor-Brücke zu RokidUsbPlugin
    RokidPluginAPI.ts              Plugin-Typen
  environment/Panorama360Manager   360°-Hintergrund
  physics/PhysicsSandbox           Rapier3d-Starörper
  io/UniversalModelIO              Modell-Import/-Export
  materials/MaterialLibrary        gemeinsame Materialien
  prototypes/PrototypeFactory      Szenen-Objektfabrik
  sync/CloudSyncManager            Cloud-Sync-Grundgerüst
  ui/                              Control Deck, IMU-Chart, Verbindungs-Overlay
  polyfills/                       webxr.ts, quiet-capacitor.ts
android-native/                    RokidUsbPlugin.java + USB-Gerätefilter
scripts/setup-android-usb.mjs      einmaliges Patchen des nativen Projekts
```

## Status & nächste Schritte

- [x] Dual-Transport-IMU (WebHID am Desktop /400 Hz nativ USB im APK)
- [x] Madgwick-Filter + Live-IMU-Chart, Verbindungs-Overlay
- [x] WebXR-Polyfills für die Capacitor-WebView
- [x] APK-Build-Pipeline (`android:setup` + `cap sync` + gradle)
- [ ] Bekanntes Problem: Raum-/WebXR-Szene war teils auf dem Kopf —
      Pose-Konvention end-to-end prüfen (der native Host hat den
      equivalente Video-Bug in `rokid-spatial-host`, Commit `821ec87`,
      gefixt)
- [ ] Reste des AI-Studio-Scaffold durch Projektdokumentation/Screenshots
      ersetzen
- [ ] Funktionsumfang langfristig mit `rokid-spatial-host` abgleichen
      (Reife der glTF-Pipeline, Physik, Export)

## Lizenz

Noch keine Lizenzdatei — eine hinzufügen (MIT/Apache-2.0) vor der
Veröffentlichung.
