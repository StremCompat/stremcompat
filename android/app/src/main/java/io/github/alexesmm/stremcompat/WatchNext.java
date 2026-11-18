package io.github.alexesmm.stremcompat;

import android.app.UiModeManager;
import android.content.Context;
import android.content.res.Configuration;
import android.database.Cursor;
import android.net.Uri;

import androidx.tvprovider.media.tv.TvContractCompat;
import androidx.tvprovider.media.tv.WatchNextProgram;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Continue Watching on the Android TV / Google TV home screen ("Watch Next"), from the local
 * server's Home rows, written again each time the app leaves the screen. A program opens the app
 * on its title (stremcompat://title/<type>/<id>).
 */
final class WatchNext {
    private static final int MAX_PROGRAMS = 15;

    private WatchNext() {}

    static void refresh(Context context) {
        UiModeManager ui = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        if (ui == null || ui.getCurrentModeType() != Configuration.UI_MODE_TYPE_TELEVISION) return;
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                publish(app, continueWatching());
            } catch (Exception ignored) {
                /* the home row stays as it was */
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
        /* the provider lists only this app's programs: all of them are replaced */
        try (Cursor old = context.getContentResolver().query(TvContractCompat.WatchNextPrograms.CONTENT_URI,
                new String[] {TvContractCompat.WatchNextPrograms._ID}, null, null, null)) {
            while (old != null && old.moveToNext())
                context.getContentResolver().delete(TvContractCompat.buildWatchNextProgramUri(old.getLong(0)), null, null);
        }
        long now = System.currentTimeMillis();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.getJSONObject(i);
            String type = it.optString("type", "movie"), id = it.optString("id");
            boolean series = "series".equals(type), upNext = it.optBoolean("upNext");
            WatchNextProgram.Builder p = new WatchNextProgram.Builder();
            p.setWatchNextType(upNext ? TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_NEXT
                            : TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
                    .setLastEngagementTimeUtcMillis(now - i)
                    .setType(series ? TvContractCompat.PreviewPrograms.TYPE_TV_SERIES : TvContractCompat.PreviewPrograms.TYPE_MOVIE)
                    .setTitle(it.optString("name"))
                    .setInternalProviderId(type + ":" + id)
                    .setIntentUri(Uri.parse("stremcompat://title/" + Uri.encode(type) + "/" + Uri.encode(id)));
            String art = it.optString("art", it.optString("backdrop"));
            if (!art.isEmpty())
                p.setPosterArtUri(Uri.parse(art)).setPosterArtAspectRatio(TvContractCompat.PreviewPrograms.ASPECT_RATIO_16_9);
            context.getContentResolver().insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, p.build().toContentValues());
        }
    }
}
