package com.soopchat.app;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import android.app.NotificationManager;
import android.app.PictureInPictureParams;
import android.content.Context;
import android.os.SystemClock;
import androidx.media3.common.MediaItem;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.session.MediaController;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionToken;
import androidx.media3.ui.PlayerView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.Configurator;
import androidx.test.uiautomator.UiDevice;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@androidx.media3.common.util.UnstableApi
@RunWith(AndroidJUnit4.class)
public class SwipeTest {
    @Test public void notificationDismissClosesPip() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        File fixture = new File(context.getExternalFilesDir(null), "nativeDvr.json");
        assumeTrue("Synthetic HLS fixture required", fixture.isFile());
        JSONObject files = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
        File folder = new File(context.getCacheDir(), "ongoing");
        assertTrue(folder.isDirectory() || folder.mkdirs());
        var names = files.keys();
        while (names.hasNext()) {
            String name = names.next();
            assertTrue(name.matches("live\\.m3u8|part\\d+\\.ts"));
            Files.write(new File(folder, name).toPath(), Base64.getDecoder().decode(files.getString(name)));
        }
        File manifest = new File(folder, "live.m3u8");
        String playlist = new String(Files.readAllBytes(manifest.toPath()), StandardCharsets.UTF_8);
        Files.write(manifest.toPath(), (playlist.replace("#EXT-X-PLAYLIST-TYPE:EVENT", "#EXT-X-PLAYLIST-TYPE:VOD")
            + "\n#EXT-X-ENDLIST\n").getBytes(StandardCharsets.UTF_8));
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        AtomicReference<MainActivity> owner = new AtomicReference<>();
        AtomicReference<ListenableFuture<MediaController>> connection = new AtomicReference<>();
        AtomicReference<ExoPlayer> player = new AtomicReference<>();
        UiDevice device = UiDevice.getInstance(instrumentation);
        long idle = Configurator.getInstance().getWaitForIdleTimeout();
        ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class);
        try {
            Configurator.getInstance().setWaitForIdleTimeout(0);
            scenario.onActivity(activity -> {
                owner.set(activity);
                connection.set(new MediaController.Builder(context.getApplicationContext(),
                    new SessionToken(context, new android.content.ComponentName(context, PlaybackService.class))).buildAsync());
            });
            connection.get().get(10, java.util.concurrent.TimeUnit.SECONDS);
            scenario.onActivity(activity -> {
                try {
                    Field sessions = MediaSession.class.getDeclaredField("SESSION_ID_TO_SESSION_MAP");
                    sessions.setAccessible(true);
                    MediaSession session = ((java.util.Map<String, MediaSession>) sessions.get(null)).get("");
                    ExoPlayer video = (ExoPlayer) ((SeekablePlayer) session.getPlayer()).getWrappedPlayer();
                    player.set(video);
                    Field nativeField = MainActivity.class.getDeclaredField("nativePlayer");
                    nativeField.setAccessible(true);
                    PipPlayer nativePlayer = (PipPlayer) nativeField.get(activity);
                    Field controllerField = PipPlayer.class.getDeclaredField("controller");
                    controllerField.setAccessible(true);
                    controllerField.set(nativePlayer, connection.get().get());
                    Field connectionField = PipPlayer.class.getDeclaredField("connection");
                    connectionField.setAccessible(true);
                    connectionField.set(nativePlayer, connection.get());
                    PlayerView view = new PlayerView(activity);
                    view.setPlayer(video);
                    view.setUseController(false);
                    activity.setContentView(view);
                    video.setVolume(0);
                    PlaybackState state = new PlaybackState();
                    state.title = "테스트 방송 제목";
                    state.artist = "테스트 스트리머";
                    video.setMediaSource(new HlsMediaSource.Factory(new DefaultDataSource.Factory(context))
                        .setExtractorFactory(new DefaultHlsExtractorFactory(DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS, true))
                        .createMediaSource(MediaItem.fromUri(android.net.Uri.fromFile(manifest)).buildUpon()
                            .setMediaMetadata(state.metadata()).build()));
                    video.setRepeatMode(androidx.media3.common.Player.REPEAT_MODE_ONE);
                    video.prepare();
                    video.play();
                    activity.enterPictureInPictureMode(new PictureInPictureParams.Builder().build());
                } catch (Exception error) { throw new AssertionError(error); }
            });
            long until = SystemClock.elapsedRealtime() + 15000;
            java.util.concurrent.atomic.AtomicBoolean playing = new java.util.concurrent.atomic.AtomicBoolean();
            while (!playing.get() && SystemClock.elapsedRealtime() < until) {
                instrumentation.runOnMainSync(() -> playing.set(player.get().isPlaying()));
                SystemClock.sleep(100);
            }
            assertTrue("Synthetic PiP video did not start", playing.get());
            assertTrue(owner.get().isInPictureInPictureMode());
            device.openNotification();
            var notification = context.getSystemService(NotificationManager.class).getActiveNotifications()[0].getNotification();
            assertNotNull(notification.deleteIntent);
            notification.deleteIntent.send();
            until = SystemClock.elapsedRealtime() + 10000;
            while (!owner.get().isDestroyed() && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100);
            assertTrue("Explicit close must still finish the app", owner.get().isDestroyed());
            connection.set(null);
            until = SystemClock.elapsedRealtime() + 5000;
            while (context.getSystemService(NotificationManager.class).getActiveNotifications().length > 0
                && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100);
            assertEquals(0, context.getSystemService(NotificationManager.class).getActiveNotifications().length);
        } finally {
            if (owner.get() != null && !owner.get().isDestroyed()) MediaActions.close(context).send();
            instrumentation.runOnMainSync(() -> {
                if (connection.get() != null) MediaController.releaseFuture(connection.get());
            });
            Configurator.getInstance().setWaitForIdleTimeout(idle);
            context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }
}
