package io.github.alexesmm.stremcompat;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.HttpURLConnection;
import java.net.URL;

/**
 * The phone app: the phone interface of the local server (/m/) in a WebView. The phone's back
 * goes to the page's history, where each sheet and pushed view has its entry; videos play in
 * PlayerActivity.
 */
public class MainActivity extends Activity {
    static final String HOME = "http://127.0.0.1:" + BuildConfig.SERVER_PORT;
    private static final int PLAY = 1;
    private static final int BACKGROUND = Color.rgb(12, 11, 17);
    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView page;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        NodeRunner.start(this);
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        /* the bars in the Android look's background (mobile.css --bg) */
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        page = new WebView(this);
        page.setBackgroundColor(BACKGROUND);
        setContentView(page);
        WebSettings s = page.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        page.setWebChromeClient(new WebChromeClient());
        page.setWebViewClient(new WebViewClient());
        page.addJavascriptInterface(new Bridge(), "StremCompatNative");
        waitForServer(0);
    }

    /** The server starts with the app: the page opens once it answers. */
    private void waitForServer(int attempt) {
        new Thread(() -> {
            boolean up = false;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(HOME + "/health").openConnection();
                c.setConnectTimeout(500);
                c.setReadTimeout(1000);
                up = c.getResponseCode() == 200;
                c.disconnect();
            } catch (Exception ignored) {
            }
            boolean ready = up;
            main.postDelayed(() -> {
                if (ready || attempt > 120) page.loadUrl(HOME + "/m/?platform=android");
                else waitForServer(attempt + 1);
            }, ready ? 0 : 250);
        }).start();
    }

    @Override
    public void onBackPressed() {
        if (page.canGoBack()) page.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        /* the player kept the progress itself: the page shows it again, and after a video played to
           its end goes on to the next episode */
        boolean toTheEnd = data != null && data.getBooleanExtra(PlayerActivity.ENDED, false);
        if (request == PLAY)
            page.evaluateJavascript("window.stremcompatPlaybackEnded && window.stremcompatPlaybackEnded(" + toTheEnd + ")", null);
    }

    /** What the page may ask of the app (service/mobile/js/views/player.js). */
    private final class Bridge {
        @JavascriptInterface public void play(String url, String title, double resumeMs, String item) {
            Intent i = new Intent(MainActivity.this, PlayerActivity.class)
                    .putExtra(PlayerActivity.URL, url)
                    .putExtra(PlayerActivity.TITLE, title)
                    .putExtra(PlayerActivity.RESUME, (long) resumeMs)
                    .putExtra(PlayerActivity.ITEM, item);
            main.post(() -> startActivityForResult(i, PLAY));
        }

        /** Settings > Player > Another app: the phone's choice of video players */
        @JavascriptInterface public void openExternal(String url, String title) {
            Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(url), "video/*").putExtra("title", title);
            main.post(() -> {
                try {
                    startActivity(Intent.createChooser(view, title));
                } catch (Exception ignored) {
                }
            });
        }
    }
}
