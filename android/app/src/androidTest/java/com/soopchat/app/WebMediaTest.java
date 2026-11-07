package com.soopchat.app;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 33)
public class WebMediaTest {
    @Test public void nativeMediaAdvertisesAndHandlesCloseCommand() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        AtomicReference<com.google.common.util.concurrent.ListenableFuture<androidx.media3.session.MediaController>> future = new AtomicReference<>();
        AtomicReference<MainActivity> owner = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                owner.set(activity);
                future.set(new androidx.media3.session.MediaController.Builder(context,
                    new androidx.media3.session.SessionToken(context, new android.content.ComponentName(context, PlaybackService.class))).buildAsync());
            });
            var controller = future.get().get(10, java.util.concurrent.TimeUnit.SECONDS);
            instrumentation.runOnMainSync(() -> {
                var command = new androidx.media3.session.SessionCommand(MediaActions.CLOSE, android.os.Bundle.EMPTY);
                assertTrue(controller.getAvailableSessionCommands().contains(command));
                assertTrue(controller.getMediaButtonPreferences().stream().anyMatch(button -> "닫기".contentEquals(button.displayName)));
                controller.sendCustomCommand(command, android.os.Bundle.EMPTY);
            });
            long until = SystemClock.elapsedRealtime() + 10000;
            while (!owner.get().isDestroyed() && SystemClock.elapsedRealtime() < until) SystemClock.sleep(200);
            assertTrue("Native media close command did not close the app", owner.get().isDestroyed());
        } finally {
            if (future.get() != null) instrumentation.runOnMainSync(() -> androidx.media3.session.MediaController.releaseFuture(future.get()));
        }
    }

    private Object field(Object object, String name) throws Exception {
        Field field = MainActivity.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(object);
    }

    @Test public void inlineMediaShowsTimeAndReturnsHome() throws Exception { verify(false, false); }
    @Test public void inlineNotificationDismissReturnsHome() throws Exception { verify(false, true); }
    @Test public void pipMediaCloseActionRemovesTask() throws Exception { verify(true, false); }

    private void verify(boolean pip, boolean swipe) throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        File fixture = new File(context.getExternalFilesDir(null), "nativeMedia.json");
        assumeTrue("Artwork fixture is required", fixture.isFile());
        JSONObject data = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        AtomicReference<MainActivity> owner = new AtomicReference<>();
        ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class);
        try {
            scenario.onActivity(activity -> {
                owner.set(activity);
                try {
                    Method open = MainActivity.class.getDeclaredMethod("open", String.class);
                    open.setAccessible(true);
                    open.invoke(activity, "https://example.com/2/");
                } catch (Exception error) { throw new AssertionError(error); }
            });
            SystemClock.sleep(3000);
            scenario.onActivity(activity -> {
                try {
                    PlaybackState state = new PlaybackState();
                    state.url = "https://example.com/live.m3u8";
                    state.title = "테스트 방송 제목";
                    state.artist = "테스트 스트리머";
                    state.artwork = data.optString("artwork");
                    state.playing = true;
                    state.position = 3723;
                    Field playback = MainActivity.class.getDeclaredField("playback");
                    playback.setAccessible(true);
                    playback.set(activity, state);
                    ((WebMedia) field(activity, "webMedia")).update(state);
                    Method refresh = MainActivity.class.getDeclaredMethod("refreshPip");
                    refresh.setAccessible(true);
                    refresh.invoke(activity);
                    assertEquals(state.artwork, state.metadata().artworkUri.toString());
                } catch (Exception error) { throw new AssertionError(error); }
            });
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            Notification media = null;
            long until = SystemClock.elapsedRealtime() + 20000;
            while (media == null && SystemClock.elapsedRealtime() < until) {
                for (var notification : manager.getActiveNotifications()) {
                    if (notification.getId() == 1002 && notification.getNotification().getLargeIcon() != null) {
                        media = notification.getNotification();
                    }
                }
                SystemClock.sleep(200);
            }
            assertNotNull("Streamer artwork did not reach the media notification", media);
            assertEquals("테스트 방송 제목", media.extras.getString(Notification.EXTRA_TITLE));
            assertEquals("테스트 스트리머 01:02:03", media.extras.getString(Notification.EXTRA_TEXT));
            assertEquals("닫기", media.actions[0].title.toString());
            assertEquals(MediaActions.CHANNEL, media.getChannelId());
            assertEquals(R.drawable.icon, media.getSmallIcon().getResId());
            assertNotNull(media.contentIntent);
            assertFalse((media.flags & Notification.FLAG_ONGOING_EVENT) != 0);
            assertNotNull(media.deleteIntent);
            assertNotNull(media.extras.getParcelable(Notification.EXTRA_MEDIA_SESSION));
            if (pip) {
            UiDevice.getInstance(instrumentation).pressHome();
            until = SystemClock.elapsedRealtime() + 10000;
            while (!owner.get().isInPictureInPictureMode() && SystemClock.elapsedRealtime() < until) SystemClock.sleep(200);
            assertTrue("PiP did not open", owner.get().isInPictureInPictureMode());
            scenario.onActivity(activity -> {
                try {
                    MediaActions.close(context).send();
                }
                catch (Exception error) { throw new AssertionError(error); }
            });
            } else {
                Notification original = media;
                scenario.onActivity(activity -> {
                    try {
                        PlaybackState state = (PlaybackState) field(activity, "playback");
                        state.position = 3725;
                        ((WebMedia) field(activity, "webMedia")).update(state);
                    } catch (Exception error) { throw new AssertionError(error); }
                });
                boolean updated = false;
                until = SystemClock.elapsedRealtime() + 3000;
                while (!updated && SystemClock.elapsedRealtime() < until) {
                    for (var notification : manager.getActiveNotifications()) {
                        if (notification.getId() == 1002) {
                            updated = "테스트 스트리머 01:02:05".equals(notification.getNotification().extras.getString(Notification.EXTRA_TEXT));
                        }
                    }
                    SystemClock.sleep(100);
                }
                assertTrue("Playback time did not update", updated);
                assertTrue(original.actions[0].actionIntent.isActivity());
                if (swipe) original.deleteIntent.send();
                else {
                    android.media.session.MediaSession.Token token = original.extras.getParcelable(Notification.EXTRA_MEDIA_SESSION);
                    new android.media.session.MediaController(context, token).getTransportControls()
                        .sendCustomAction(MediaActions.CLOSE, android.os.Bundle.EMPTY);
                }
            }
            until = SystemClock.elapsedRealtime() + 10000;
            if (pip) {
                while (!owner.get().isDestroyed() && SystemClock.elapsedRealtime() < until) SystemClock.sleep(200);
                assertTrue("PiP close did not finish the app", owner.get().isDestroyed());
                for (var task : context.getSystemService(ActivityManager.class).getAppTasks()) {
                    assertNotEquals(owner.get().getTaskId(), task.getTaskInfo().taskId);
                }
            } else {
                AtomicReference<String> address = new AtomicReference<>("");
                while (!"https://example.com/".equals(address.get()) && SystemClock.elapsedRealtime() < until) {
                    scenario.onActivity(activity -> {
                        try { address.set(((android.webkit.WebView) field(activity, "web")).getUrl()); }
                        catch (Exception error) { throw new AssertionError(error); }
                    });
                    SystemClock.sleep(100);
                }
                assertEquals("https://example.com/", address.get());
                assertFalse("Inline media close must keep the home screen open", owner.get().isFinishing());
            }
            assertEquals(0, manager.getActiveNotifications().length);
        } finally {
            if (owner.get() != null && !owner.get().isDestroyed()) {
                MediaActions.close(context).send();
                long until = SystemClock.elapsedRealtime() + 10000;
                while (!owner.get().isDestroyed() && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100);
            }
            if (owner.get() == null || !owner.get().isDestroyed()) scenario.close();
            context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }
}
