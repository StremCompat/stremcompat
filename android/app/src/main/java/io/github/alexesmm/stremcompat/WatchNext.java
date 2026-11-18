package io.github.alexesmm.stremcompat;

import android.app.UiModeManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.res.Configuration;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import androidx.tvprovider.media.tv.TvContractCompat;
import androidx.tvprovider.media.tv.WatchNextProgram;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Continue Watching on the Android TV / Google TV home screen ("Watch Next"), from the local
 * server's Home rows, written again each time the app leaves the screen. A program opens the app
 * on its title (stremcompat://title/<type>/<id>).
 */
final class WatchNext {
    private static final int MAX_PROGRAMS = 15;
    private static final String TAG = "StremCompat";

    private WatchNext() {}

    static void refresh(Context context) {
        UiModeManager ui = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        if (ui == null || ui.getCurrentModeType() != Configuration.UI_MODE_TYPE_TELEVISION) return;
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                JSONArray items = continueWatching();
                publish(app, items);
                Log.i(TAG, "Watch Next: " + items.length() + " programs");
            } catch (Exception e) {
                /* the home row stays as it was */
                Log.w(TAG, "Watch Next not updated", e);
            }
        }).start();
    }

    /** the Continue Watching items of Home's rows */
    private static JSONArray continueWatching() throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + BuildConfig.SERVER_PORT + "/app/home").openConnection();
        c.setConnectTimeout(2000);
        c.setReadTimeout(8000);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = c.getInputStream()) {
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        } finally {
            c.disconnect();
        }
        JSONArray rows = new JSONObject(out.toString("UTF-8")).optJSONArray("rows"), found = new JSONArray();
        for (int r = 0; rows != null && r < rows.length(); r++) {
            JSONArray items = rows.getJSONObject(r).optJSONArray("items");
            for (int i = 0; items != null && i < items.length() && found.length() < MAX_PROGRAMS; i++)
                if (items.getJSONObject(i).optBoolean("cw")) found.put(items.getJSONObject(i));
        }
        return found;
    }

    private static void publish(Context context, JSONArray items) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        /* the provider lists only this app's programs, each known by its type and id */
        Map<String, Long> old = new HashMap<>();
        try (Cursor c = resolver.query(TvContractCompat.WatchNextPrograms.CONTENT_URI,
                new String[] {TvContractCompat.WatchNextPrograms._ID, TvContractCompat.WatchNextPrograms.COLUMN_INTERNAL_PROVIDER_ID},
                null, null, null)) {
            while (c != null && c.moveToNext()) old.put(c.getString(1), c.getLong(0));
        }
        /* each one written in place (or added), and only then the ones no longer there removed:
           a write that fails leaves the row as it was, never empty */
        Set<String> kept = new HashSet<>();
        long now = System.currentTimeMillis();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            String type = it.optString("type", "movie"), id = it.optString("id"), key = type + ":" + id;
            boolean series = "series".equals(type), upNext = it.optBoolean("upNext");
            WatchNextProgram.Builder p = new WatchNextProgram.Builder();
            p.setWatchNextType(upNext ? TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_NEXT
                            : TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
                    .setLastEngagementTimeUtcMillis(now - i)
                    .setType(series ? TvContractCompat.PreviewPrograms.TYPE_TV_SERIES : TvContractCompat.PreviewPrograms.TYPE_MOVIE)
                    .setTitle(it.optString("name"))
                    .setInternalProviderId(key)
                    .setIntentUri(Uri.parse("stremcompat://title/" + Uri.encode(type) + "/" + Uri.encode(id)));
            String art = it.optString("art", it.optString("backdrop"));
            if (!art.isEmpty())
                p.setPosterArtUri(Uri.parse(art)).setPosterArtAspectRatio(TvContractCompat.PreviewPrograms.ASPECT_RATIO_16_9);
            try {
                Long at = old.get(key);
                if (at != null) resolver.update(TvContractCompat.buildWatchNextProgramUri(at), p.build().toContentValues(), null, null);
                else resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, p.build().toContentValues());
                kept.add(key);
            } catch (Exception e) {
                Log.w(TAG, "Watch Next: " + key + " not written", e);
                if (old.containsKey(key)) kept.add(key);
            }
        }
        for (Map.Entry<String, Long> e : old.entrySet())
            if (!kept.contains(e.getKey())) resolver.delete(TvContractCompat.buildWatchNextProgramUri(e.getValue()), null, null);
    }
}
