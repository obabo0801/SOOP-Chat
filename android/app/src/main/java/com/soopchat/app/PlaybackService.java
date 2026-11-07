package com.soopchat.app;

import android.content.Intent;
import android.app.NotificationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.CommandButton;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionResult;
import androidx.media3.session.SessionError;
import androidx.media3.common.Player;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.Collections;

@androidx.media3.common.util.UnstableApi
public final class PlaybackService extends MediaSessionService {
    private MediaSession session;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final Runnable clock = new Runnable() {
        @Override public void run() {
            if (session == null) return;
            Player player = session.getPlayer();
            var item = player.getCurrentMediaItem();
            if (item != null && player.getPlaybackState() == Player.STATE_READY && item.mediaMetadata.extras != null) {
                String artist = item.mediaMetadata.extras.getString("soop.artist", "");
                String description = PlaybackState.description(artist, player.getCurrentPosition() / 1000d);
                if (!description.contentEquals(item.mediaMetadata.artist == null ? "" : item.mediaMetadata.artist)) {
                    player.replaceMediaItem(player.getCurrentMediaItemIndex(), item.buildUpon()
                        .setMediaMetadata(item.mediaMetadata.buildUpon().setArtist(description).build()).build());
                }
            }
            timer.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        setMediaNotificationProvider(new PipNotification(this));
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent(WebSettings.getDefaultUserAgent(this))
            .setConnectTimeoutMs(15000).setReadTimeoutMs(15000);
        ResolvingDataSource.Factory source = new ResolvingDataSource.Factory(http, data -> {
            String cookie = CookieManager.getInstance().getCookie(data.uri.toString());
            return cookie == null ? data : data.withAdditionalHeaders(Collections.singletonMap("Cookie", cookie));
        });
        // SOOP MPEG-TS segments can omit AUD markers. Detect frame boundaries explicitly.
        ExoPlayer player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new HlsMediaSource.Factory(source).setExtractorFactory(
                new DefaultHlsExtractorFactory(DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS, true)))
            .build();
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        SessionCommand close = new SessionCommand(MediaActions.CLOSE, Bundle.EMPTY);
        CommandButton button = new CommandButton.Builder(CommandButton.ICON_STOP)
            .setCustomIconResId(android.R.drawable.ic_menu_close_clear_cancel)
            .setDisplayName("닫기").setSlots(CommandButton.SLOT_BACK).setSessionCommand(close).build();
        session = new MediaSession.Builder(this, new SeekablePlayer(player))
            .setSessionActivity(MediaActions.open(this))
            .setMediaButtonPreferences(Collections.singletonList(button))
            .setCallback(new MediaSession.Callback() {
                @Override public int onPlayerCommandRequest(MediaSession session,
                    MediaSession.ControllerInfo controller, int command) {
                    if (command == Player.COMMAND_STOP && !getPackageName().equals(controller.getPackageName())) {
                        MediaActions.dismiss(PlaybackService.this);
                    }
                    return SessionResult.RESULT_SUCCESS;
                }
                @Override public MediaSession.ConnectionResult onConnect(MediaSession session, MediaSession.ControllerInfo controller) {
                    return new MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                        .setAvailableSessionCommands(MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(close).build())
                        .build();
                }
                @Override public ListenableFuture<SessionResult> onCustomCommand(MediaSession session,
                    MediaSession.ControllerInfo controller, SessionCommand command, Bundle args) {
                    if (!MediaActions.CLOSE.equals(command.customAction)) {
                        return Futures.immediateFuture(new SessionResult(SessionError.ERROR_NOT_SUPPORTED));
                    }
                    MediaActions.dismiss(PlaybackService.this);
                    return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                }
            }).build();
        timer.post(clock);
    }

    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) {
        return controller.isTrusted() || getPackageName().equals(controller.getPackageName()) ? session : null;
    }

    @Override public void onTaskRemoved(Intent intent) {
        if (!isPlaybackOngoing()) stopSelf();
    }

    @Override public void onDestroy() {
        timer.removeCallbacks(clock);
        if (session != null) { session.getPlayer().release(); session.release(); session = null; }
        super.onDestroy();
        getSystemService(NotificationManager.class).cancel(DefaultMediaNotificationProvider.DEFAULT_NOTIFICATION_ID);
    }
}
