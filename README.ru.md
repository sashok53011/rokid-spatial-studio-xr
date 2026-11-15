# rokid-spatial-studio-xr

**WebXR spatial-студия для Rokid Max** — приложение на базе AI Studio /
`xrblocks` + three.js, которое работает **и в десктопных браузерах, и
как самостоятельный Android APK**, и управляет IMU очков по raw USB HID.

**Языки**: [English](README.md) · [Deutsch](README.de.md) · Русский (этот файл)

> Компаньон-проект: нативный Kotlin/Filament-хост лежит в
> **`rokid-spatial-host`** (360°-видео, glTF-конвейер, физика Jolt,
> экспорт). Этот репозиторий — веб/экспериментальная противоположность:
> те же очки, но WebXR-стек.



## Возможности

* **Драйвер IMU Rokid с двумя транспортами** (`VertoRokidWebHIDDriver`):
  * **Десктоп Chrome/Edge** — WebHID (`navigator.hid`) из коробки;
  * **Android APK (Capacitor)** — нативный `RokidUsbPlugin`
    (`android.hardware.usb.UsbManager`) стримит **сырые HID на400 Гц**
    (отчёты `0x11`, f32 accel с байта9, f32 gyro с байта21, маппинг
    фрейма Rx(−90°)) в то же фильтрованное конвейер.
* **Живая телеметрия**: фильтр ориентации Madgwick AHRS + график IMU на
  Recharts (`RokidImuChart`), оверлей подключения (`RokidConnectOverlay`).
* **WebXR-сессия** с полифиллами для APK-WebView (`XRRigidTransform` и
  т.п.), заглушенное логирование Capacitor.
* **Среда360°-панорамы** (`Panorama360Manager`).
* **Песочница физики** на Rapier3d (`PhysicsSandbox`).
* **Универсальный I/O моделей** — импорт/экспорт в стиле glTF/OBJ
  (`UniversalModelIO`), библиотека материалов, фабрика прототипов.
* **AI-функции**: ключ Gemini в `.env.local` (`@google/genai`),
  OpenAI SDK в комплекте; задачи MediaPipe vision/audio.
* **Заготовка облачной синхронизации** (`CloudSyncManager`).
* **Spatial control deck** — панель управления (`SpatialControlDeck`).

## Запуск локально

**Требования:** Node.js 20+

```bash
npm install
# положите Gemini-ключ в .env.local:  GEMINI_API_KEY=...
npm run dev            # Vite dev-сервер на http://localhost:3000
```

Остальные скрипты:

```bash
npm run build          # продакшен-бандл → dist/
npm run lint           # tsc --noEmit
npm run preview        # раздать собранный бандл
npm run android:setup  # вшить нативный USB-плагин в android/
```

## Сборка Android APK (сырой IMU на400 Гц по USB-C)

Требования: Node.js 20+, JDK17/21, Android SDK (`ANDROID_HOME`).

```bash
npm install
npm run build               # WebXR-бандл Vite
npx cap add android         # генерация Capacitor-проекта
node scripts/setup-android-usb.mjs   # RokidUsbPlugin + USB-фильтры + manifest
npx cap sync android        # копия dist/ в Android-проект
cd android && ./gradlew assembleDebug
```

APK появится здесь: `android/app/build/outputs/apk/debug/app-debug.apk`,
дальше `adb install -r …`. Package id — `com.rokid.spatialstudio`.

Подробные шаги: [ANDROID_APK_GUIDE.md](ANDROID_APK_GUIDE.md).

**На коробке**: остановите `com.rokid.spatialstudio` перед запуском
`rokid-spatial-host` — USB-устройство может держать только одно
приложение.

## Архитектура

```
src/
  index.ts / SpatialStudioApp.ts   точка входа, сборка WebXR-сессии
  sdk/
    VertoRokidWebHIDDriver.ts      переключатель транспорта IMU (WebHID ↔ USB)
    RokidAndroidUsbBridge.ts       Capacitor-мост к RokidUsbPlugin
    RokidPluginAPI.ts              типы плагина
  environment/Panorama360Manager   фон360°
  physics/PhysicsSandbox           твёрдые тела на Rapier3d
  io/UniversalModelIO              импорт/экспорт моделей
  materials/MaterialLibrary        общие материалы
  prototypes/PrototypeFactory      фабрика объектов сцены
  sync/CloudSyncManager            заготовка облачной синхронизации
  ui/                              control deck, график IMU, оверлей
  polyfills/                       webxr.ts, quiet-capacitor.ts
android-native/                    RokidUsbPlugin.java + USB-фильтр устройства
scripts/setup-android-usb.mjs      разовая патч-утилита нативного проекта
```

## Статус и следующие шаги

- [x] Двухтранспортный IMU (WebHID на десктопе /400 Гц нативный USB в APK)
- [x] Фильтр Madgwick + живой график IMU, оверлей подключения
- [x] WebXR-полифиллы для Capacitor WebView
- [x] Пайплайн сборки APK (`android:setup` + `cap sync` + gradle)
- [ ] Известная проблема: у комнаты/WebXR-сцены были сообщения о
      перевороте — проверить конвенцию позы end-to-end (нативный хост
      пофиксил аналогичный баг видео в `rokid-spatial-host`, коммит
      `821ec87`)
- [ ] Заменить остатки AI Studio-скелета проектными доками/скриншотами
- [ ] Со временем выровнять функциональность с `rokid-spatial-host`
      (зрелость glTF-конвейера, физика, экспорт)

## Лицензия

Файла лицензии пока нет — добавьте (MIT/Apache-2.0) перед публикацией.
