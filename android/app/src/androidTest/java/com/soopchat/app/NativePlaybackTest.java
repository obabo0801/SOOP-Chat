package com.soopchat.app;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.webkit.CookieManager;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@androidx.media3.common.util.UnstableApi
@RunWith(AndroidJUnit4.class)
public class NativePlaybackTest {
    private Object field(Object target, String name) {
        try {
            Field value = target.getClass().getDeclaredField(name);
            value.setAccessible(true);
            return value.get(target);
        } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
    }

    private String status(MainActivity activity) {
        PipPlayer pip = (PipPlayer) field(activity, "nativePlayer");
        MediaController player = (MediaController) field(pip, "controller");
        if (player == null) return "controller=pending, started=" + pip.started() + ", error=" + field(pip, "problem");
        return "state=" + player.getPlaybackState() + ", playing=" + player.isPlaying()
            + ", position=" + player.getCurrentPosition() + ", size=" + player.getVideoSize().width
            + ", error=" + (player.getPlayerError() == null ? "none" : player.getPlayerError().getErrorCodeName());
    }

    @Test public void nativeSourceCanPlayWithoutWebRenderer() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        File fixture = new File(context.getExternalFilesDir(null), "nativeSource.json");
        assumeTrue(fixture.isFile());
        JSONObject data = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                PipPlayer pip = (PipPlayer) field(activity, "nativePlayer");
                android.widget.FrameLayout root = (android.widget.FrameLayout) field(activity, "root");
                root.removeAllViews();
                root.addView(pip.view, new android.widget.FrameLayout.LayoutParams(-1, -1));
                PlaybackState state = new PlaybackState();
                state.url = data.optString("source"); state.playing = true; state.live = true;
                pip.start(state, () -> {});
            });
            AtomicReference<Boolean> ready = new AtomicReference<>(false);
            AtomicReference<String> latest = new AtomicReference<>("");
            long until = SystemClock.elapsedRealtime() + 40000;
            while (!ready.get() && SystemClock.elapsedRealtime() < until) {
                scenario.onActivity(activity -> {
                    latest.set(status(activity));
                    PipPlayer pip = (PipPlayer) field(activity, "nativePlayer");
                    MediaController player = (MediaController) field(pip, "controller");
                    ready.set(player != null && player.isPlaying() && player.getVideoSize().width > 0);
                });
                SystemClock.sleep(500);
            }
            assertTrue("Direct native playback failed: " + latest.get(), ready.get());
        }
    }
    @Test public void inlineVideoContinuesInNativePipAfterHome() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        File fixture = new File(context.getExternalFilesDir(null), "nativeSource.json");
        assumeTrue("Local live playback fixture is required", fixture.isFile());
        JSONObject data = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit()
            .putString("address", data.getString("url")).commit();
        instrumentation.runOnMainSync(() -> {
            for (String value : data.optString("cookies").split("; ")) {
                CookieManager.getInstance().setCookie(data.optString("url"), value + "; Path=/; Secure");
            }
            CookieManager.getInstance().flush();
        });
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<Boolean> ready = new AtomicReference<>(false);
            long until = SystemClock.elapsedRealtime() + 60000;
            while (!ready.get() && SystemClock.elapsedRealtime() < until) {
                scenario.onActivity(activity -> ready.set(((PlaybackState) field(activity, "playback")).eligible()));
                SystemClock.sleep(500);
            }
            assertTrue("Web playback did not become ready", ready.get());
            UiDevice.getInstance(instrumentation).pressHome();
            AtomicReference<String> latest = new AtomicReference<>("");
            AtomicReference<Long> first = new AtomicReference<>(-1L);
            AtomicReference<Boolean> progressing = new AtomicReference<>(false);
            until = SystemClock.elapsedRealtime() + 45000;
            while (!progressing.get() && SystemClock.elapsedRealtime() < until) {
                scenario.onActivity(activity -> {
                    latest.set(status(activity));
                    PipPlayer pip = (PipPlayer) field(activity, "nativePlayer");
                    MediaController player = (MediaController) field(pip, "controller");
                    if (activity.isInPictureInPictureMode() && player != null && player.isPlaying()
                        && player.getPlaybackState() == Player.STATE_READY && player.getVideoSize().width > 0) {
                        if (first.get() < 0) first.set(player.getCurrentPosition());
                        progressing.set(player.getCurrentPosition() > first.get() + 2000);
                    }
                });
                SystemClock.sleep(500);
            }
            assertTrue("Native PiP did not progress: " + latest.get(), progressing.get());
            context.startActivity(new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
            ready.set(false);
            until = SystemClock.elapsedRealtime() + 30000;
            while (!ready.get() && SystemClock.elapsedRealtime() < until) {
                scenario.onActivity(activity -> ready.set(!activity.isInPictureInPictureMode()
                    && !(boolean) field(activity, "handed")
                    && ((PlaybackState) field(activity, "playback")).eligible()));
                SystemClock.sleep(500);
            }
            assertTrue("Web playback did not resume after PiP", ready.get());
            UiDevice.getInstance(instrumentation).pressHome();
            first.set(-1L);
            progressing.set(false);
            until = SystemClock.elapsedRealtime() + 45000;
            while (!progressing.get() && SystemClock.elapsedRealtime() < until) {
                scenario.onActivity(activity -> {
                    latest.set(status(activity));
                    PipPlayer pip = (PipPlayer) field(activity, "nativePlayer");
                    MediaController player = (MediaController) field(pip, "controller");
                    if (activity.isInPictureInPictureMode() && player != null && player.isPlaying()
                        && player.getPlaybackState() == Player.STATE_READY && player.getVideoSize().width > 0) {
                        if (first.get() < 0) first.set(player.getCurrentPosition());
                        progressing.set(player.getCurrentPosition() > first.get() + 2000);
                    }
                });
                SystemClock.sleep(500);
            }
            assertTrue("Second native PiP did not progress: " + latest.get(), progressing.get());
        } finally {
            context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }
}
