package com.rokid.spatialstudio;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Process;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "RokidUsb")
public class RokidUsbPlugin extends Plugin {

    private static final int ROKID_VENDOR_ID = 0x04D2;
    private static final Set<Integer> ROKID_PREFERRED_PIDS = new HashSet<>(
        Arrays.asList(0x162F, 0x162D, 0x1630, 0x1631, 0x1632, 0x1639, 0x2002)
    );
    private static final String ACTION_USB_PERMISSION =
        "com.rokid.spatialstudio.USB_PERMISSION";

    private static final int MAX_BATCH_SIZE = 4;
    private static final long MAX_BATCH_NS = 10_000_000L; // 10 ms (~100Hz bridge flush for 400Hz IMU)

    private UsbManager usbManager;
    private UsbDevice activeDevice;
    private UsbDeviceConnection activeConnection;
    private final List<UsbInterface> claimedInterfaces = new ArrayList<>();
    private UsbEndpoint imuInEndpoint;

    private final AtomicBoolean reading = new AtomicBoolean(false);
    private Thread readerThread;
    private PluginCall pendingConnectCall;

    private final BroadcastReceiver permissionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!ACTION_USB_PERMISSION.equals(intent.getAction())) {
                return;
            }
            UsbDevice device = getUsbDeviceExtra(intent);
            boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);

            PluginCall call = pendingConnectCall;
            pendingConnectCall = null;
            if (call == null) {
                return;
            }

            if (granted && device != null) {
                try {
                    JSObject info = openAndStartStreaming(device);
                    call.resolve(info);
                } catch (Exception ex) {
                    call.reject("Failed to open Rokid USB interface: " + ex.getMessage(), ex);
                }
            } else {
                call.reject("USB permission denied for Rokid Max glasses.");
            }
            bridge.releaseCall(call);
        }
    };

    private final BroadcastReceiver detachReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!UsbManager.ACTION_USB_DEVICE_DETACHED.equals(intent.getAction())) {
                return;
            }
            UsbDevice detached = getUsbDeviceExtra(intent);
            if (activeDevice != null && (detached == null || detached.getDeviceId() == activeDevice.getDeviceId())) {
                closeUsbSession();
                JSObject payload = new JSObject();
                payload.put("reason", "Rokid Max USB-C cable disconnected");
                notifyListeners("usbDetached", payload);
            }
        }
    };

    @Override
    public void load() {
        usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);

        IntentFilter permFilter = new IntentFilter(ACTION_USB_PERMISSION);
        ContextCompat.registerReceiver(
            getContext(),
            permissionReceiver,
            permFilter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        );

        IntentFilter detachFilter = new IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED);
        ContextCompat.registerReceiver(
            getContext(),
            detachReceiver,
            detachFilter,
            ContextCompat.RECEIVER_EXPORTED
        );
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (usbManager == null) {
            call.reject("Android UsbManager is unavailable on this device.");
            return;
        }

        UsbDevice target = findRokidDevice();
        if (target == null) {
            call.reject("No Rokid Max (VID 0x04D2) USB-C device detected.");
            return;
        }

        if (usbManager.hasPermission(target)) {
            try {
                JSObject info = openAndStartStreaming(target);
                call.resolve(info);
            } catch (Exception ex) {
                call.reject("Failed to open Rokid USB interface: " + ex.getMessage(), ex);
            }
            return;
        }

        if (pendingConnectCall != null) {
            bridge.releaseCall(pendingConnectCall);
        }
        pendingConnectCall = call;
        bridge.saveCall(call);

        Intent permIntent = new Intent(ACTION_USB_PERMISSION);
        permIntent.setPackage(getContext().getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0, permIntent, flags);
        usbManager.requestPermission(target, pi);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeUsbSession();
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject status = new JSObject();
        if (activeDevice != null && activeConnection != null && reading.get()) {
            status.put("connected", true);
            status.put("deviceName", getFriendlyName(activeDevice));
            status.put("vendorId", activeDevice.getVendorId());
            status.put("productId", activeDevice.getProductId());
            status.put("interfaceCount", claimedInterfaces.size());
        } else {
            status.put("connected", false);
            status.put("deviceName", "Not Connected");
            status.put("vendorId", ROKID_VENDOR_ID);
            status.put("productId", 0);
            status.put("interfaceCount", 0);
        }
        call.resolve(status);
    }

    @Override
    protected void handleOnDestroy() {
        closeUsbSession();
        try {
            getContext().unregisterReceiver(permissionReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        try {
            getContext().unregisterReceiver(detachReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        super.handleOnDestroy();
    }

    private UsbDevice findRokidDevice() {
        Map<String, UsbDevice> list = usbManager.getDeviceList();
        UsbDevice fallback = null;
        for (UsbDevice dev : list.values()) {
            if (dev.getVendorId() == ROKID_VENDOR_ID) {
                if (ROKID_PREFERRED_PIDS.contains(dev.getProductId())) {
                    return dev;
                }
                fallback = dev;
            }
        }
        return fallback;
    }

    private synchronized JSObject openAndStartStreaming(UsbDevice device) {
        closeUsbSession();

        UsbDeviceConnection conn = usbManager.openDevice(device);
        if (conn == null) {
            throw new IllegalStateException("UsbManager.openDevice returned null.");
        }

        UsbInterface selectedIntf = null;
        UsbEndpoint selectedIn = null;
        UsbEndpoint selectedOut = null;

        // Pass 1: Prefer USB_CLASS_HID interface with an Interrupt IN endpoint
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface intf = device.getInterface(i);
            if (intf.getInterfaceClass() == UsbConstants.USB_CLASS_HID) {
                UsbEndpoint inEp = findInterruptEndpoint(intf, UsbConstants.USB_DIR_IN);
                if (inEp != null && conn.claimInterface(intf, true)) {
                    claimedInterfaces.add(intf);
                    if (selectedIn == null) {
                        selectedIntf = intf;
                        selectedIn = inEp;
                        selectedOut = findInterruptEndpoint(intf, UsbConstants.USB_DIR_OUT);
                    }
                }
            }
        }

        // Pass 2: Fallback to any interface exposing an Interrupt IN endpoint
        if (selectedIn == null) {
            for (int i = 0; i < device.getInterfaceCount(); i++) {
                UsbInterface intf = device.getInterface(i);
                UsbEndpoint inEp = findInterruptEndpoint(intf, UsbConstants.USB_DIR_IN);
                if (inEp != null && conn.claimInterface(intf, true)) {
                    claimedInterfaces.add(intf);
                    selectedIntf = intf;
                    selectedIn = inEp;
                    selectedOut = findInterruptEndpoint(intf, UsbConstants.USB_DIR_OUT);
                    break;
                }
            }
        }

        if (selectedIn == null || selectedIntf == null) {
            conn.close();
            throw new IllegalStateException("No claimable Rokid IMU interrupt IN endpoint found.");
        }

        sendVertoWakeHandshake(conn, selectedIntf, selectedOut);

        activeDevice = device;
        activeConnection = conn;
        imuInEndpoint = selectedIn;

        reading.set(true);
        readerThread = new Thread(this::runImuReadLoop, "Rokid-400Hz-IMU");
        readerThread.start();

        JSObject info = new JSObject();
        info.put("connected", true);
        info.put("deviceName", getFriendlyName(device));
        info.put("vendorId", device.getVendorId());
        info.put("productId", device.getProductId());
        info.put("interfaceCount", claimedInterfaces.size());
        return info;
    }

    private UsbEndpoint findInterruptEndpoint(UsbInterface intf, int direction) {
        for (int e = 0; e < intf.getEndpointCount(); e++) {
            UsbEndpoint ep = intf.getEndpoint(e);
            if (
                ep.getType() == UsbConstants.USB_ENDPOINT_XFER_INT &&
                ep.getDirection() == direction
            ) {
                return ep;
            }
        }
        return null;
    }

    private void sendVertoWakeHandshake(
        UsbDeviceConnection conn,
        UsbInterface intf,
        UsbEndpoint outEp
    ) {
        try {
            // HID Class SET_REPORT (0x09) Feature Report 0x01 (wValue = 0x0301)
            byte[] featureWake = new byte[] { 0x01, 0x01 };
            conn.controlTransfer(0x21, 0x09, 0x0301, intf.getId(), featureWake, featureWake.length, 150);
        } catch (Exception ignored) {
        }
        try {
            // HID Class SET_REPORT (0x09) Output Report 0x01 (wValue = 0x0201)
            byte[] outputWake = new byte[] { 0x00, 0x01, 0x01 };
            conn.controlTransfer(0x21, 0x09, 0x0201, intf.getId(), outputWake, outputWake.length, 150);
        } catch (Exception ignored) {
        }
        if (outEp != null) {
            try {
                byte[] wakePkt = new byte[] { 0x01, 0x01, 0x01 };
                conn.bulkTransfer(outEp, wakePkt, wakePkt.length, 100);
            } catch (Exception ignored) {
            }
        }
    }

    private void runImuReadLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        UsbDeviceConnection conn = activeConnection;
        UsbEndpoint epIn = imuInEndpoint;
        if (conn == null || epIn == null) {
            return;
        }

        int packetSize = Math.max(64, Math.min(256, epIn.getMaxPacketSize()));
        byte[] buffer = new byte[packetSize];
        JSArray batch = new JSArray();
        long prevPacketNs = 0L;
        long batchStartNs = System.nanoTime();

        while (reading.get() && activeConnection == conn) {
            int bytesRead = conn.bulkTransfer(epIn, buffer, packetSize, 20);
            long nowNs = System.nanoTime();

            if (bytesRead > 0) {
                double dtSec = prevPacketNs > 0L
                    ? (nowNs - prevPacketNs) / 1_000_000_000.0
                    : 0.0025;
                if (dtSec < 0.0005 || dtSec > 0.05) {
                    dtSec = 0.0025;
                }
                prevPacketNs = nowNs;

                int reportId = bytesRead >= 96 ? 0x80 : (buffer[0] & 0xFF);
                String b64 = Base64.encodeToString(buffer, 0, bytesRead, Base64.NO_WRAP);

                JSObject pkt = new JSObject();
                pkt.put("reportId", reportId);
                pkt.put("dataB64", b64);
                pkt.put("dtSec", dtSec);
                batch.put(pkt);
            }

            if (batch.length() >= MAX_BATCH_SIZE || (batch.length() > 0 && (nowNs - batchStartNs) >= MAX_BATCH_NS)) {
                JSObject event = new JSObject();
                event.put("packets", batch);
                notifyListeners("imuBatch", event);
                batch = new JSArray();
                batchStartNs = nowNs;
            }
        }
    }

    private synchronized void closeUsbSession() {
        reading.set(false);
        Thread t = readerThread;
        readerThread = null;
        if (t != null && t != Thread.currentThread()) {
            t.interrupt();
            try {
                t.join(150);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }

        if (activeConnection != null) {
            for (UsbInterface intf : claimedInterfaces) {
                try {
                    activeConnection.releaseInterface(intf);
                } catch (Exception ignored) {
                }
            }
            try {
                activeConnection.close();
            } catch (Exception ignored) {
            }
        }

        claimedInterfaces.clear();
        activeConnection = null;
        activeDevice = null;
        imuInEndpoint = null;
    }

    @SuppressWarnings("deprecation")
    private UsbDevice getUsbDeviceExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class);
        }
        return intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
    }

    private String getFriendlyName(UsbDevice device) {
        String product = device.getProductName();
        if (product != null && !product.isEmpty()) {
            return product;
        }
        return "Rokid Max (1st Gen)";
    }
}
