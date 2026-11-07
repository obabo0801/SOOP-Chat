package com.soopchat.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import java.net.URL;
import java.net.HttpURLConnection;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.function.DoubleConsumer;

@androidx.media3.common.util.UnstableApi
final class WebMedia {
    private static final int ID = 1002;
    private final Context context;
    private final MediaSession session;
    private final NotificationManager notifications;
    private final PendingIntent open;
    private final ExecutorService images = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private com.soopchat.app.PlaybackState current;
    private Bitmap image;
    private String artwork = "";
    private int generation;
    private boolean playing;
    private long second = -1;
    private double duration = -1;

    WebMedia(Context context, Consumer<Boolean> control, DoubleConsumer seek, Runnable close) {
        this.context = context;
        notifications = context.getSystemService(NotificationManager.class);
        MediaActions.channel(context);
        open = MediaActions.open(context);
        session = new MediaSession(context, "SOOP Chat Web");
        session.setSessionActivity(open);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { control.accept(true); }
            @Override public void onPause() { control.accept(false); }
            @Override public void onStop() { close.run(); }
            @Override public void onSeekTo(long position) {
                if (current != null && current.seekable()) seek.accept(current.seek(position / 1000d));
            }
            @Override public void onCustomAction(String action, android.os.Bundle extras) {
                if (MediaActions.CLOSE.equals(action)) close.run();
            }
        }, main);
    }

    void update(com.soopchat.app.PlaybackState state) {
        if (!com.soopchat.app.PlaybackState.secure(state.url)) { hide(); return; }
        if (!state.playing && !session.isActive()) return;
        boolean changed = current == null || !current.title.equals(state.title)
            || !current.artist.equals(state.artist) || !current.artwork.equals(state.artwork)
            || playing != state.playing || second != (long) state.position || duration != state.end;
        current = state;
        playing = state.playing;
        second = (long) state.position;
        duration = state.end;
        session.setActive(true);
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP
                | (state.seekable() ? PlaybackState.ACTION_SEEK_TO : 0))
            .addCustomAction(MediaActions.CLOSE, "닫기", android.R.drawable.ic_menu_close_clear_cancel)
            .setState(state.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                (long) (state.position * 1000), state.playing ? 1 : 0).build());
        if (!artwork.equals(state.artwork)) {
            artwork = state.artwork;
            image = null;
            int request = ++generation;
            if (com.soopchat.app.PlaybackState.secure(artwork)) {
                String address = artwork;
                images.execute(() -> {
                    Bitmap loaded = null;
                    HttpURLConnection connection = null;
                    try {
                        connection = (HttpURLConnection) new URL(address).openConnection();
                        connection.setConnectTimeout(5000);
                        connection.setReadTimeout(5000);
                        try (var stream = connection.getInputStream()) { loaded = BitmapFactory.decodeStream(stream); }
                    } catch (Exception ignored) { /* Playback information remains available without artwork. */ }
                    finally { if (connection != null) connection.disconnect(); }
                    Bitmap result = loaded;
                    main.post(() -> {
                        if (generation == request && current != null && session.isActive()) { image = result; show(); }
                    });
                });
            }
        }
        if (changed) show();
    }

    // MediaStyle notifications with an active MediaSession are exempt from notification permission.
    @android.annotation.SuppressLint("NotificationPermission")
    private void show() {
        if (current == null || !session.isActive()) return;
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, current.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, com.soopchat.app.PlaybackState.description(current.artist, current.position))
            .putLong(MediaMetadata.METADATA_KEY_DURATION, current.seekable() ? (long) (current.end * 1000) : -1)
            .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, image)
            .putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, image).build());
        notifications.notify(ID, new Notification.Builder(context, MediaActions.CHANNEL)
            .setSmallIcon(R.drawable.icon).setContentTitle(current.title)
            .setContentText(com.soopchat.app.PlaybackState.description(current.artist, current.position))
            .setLargeIcon(image).setContentIntent(open).setOnlyAlertOnce(true).setShowWhen(false)
            .setDeleteIntent(MediaActions.swipe(context))
            .setVisibility(Notification.VISIBILITY_PUBLIC).setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(context,
                android.R.drawable.ic_menu_close_clear_cancel), "닫기", MediaActions.home(context)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0))
            .setOngoing(false).build());
    }

    void hide() {
        generation++;
        current = null;
        artwork = "";
        image = null;
        session.setActive(false);
        notifications.cancel(ID);
    }

    void release() {
        hide();
        images.shutdownNow();
        session.release();
    }
}
