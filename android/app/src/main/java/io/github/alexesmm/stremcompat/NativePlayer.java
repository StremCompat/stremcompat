package io.github.alexesmm.stremcompat;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.SurfaceView;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;

import java.util.ArrayList;
import java.util.List;

/**
 * ExoPlayer for the native app (LG-C src/platform/android_player.c). The C side calls these static
 * methods from its own thread: the orders go to the main thread, and what the player reports is
 * kept in fields the C side reads once per frame. The picture is drawn on a surface under SDL's.
 */
final class NativePlayer {
    /* as player_state in LG-C src/platform/player.h */
    private static final int IDLE = 0, LOADING = 1, PLAYING = 2, PAUSED = 3, ENDED = 4, FAILED = 5;

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Context context;
    private static SurfaceView surface;
    private static ExoPlayer player;

    private static volatile int state = IDLE;
    private static volatile boolean buffering;
    private static volatile long position, duration;
    private static volatile String error = "", audio = "";
    private static volatile int audioAt;
    private static final List<Tracks.Group> audioGroups = new ArrayList<>();

    private NativePlayer() {}

    static void attach(Context c, SurfaceView s) {
        context = c;
        surface = s;
    }

    private static final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            position = player.getCurrentPosition();
            duration = Math.max(0, player.getDuration());
            main.postDelayed(this, 250);
        }
    };

    private static final Player.Listener listener = new Player.Listener() {
        @Override public void onPlaybackStateChanged(int s) {
            buffering = s == Player.STATE_BUFFERING;
            if (s == Player.STATE_ENDED) state = ENDED;
            else if (s == Player.STATE_READY && state == LOADING) state = player.getPlayWhenReady() ? PLAYING : PAUSED;
        }

        @Override public void onIsPlayingChanged(boolean playing) {
            if (state == LOADING || state == ENDED || state == FAILED) return;
            state = playing || player.getPlayWhenReady() ? PLAYING : PAUSED;
        }

        @Override public void onTracksChanged(Tracks tracks) {
            StringBuilder list = new StringBuilder();
            synchronized (audioGroups) {
                audioGroups.clear();
                for (Tracks.Group g : tracks.getGroups()) {
                    if (g.getType() != C.TRACK_TYPE_AUDIO) continue;
                    Format f = g.getTrackFormat(0);
                    if (g.isSelected()) audioAt = audioGroups.size();
                    audioGroups.add(g);
                    if (list.length() > 0) list.append('\n');
                    String name = f.label != null ? f.label : (f.channelCount > 2 ? f.channelCount + "ch" : "");
                    list.append(f.language == null ? "" : f.language).append('\t').append(name);
                }
            }
            audio = list.toString();
        }

        @Override public void onPlayerError(PlaybackException e) {
            error = e.getErrorCodeName();
            state = FAILED;
        }
    };

    private static void release() {
        main.removeCallbacks(tick);
        if (player == null) return;
        player.removeListener(listener);
        player.release();
        player = null;
    }

    static void open(String url, long startMs) {
        state = LOADING;
        error = "";
        audio = "";
        position = startMs;
        duration = 0;
        main.post(() -> {
            release();
            DefaultRenderersFactory renderers = new DefaultRenderersFactory(context).setEnableDecoderFallback(true);
            player = new ExoPlayer.Builder(context, renderers).build();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
            player.setVideoSurfaceView(surface);
            /* the app draws the subtitles itself */
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build());
            player.addListener(listener);
            player.setMediaItem(MediaItem.fromUri(url), startMs);
            player.setPlayWhenReady(true);
            player.prepare();
            main.post(tick);
        });
    }

    static void play() {
        main.post(() -> {
            if (player != null) player.play();
        });
    }

    static void pause() {
        main.post(() -> {
            if (player != null) player.pause();
        });
    }

    static void seek(long ms) {
        position = ms;
        main.post(() -> {
            if (player != null) player.seekTo(ms);
        });
    }

    static void stop() {
        state = IDLE;
        main.post(NativePlayer::release);
    }

    static void speed(float rate) {
        main.post(() -> {
            if (player != null) player.setPlaybackParameters(new PlaybackParameters(rate));
        });
    }

    static void selectAudio(int index) {
        main.post(() -> {
            Tracks.Group g;
            synchronized (audioGroups) {
                if (player == null || index < 0 || index >= audioGroups.size()) return;
                g = audioGroups.get(index);
            }
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), 0)).build());
        });
    }

    static long state() { return state; }
    static long buffering() { return buffering ? 1 : 0; }
    static long position() { return position; }
    static long duration() { return duration; }
    static long audioCurrent() { return audioAt; }
    static String error() { return error; }
    static String audioTracks() { return audio; }
}
