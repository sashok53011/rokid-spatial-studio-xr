import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rokid.spatialstudio',
  appName: 'Rokid Spatial Studio',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
