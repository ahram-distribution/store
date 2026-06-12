package com.ahram.distribution.plugins;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.location.Location;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class TrackingForegroundService extends Service {

    private static final String TAG = "TrackingFgService";
    private static final String CHANNEL_ID = "tracking_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final String PREFS_NAME = "tracking_prefs";
    private static final String KEY_SESSION_ID = "session_id";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_SUPABASE_URL = "supabase_url";
    private static final String KEY_ANON_KEY = "anon_key";
    private static final String KEY_INTERVAL = "interval_seconds";
    private static final String KEY_POINTS = "pending_points";
    private static final String KEY_FAILED_POINTS = "failed_points";

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private ScheduledExecutorService scheduler;
    private ConnectivityManager connectivityManager;
    private ConnectivityNetworkCallback networkCallback;
    private boolean isTracking = false;
    private int intervalSeconds = 300;
    private int consecutiveFailures = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        createNotificationChannel();
        registerNetworkCallback();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;

        String action = intent.getAction();
        if ("STOP".equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        String sessionId = intent.getStringExtra("sessionId");
        String token = intent.getStringExtra("token");
        String supabaseUrl = intent.getStringExtra("supabaseUrl");
        String anonKey = intent.getStringExtra("anonKey");
        int interval = intent.getIntExtra("intervalSeconds", 300);

        if (sessionId == null || token == null) {
            Log.w(TAG, "Missing required extras");
            return START_NOT_STICKY;
        }

        savePrefs(sessionId, token, supabaseUrl, anonKey, interval);
        intervalSeconds = interval;

        startForeground(NOTIFICATION_ID, buildNotification("Tracking running"));

        if (!isTracking) {
            startLocationUpdates();
        }

        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopTracking();
        unregisterNetworkCallback();
        super.onDestroy();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Location Tracking",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Notification for GPS tracking service");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent notificationIntent = new Intent(this, getMainActivityClass());
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Ahram Distribution")
                .setContentText(text)
                .setSmallIcon(getNotificationIcon())
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    @SuppressWarnings("rawtypes")
    private Class getMainActivityClass() {
        try {
            return Class.forName("com.ahram.distribution.MainActivity");
        } catch (ClassNotFoundException e) {
            return null;
        }
    }

    private int getNotificationIcon() {
        boolean hasIcon = getResources().getIdentifier("ic_notification", "drawable", getPackageName()) != 0;
        return hasIcon
                ? getResources().getIdentifier("ic_notification", "drawable", getPackageName())
                : android.R.drawable.ic_menu_compass;
    }

    private void savePrefs(String sessionId, String token, String supabaseUrl, String anonKey, int interval) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putString(KEY_SESSION_ID, sessionId)
                .putString(KEY_TOKEN, token)
                .putString(KEY_SUPABASE_URL, supabaseUrl != null ? supabaseUrl : "")
                .putString(KEY_ANON_KEY, anonKey != null ? anonKey : "")
                .putInt(KEY_INTERVAL, interval)
                .apply();
    }

    // ---- Network ----

    private void registerNetworkCallback() {
        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
        networkCallback = new ConnectivityNetworkCallback();
        connectivityManager.registerNetworkCallback(request, networkCallback);
    }

    private void unregisterNetworkCallback() {
        if (networkCallback != null) {
            connectivityManager.unregisterNetworkCallback(networkCallback);
            networkCallback = null;
        }
    }

    private class ConnectivityNetworkCallback extends ConnectivityManager.NetworkCallback {
        @Override
        public void onAvailable(Network network) {
            Log.i(TAG, "Network available — flushing pending points");
            flushPendingPoints();
        }
    }

    // ---- Location ----

    private void startLocationUpdates() {
        isTracking = true;

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalSeconds * 1000L)
                .setMinUpdateIntervalMillis(Math.max(intervalSeconds * 1000L / 2, 5000L))
                .setMaxUpdateDelayMillis(intervalSeconds * 2000L)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) return;
                for (Location location : locationResult.getLocations()) {
                    if (location != null) {
                        onNewLocation(location);
                    }
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(
                    request,
                    locationCallback,
                    Looper.getMainLooper()
            );
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted", e);
            isTracking = false;
        }

        startScheduler();
    }

    private void stopTracking() {
        isTracking = false;
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        stopScheduler();
    }

    // ---- Scheduler ----

    private void startScheduler() {
        stopScheduler();
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleAtFixedRate(
                this::flushPendingPoints,
                30,
                30,
                TimeUnit.SECONDS
        );
    }

    private void stopScheduler() {
        if (scheduler != null && !scheduler.isShutdown()) {
            scheduler.shutdown();
        }
        scheduler = null;
    }

    // ---- Points ----

    private void onNewLocation(Location location) {
        try {
            double lat = location.getLatitude();
            double lng = location.getLongitude();
            if (lat == 0.0 && lng == 0.0) return;

            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            JSONArray points = loadPoints(prefs, KEY_POINTS);

            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            sdf.setTimeZone(TimeZone.getTimeZone("UTC"));

            JSONObject point = new JSONObject();
            point.put("latitude", lat);
            point.put("longitude", lng);
            point.put("accuracy_meters", location.getAccuracy());
            point.put("altitude_meters", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
            point.put("speed_mps", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
            point.put("heading_degrees", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
            point.put("battery_pct", JSONObject.NULL);
            point.put("recorded_at", sdf.format(new Date()));
            point.put("point_type", "periodic");

            points.put(point);
            prefs.edit().putString(KEY_POINTS, points.toString()).apply();

            updateNotification("Tracking: " + points.length() + " points");

        } catch (Exception e) {
            Log.e(TAG, "Error saving point", e);
        }
    }

    private JSONArray loadPoints(SharedPreferences prefs, String key) {
        try {
            String raw = prefs.getString(key, "[]");
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private void flushPendingPoints() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_POINTS, "[]");
            if ("[]".equals(raw)) return;

            JSONArray points = new JSONArray(raw);
            String sessionId = prefs.getString(KEY_SESSION_ID, "");
            String token = prefs.getString(KEY_TOKEN, "");
            String supabaseUrl = prefs.getString(KEY_SUPABASE_URL, "");
            String anonKey = prefs.getString(KEY_ANON_KEY, "");

            if (sessionId.isEmpty() || token.isEmpty() || supabaseUrl.isEmpty()) {
                return;
            }

            boolean success = sendPoints(supabaseUrl, anonKey, token, sessionId, points);

            if (success) {
                prefs.edit().remove(KEY_POINTS).apply();
                consecutiveFailures = 0;
                updateNotification("Tracking active");
            } else {
                consecutiveFailures++;
                updateNotification("Tracking (sync pending)");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error flushing points", e);
        }
    }

    private boolean sendPoints(String supabaseUrl, String anonKey, String token, String sessionId, JSONArray points) {
        HttpURLConnection conn = null;
        try {
            String rpcUrl = supabaseUrl.replaceAll("/+$", "") + "/rest/v1/rpc/sync_tracking_points";

            JSONObject body = new JSONObject();
            body.put("p_token", token);
            body.put("p_session_id", sessionId);
            body.put("p_points", points);

            URL url = new URL(rpcUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            if (!anonKey.isEmpty()) {
                conn.setRequestProperty("apikey", anonKey);
            }
            conn.setDoOutput(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);

            OutputStream os = conn.getOutputStream();
            os.write(body.toString().getBytes("UTF-8"));
            os.close();

            int code = conn.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            Log.e(TAG, "HTTP error sending points", e);
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void updateNotification(String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(text));
        }
    }
}
