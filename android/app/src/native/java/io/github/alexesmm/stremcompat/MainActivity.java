package io.github.alexesmm.stremcompat;

import android.graphics.PixelFormat;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.view.WindowManager;

import org.libsdl.app.SDLActivity;

/**
 * The native app (LG-C) in SDL's activity: its window is see-through where the video plays, over
 * the surface ExoPlayer draws on (NativePlayer). The local server runs on the embedded Node.
 */
public class MainActivity extends SDLActivity {
    @Override
    protected String[] getLibraries() {
        return new String[] {"SDL2", "main"};
    }

    @Override
    protected void onCreate(Bundle state) {
        NodeRunner.start(this);
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (mSurface == null || mLayout == null) return;
        SurfaceView video = new SurfaceView(this);
        mLayout.addView(video, 0, new ViewGroup.LayoutParams(-1, -1));
        mSurface.setZOrderMediaOverlay(true);
        mSurface.getHolder().setFormat(PixelFormat.TRANSLUCENT);
        NativePlayer.attach(this, video);
    }

    /** the colour buttons, which SDL does not know, come to the app as F1 to F4 */
    private static int colourKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_PROG_RED: return KeyEvent.KEYCODE_F1;
            case KeyEvent.KEYCODE_PROG_GREEN: return KeyEvent.KEYCODE_F2;
            case KeyEvent.KEYCODE_PROG_YELLOW: return KeyEvent.KEYCODE_F3;
            case KeyEvent.KEYCODE_PROG_BLUE: return KeyEvent.KEYCODE_F4;
            default: return 0;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = colourKey(event.getKeyCode());
        if (code != 0) event = new KeyEvent(event.getDownTime(), event.getEventTime(), event.getAction(), code, event.getRepeatCount(), event.getMetaState());
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onStop() {
        super.onStop();
        WatchNext.refresh(this);
        NativePlayer.stop();
    }
}
