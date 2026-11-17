package io.github.alexesmm.stremcompat;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;
import android.view.View;
import android.view.WindowManager;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * A video on the phone: ExoPlayer with its touch controls, sideways and full screen, carried on in
 * picture-in-picture when the app goes to the background. What is watched is told to the local
 * server as the TV apps tell it (/app/progress), every few seconds and when it closes.
 */
public class PlayerActivity extends Activity {
    static final String URL = "url", TITLE = "title", RESUME = "resume", ITEM = "item";
    private static final long REPORT_EVERY_MS = 10000;
    private final Handler main = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private PlayerView view;
    private String item;

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            report(player.isPlaying() ? "tick" : "pause");
            main.postDelayed(this, REPORT_EVERY_MS);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        item = getIntent().getStringExtra(ITEM);
        view = new PlayerView(this);
        view.setBackgroundColor(Color.BLACK);
        view.setKeepScreenOn(true);
        setContentView(view);
        hideSystemBars();
        player = new ExoPlayer.Builder(this, new DefaultRenderersFactory(this).setEnableDecoderFallback(true)).build();
        view.setPlayer(player);
        player.setMediaItem(MediaItem.fromUri(getIntent().getStringExtra(URL)));
        long resume = getIntent().getLongExtra(RESUME, 0);
        if (resume > 0) player.seekTo(resume);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int s) {
                if (s == Player.STATE_ENDED) finish();
            }
        });
        player.prepare();
        player.play();
        main.postDelayed(tick, REPORT_EVERY_MS);
    }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    /** the app going to the background keeps the video in a small window */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= 26 && player.isPlaying())
            enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9)).build());
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration config) {
        super.onPictureInPictureModeChanged(inPip, config);
        view.setUseController(!inPip);
    }

    @Override
    protected void onStop() {
        super.onStop();
        /* closed from picture-in-picture, or the screen turned off: paused, not lost */
        player.pause();
        report("pause");
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(tick);
        report("leave");
        player.release();
        super.onDestroy();
    }

    /** what was watched, to the local server, off the main thread */
    private void report(String event) {
        long duration = player.getDuration(), time = player.getCurrentPosition();
        if (item == null || duration <= 0) return;
        String body;
        try {
            JSONObject o = new JSONObject(item);
            o.put("time", time).put("duration", duration).put("event", event);
            body = o.toString();
        } catch (Exception e) {
            return;
        }
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(MainActivity.HOME + "/app/progress").openConnection();
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setConnectTimeout(2000);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(body.getBytes(StandardCharsets.UTF_8));
                }
                c.getResponseCode();
                c.disconnect();
            } catch (Exception ignored) {
            }
        }).start();
    }
}
