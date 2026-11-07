package com.soopchat.app;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import android.app.PictureInPictureParams;
import android.content.Context;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.os.SystemClock;
import android.widget.FrameLayout;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.ui.PlayerView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Configurator;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.json.JSONObject;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.lang.reflect.Field;
import org.junit.Test;
import org.junit.runner.RunWith;

@androidx.media3.common.util.UnstableApi
@RunWith(AndroidJUnit4.class)
public class DvrTest {
    @Test @android.annotation.SuppressLint("NotificationPermission")
    public void livePipPublishesSeekableTimelineAndSeeksNativeVideo() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        File fixture = new File(context.getExternalFilesDir(null), "nativeDvr.json");
        assumeTrue("Synthetic EVENT HLS fixture required", fixture.isFile());
        JSONObject data = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
        File folder = new File(context.getCacheDir(), "dvr");
        assertTrue(folder.isDirectory() || folder.mkdirs());
        var names = data.keys();
        while (names.hasNext()) {
            String name = names.next();
            assertTrue(name.matches("live\\.m3u8|part\\d+\\.ts"));
            Files.write(new File(folder, name).toPath(), Base64.getDecoder().decode(data.getString(name)));
        }
        File manifest = new File(folder, "live.m3u8");
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        AtomicReference<ExoPlayer> player = new AtomicReference<>();
        AtomicReference<MediaSession> session = new AtomicReference<>();
        AtomicReference<MediaController> controls = new AtomicReference<>();
        AtomicReference<com.google.common.util.concurrent.ListenableFuture<androidx.media3.session.MediaController>> connection = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> connection.set(new androidx.media3.session.MediaController.Builder(context.getApplicationContext(),
                new androidx.media3.session.SessionToken(context, new android.content.ComponentName(context, PlaybackService.class))).buildAsync()));
            connection.get().get(10, java.util.concurrent.TimeUnit.SECONDS);
            scenario.onActivity(activity -> {
                try {
                    Field sessions = MediaSession.class.getDeclaredField("SESSION_ID_TO_SESSION_MAP");
                    sessions.setAccessible(true);
                    session.set(((java.util.Map<String, MediaSession>) sessions.get(null)).get(""));
                } catch (Exception error) { throw new AssertionError(error); }
                assertNotNull("Native playback service session missing", session.get());
                ExoPlayer nativePlayer = (ExoPlayer) ((SeekablePlayer) session.get().getPlayer()).getWrappedPlayer();
                player.set(nativePlayer);
                nativePlayer.setVolume(0);
                PlayerView view = new PlayerView(activity);
                view.setUseController(false);
                view.setPlayer(nativePlayer);
                activity.setContentView(view, new FrameLayout.LayoutParams(-1, -1));
                controls.set(new MediaController(activity, session.get().getPlatformToken()));
                PlaybackState state = new PlaybackState();
                state.title = "라이브 타임라인 검증";
                nativePlayer.setMediaSource(new HlsMediaSource.Factory(new DefaultDataSource.Factory(activity))
                    .setExtractorFactory(new DefaultHlsExtractorFactory(DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS, true))
                    .createMediaSource(MediaItem.fromUri(android.net.Uri.fromFile(manifest)).buildUpon()
                        .setMediaMetadata(state.metadata()).build()));
                nativePlayer.prepare();
                nativePlayer.play();
            });
            AtomicBoolean ready = new AtomicBoolean();
            long until = SystemClock.elapsedRealtime() + 30000;
            while (!ready.get() && SystemClock.elapsedRealtime() < until) {
                instrumentation.runOnMainSync(() -> ready.set(player.get().isPlaying()
                    && player.get().getPlaybackState() == Player.STATE_READY && player.get().getVideoSize().width > 0));
                SystemClock.sleep(100);
            }
            assertTrue("Synthetic native live video did not play", ready.get());
            scenario.onActivity(activity -> {
                assertTrue(player.get().isCurrentMediaItemLive());
                assertTrue(player.get().isCurrentMediaItemSeekable());
                session.get().setPlayer(player.get());
                var item = player.get().getCurrentMediaItem();
                player.get().replaceMediaItem(0, item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setTitle("변경 전").build()).build());
            });
            until = SystemClock.elapsedRealtime() + 5000;
            while ((controls.get().getMetadata() == null || controls.get().getMetadata().getLong(MediaMetadata.METADATA_KEY_DURATION) > 0)
                && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100);
            assertNotNull(controls.get().getMetadata());
            assertTrue("Unmodified Media3 unexpectedly exposed a live seek bar",
                controls.get().getMetadata().getLong(MediaMetadata.METADATA_KEY_DURATION) <= 0);
            scenario.onActivity(activity -> {
                session.get().setPlayer(new SeekablePlayer(player.get()));
                var item = player.get().getCurrentMediaItem();
                player.get().replaceMediaItem(0, item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setTitle("라이브 타임라인 검증").build()).build());
                assertTrue(activity.enterPictureInPictureMode(new PictureInPictureParams.Builder().build()));
            });
            until = SystemClock.elapsedRealtime() + 5000;
            while ((controls.get().getMetadata() == null || controls.get().getMetadata().getLong(MediaMetadata.METADATA_KEY_DURATION) <= 0)
                && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100);
            assertEquals(30000, controls.get().getMetadata().getLong(MediaMetadata.METADATA_KEY_DURATION), 200);
            assertTrue((controls.get().getPlaybackState().getActions() & android.media.session.PlaybackState.ACTION_SEEK_TO) != 0);
            controls.get().getTransportControls().seekTo(5000);
            AtomicReference<Long> position = new AtomicReference<>(Long.MAX_VALUE);
            until = SystemClock.elapsedRealtime() + 5000;
            while ((position.get() < 4900 || position.get() > 7000) && SystemClock.elapsedRealtime() < until) {
                instrumentation.runOnMainSync(() -> position.set(player.get().getCurrentPosition()));
                SystemClock.sleep(100);
            }
            assertTrue("Platform seek did not reach native PiP video", position.get() >= 4900 && position.get() <= 7000);
            long sought = position.get();
            ready.set(false);
            until = SystemClock.elapsedRealtime() + 5000;
            while (!ready.get() && SystemClock.elapsedRealtime() < until) {
                instrumentation.runOnMainSync(() -> ready.set(player.get().isPlaying() && player.get().getCurrentPosition() > sought + 500));
                SystemClock.sleep(100);
            }
            assertTrue("Native video did not resume after seeking", ready.get());
            instrumentation.runOnMainSync(() -> assertTrue("Underlying live playback was changed", player.get().isCurrentMediaItemLive()));
            scenario.onActivity(activity -> assertTrue("Native video is not in PiP", activity.isInPictureInPictureMode()));
            UiDevice device = UiDevice.getInstance(instrumentation);
            long idle = Configurator.getInstance().getWaitForIdleTimeout();
            try {
                Configurator.getInstance().setWaitForIdleTimeout(0);
                device.openNotification();
                SystemClock.sleep(700);
                var bar = device.findObject(By.res("com.android.systemui:id/media_progress_bar"));
                assertNotNull("PiP seek bar is not visible in Android media controls", bar);
                assertTrue("PiP seek bar is disabled", bar.isEnabled());
                device.takeScreenshot(new File(context.getExternalFilesDir(null), "dvrPip.png"));
                var bounds = bar.getVisibleBounds();
                device.swipe(bounds.left + 80, bounds.centerY(), bounds.centerX(), bounds.centerY(), 12);
                ready.set(false);
                until = SystemClock.elapsedRealtime() + 5000;
                while (!ready.get() && SystemClock.elapsedRealtime() < until) {
                    instrumentation.runOnMainSync(() -> ready.set(player.get().isPlaying()
                        && player.get().getCurrentPosition() >= 12000 && player.get().getCurrentPosition() <= 19000));
                    SystemClock.sleep(100);
                }
                assertTrue("Dragging the visible PiP media timeline did not seek the native video", ready.get());
                device.pressBack();
            } finally { Configurator.getInstance().setWaitForIdleTimeout(idle); }
        } finally {
            instrumentation.runOnMainSync(() -> {
                if (player.get() != null) { player.get().stop(); player.get().clearMediaItems(); }
                if (connection.get() != null) androidx.media3.session.MediaController.releaseFuture(connection.get());
                context.stopService(new android.content.Intent(context, PlaybackService.class));
            });
        }
    }
}
