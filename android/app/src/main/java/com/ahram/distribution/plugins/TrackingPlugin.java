package com.ahram.distribution.plugins;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "TrackingService",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        ),
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        ),
        @Permission(
            alias = "notification",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class TrackingPlugin extends Plugin {

    private static final String TAG = "TrackingPlugin";
    private static final String ACTION_BATTERY_CHANGED = Intent.ACTION_BATTERY_CHANGED;

    @PluginMethod
    public void start(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String token = call.getString("token");
        String supabaseUrl = call.getString("supabaseUrl");
        String anonKey = call.getString("anonKey");
        int intervalSeconds = call.getInt("intervalSeconds", 300);

        if (sessionId == null || token == null) {
            call.reject("sessionId and token are required");
            return;
        }

        if (!hasLocationPermissions()) {
            requestAllPermissions(call, "locationPermsCallback");
            return;
        }

        startService(sessionId, token, supabaseUrl, anonKey, intervalSeconds);
        call.resolve();
    }

    @PermissionCallback
    private void locationPermsCallback(PluginCall call) {
        if (!hasLocationPermissions()) {
            call.reject("Location permission not granted");
            return;
        }

        String sessionId = call.getString("sessionId");
        String token = call.getString("token");
        String supabaseUrl = call.getString("supabaseUrl");
        String anonKey = call.getString("anonKey");
        int intervalSeconds = call.getInt("intervalSeconds", 300);

        startService(sessionId, token, supabaseUrl, anonKey, intervalSeconds);
        call.resolve();
    }

    private boolean hasLocationPermissions() {
        boolean fine = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            boolean background = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            if (!background) return false;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            boolean notification = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
            if (!notification) return false;
        }

        return fine && coarse;
    }

    private void startService(String sessionId, String token, String supabaseUrl, String anonKey, int intervalSeconds) {
        Intent intent = new Intent(getContext(), TrackingForegroundService.class);
        intent.putExtra("sessionId", sessionId);
        intent.putExtra("token", token);
        intent.putExtra("supabaseUrl", supabaseUrl);
        intent.putExtra("anonKey", anonKey);
        intent.putExtra("intervalSeconds", intervalSeconds);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        Log.i(TAG, "Tracking service started");
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), TrackingForegroundService.class);
        intent.setAction("STOP");
        getContext().startService(intent);
        Log.i(TAG, "Tracking service stopped");
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject status = new JSObject();
        status.put("running", true);
        status.put("nativeService", true);
        call.resolve(status);
    }

    // ---- Battery Optimization ----

    @PluginMethod
    public void isBatteryOptimizationEnabled(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve(new JSObject() {{ put("enabled", false); }});
            return;
        }

        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        String packageName = getContext().getPackageName();
        boolean enabled = !pm.isIgnoringBatteryOptimizations(packageName);

        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void requestDisableBatteryOptimization(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve();
            return;
        }

        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        String packageName = getContext().getPackageName();

        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(android.net.Uri.parse("package:" + packageName));
            getActivity().startActivity(intent);
        }

        call.resolve();
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // ---- Battery Level ----

    @PluginMethod
    public void getBatteryLevel(PluginCall call) {
        IntentFilter filter = new IntentFilter(ACTION_BATTERY_CHANGED);
        Intent batteryStatus = getContext().registerReceiver(null, filter);

        if (batteryStatus == null) {
            call.resolve(new JSObject() {{ put("level", -1); }});
            return;
        }

        int level = batteryStatus.getIntExtra("android.os.BatteryManager.EXTRA_LEVEL", -1);
        int scale = batteryStatus.getIntExtra("android.os.BatteryManager.EXTRA_SCALE", -1);

        double pct = (scale > 0) ? (level * 100.0 / scale) : -1;

        JSObject result = new JSObject();
        result.put("level", pct);
        call.resolve(result);
    }
}
