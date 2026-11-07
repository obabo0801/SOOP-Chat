package com.soopchat.app;

import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.ImageView;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import androidx.media3.ui.PlayerView;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.concurrent.ExecutionException;

@androidx.media3.common.util.UnstableApi
final class PipPlayer {
    final PlayerView view;
    private final Context context;
    private MediaController controller;
    private ListenableFuture<MediaController> connection;
    private ListenableFuture<MediaController> prepared;
    private final ImageView preview;
    private PlaybackState requested;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private Runnable deadline;
    private String problem = "";

    PipPlayer(Context context) {
        this.context = context;
        view = new PlayerView(context);
        view.setBackgroundColor(android.graphics.Color.BLACK);
        view.setUseController(false);
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS);
        view.setVisibility(View.GONE);
        preview = new ImageView(context);
        preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
        view.getOverlayFrameLayout().addView(preview, new android.widget.FrameLayout.LayoutParams(-1, -1));
    }

    private ListenableFuture<MediaController> connect() {
        Context application = context.getApplicationContext();
        SessionToken token = new SessionToken(application, new ComponentName(application, PlaybackService.class));
        return new MediaController.Builder(application, token).buildAsync();
    }

    void warm() {
        if (connection == null && prepared == null) prepared = connect();
    }

    void start(PlaybackState state, Runnable failed) {
        start(state, null, failed);
    }

    void start(PlaybackState state, Bitmap frame, Runnable failed) {
        ListenableFuture<MediaController> ready = prepared;
        prepared = null;
        close();
        problem = "";
        requested = state;
        view.setCustomErrorMessage(null);
        view.setVisibility(View.VISIBLE);
        preview.setImageBitmap(frame);
        preview.setVisibility(frame == null ? View.GONE : View.VISIBLE);
        ListenableFuture<MediaController> pending = ready == null ? connect() : ready;
        connection = pending;
        deadline = () -> {
            if (connection == pending && (controller == null || controller.getPlaybackState() != Player.STATE_READY)) {
                failure("영상 연결 시간이 초과되었습니다.", "TIMEOUT", failed);
            }
        };
        timer.postDelayed(deadline, 30000);
        pending.addListener(() -> {
            if (connection != pending) return;
            try {
                controller = pending.get();
                controller.addListener(new Player.Listener() {
                    @Override public void onRenderedFirstFrame() {
                        if (connection == pending) { preview.setVisibility(View.GONE); preview.setImageDrawable(null); }
                    }
                    @Override public void onPlayerError(PlaybackException error) {
                        if (connection == pending) failure("영상을 불러오지 못했습니다.", error.getErrorCodeName(), failed);
                    }
                    @Override public void onPlaybackStateChanged(int value) {
                        if (connection == pending && (value == Player.STATE_READY || value == Player.STATE_ENDED)) {
                            timer.removeCallbacks(deadline);
                        }
                    }
                });
                view.setPlayer(controller);
                controller.setVolume(state.muted ? 0 : state.volume);
                MediaItem item = new MediaItem.Builder().setUri(Uri.parse(state.url))
                    .setMimeType("application/x-mpegURL")
                    .setMediaMetadata(state.metadata())
                    .setLiveConfiguration(new MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(4000).build())
                    .build();
                controller.setMediaItem(item);
                if (!state.live) controller.seekTo(Math.max(0, (long) (state.position * 1000)));
                controller.prepare();
                controller.play();
            } catch (ExecutionException | InterruptedException | RuntimeException error) {
                if (error instanceof InterruptedException) Thread.currentThread().interrupt();
                failure("플레이어에 연결하지 못했습니다.", error.getClass().getSimpleName(), failed);
            }
        }, ContextCompat.getMainExecutor(context));
    }

    private void failure(String message, String reason, Runnable failed) {
        problem = reason;
        close();
        view.setCustomErrorMessage(message);
        view.setVisibility(View.VISIBLE);
        failed.run();
    }

    boolean playing() {
        return controller == null ? requested != null && requested.playing
            : controller.getPlayWhenReady() && controller.getPlaybackState() != Player.STATE_ENDED;
    }

    boolean started() { return requested != null; }

    double position() {
        return controller == null ? requested == null ? 0 : requested.position
            : controller.getCurrentPosition() / 1000d;
    }

    boolean live() {
        if (controller == null || controller.getDuration() < 0) return requested != null && requested.live;
        return controller.isCurrentMediaItemLive() && controller.getDuration() - controller.getCurrentPosition() <= 8000;
    }

    void close() {
        ListenableFuture<MediaController> previous = connection;
        ListenableFuture<MediaController> unused = prepared;
        connection = null;
        prepared = null;
        if (deadline != null) timer.removeCallbacks(deadline);
        MediaController player = controller;
        controller = null;
        view.setPlayer(null);
        preview.setVisibility(View.GONE);
        preview.setImageDrawable(null);
        requested = null;
        view.setVisibility(View.GONE);
        try {
            if (player != null && player.isConnected()) { player.stop(); player.clearMediaItems(); }
        } catch (IllegalStateException ignored) { /* A disconnected controller is already stopped. */ }
        finally {
            release(previous);
            release(unused);
        }
    }

    private void release(ListenableFuture<MediaController> future) {
        if (future == null) return;
        try { MediaController.releaseFuture(future); }
        catch (IllegalStateException | IllegalArgumentException ignored) { /* The service binding was already removed. */ }
    }
}
