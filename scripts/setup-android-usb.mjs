import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const androidMainDir = path.join(rootDir, 'android', 'app', 'src', 'main');
const javaTargetDir = path.join(
  androidMainDir,
  'java',
  'com',
  'rokid',
  'spatialstudio'
);
const xmlTargetDir = path.join(androidMainDir, 'res', 'xml');
const manifestPath = path.join(androidMainDir, 'AndroidManifest.xml');

if (!fs.existsSync(androidMainDir)) {
  console.error(
    'Error: android/ project directory not found. Run "npx cap add android" first.'
  );
  process.exit(1);
}

fs.mkdirSync(javaTargetDir, {recursive: true});
fs.mkdirSync(xmlTargetDir, {recursive: true});

fs.copyFileSync(
  path.join(rootDir, 'android-native', 'RokidUsbPlugin.java'),
  path.join(javaTargetDir, 'RokidUsbPlugin.java')
);
fs.copyFileSync(
  path.join(rootDir, 'android-native', 'MainActivity.java'),
  path.join(javaTargetDir, 'MainActivity.java')
);
fs.copyFileSync(
  path.join(rootDir, 'android-native', 'rokid_usb_device_filter.xml'),
  path.join(xmlTargetDir, 'rokid_usb_device_filter.xml')
);

let manifest = fs.readFileSync(manifestPath, 'utf8');

if (!manifest.includes('android.hardware.usb.host')) {
  manifest = manifest.replace(
    '</manifest>',
    '    <uses-feature android:name="android.hardware.usb.host" android:required="false" />\n</manifest>'
  );
}

if (!manifest.includes('android.hardware.usb.action.USB_DEVICE_ATTACHED')) {
  const usbIntentBlock = `
            <intent-filter>
                <action android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" />
            </intent-filter>
            <meta-data
                android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED"
                android:resource="@xml/rokid_usb_device_filter" />`;

  manifest = manifest.replace('</activity>', `${usbIntentBlock}\n        </activity>`);
}

fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log(
  'Installed RokidUsbPlugin.java, MainActivity.java, rokid_usb_device_filter.xml, and patched AndroidManifest.xml.'
);
