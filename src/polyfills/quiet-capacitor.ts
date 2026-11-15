/**
 * Runs before app modules (imported first in index.ts).
 *
 * Capacitor's bridge is injected with `isLoggingEnabled: true` on debug
 * builds. Every native→bridge message then gets re-printed into the WebView
 * console (bridge `returnResult` → `logFromNative` → console.dir) and, with
 * the Rokid IMU streaming ~100 listener events/s, flooded logcat with raw
 * `{"packets":[...]}` base64 dumps.
 *
 * Flipping the flag off kills ONLY that native→page echo (the gate is read
 * live at `returnResult`), while genuine page `console.*` calls still reach
 * logcat through the native BridgeWebChromeClient — diagnostics preserved.
 */
if (typeof window !== 'undefined' && (window as any).Capacitor) {
  (window as any).Capacitor.isLoggingEnabled = false;
}

export {};
