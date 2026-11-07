package com.soopchat.app;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import android.app.ActivityManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.SystemClock;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.session.MediaController;
import androidx.media3.session.MediaSession;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Configurator;
import androidx.test.uiautomator.UiDevice;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@androidx.media3.common.util.UnstableApi
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 35)
public class TransitionTest {
    private Object field(Object object, String name) throws Exception {
        Field value = object.getClass().getDeclaredField(name);
        value.setAccessible(true);
        return value.get(object);
    }

    private interface Check { boolean test(MainActivity activity) throws Exception; }

    private void waitFor(ActivityScenario<MainActivity> scenario, Check check, String message) {
        AtomicBoolean ready = new AtomicBoolean();
        long until = SystemClock.elapsedRealtime() + 15000;
        while (!ready.get() && SystemClock.elapsedRealtime() < until) {
            scenario.onActivity(activity -> {
                try { ready.set(check.test(activity)); }
                catch (Exception error) { throw new AssertionError(error); }
            });
            SystemClock.sleep(100);
        }
        assertTrue(message, ready.get());
    }

    @Test public void homeAutomaticallyTransfersVideoAndSystemPipCloseRemovesTask() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        File fixture = new File(context.getExternalFilesDir(null), "nativeTransition.json");
        assumeTrue("Synthetic web and HLS fixtures required", fixture.isFile());
        JSONObject data = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
        File folder = new File(context.getCacheDir(), "transition");
        assertTrue(folder.isDirectory() || folder.mkdirs());
        JSONObject files = data.getJSONObject("files");
        var names = files.keys();
        while (names.hasNext()) {
            String name = names.next();
            assertTrue(name.matches("live\\.m3u8|part\\d+\\.ts"));
            Files.write(new File(folder, name).toPath(), Base64.getDecoder().decode(files.getString(name)));
        }
        byte[] clip = Base64.getDecoder().decode(data.getString("clip"));
        String page = "<html><video id='video' autoplay muted loop playsinline src='/clip.mp4'></video><script type='module'>"
            + data.getString("native") + "\nconst video=document.getElementById('video');let live=false,moving=false;"
            + "const $=id=>document.getElementById(id);const position=()=>video.seekable.end(video.seekable.length-1)-4;"
            + "const overlay=()=>{};" + data.getString("seek")
            + "\ncreateNative(video,()=>({url:'https://example.invalid/native.m3u8',title:'전환 검증',enabled:true,paused:video.paused,live}),"
            + "data=>{if(data.type==='seek')seekVideo(data.position);else{if(Number.isFinite(data.position))video.currentTime=data.position;"
            + "if(data.playing)video.play();else video.pause()}});video.play();</script></html>";
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        UiDevice device = UiDevice.getInstance(instrumentation);
        long idle = Configurator.getInstance().getWaitForIdleTimeout();
        AtomicReference<MainActivity> owner = new AtomicReference<>();
        Set<ExoPlayer> hooked = Collections.newSetFromMap(new IdentityHashMap<>());
        ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class);
        try {
            Configurator.getInstance().setWaitForIdleTimeout(0);
            scenario.onActivity(activity -> {
                owner.set(activity);
                try {
                    Method open = MainActivity.class.getDeclaredMethod("open", String.class);
                    open.setAccessible(true);
                    open.invoke(activity, "https://example.com/");
                    WebView web = (WebView) field(activity, "web");
                    web.setWebViewClient(new WebViewClient() {
                        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                            boolean video = "/clip.mp4".equals(request.getUrl().getPath());
                            byte[] bytes = video ? clip : page.getBytes(StandardCharsets.UTF_8);
                            java.util.Map<String, String> headers = new java.util.HashMap<>();
                            headers.put("Content-Length", String.valueOf(bytes.length));
                            headers.put("Accept-Ranges", "bytes");
                            String range = request.getRequestHeaders().get("Range");
                            if (video && range != null && range.startsWith("bytes=")) {
                                String[] limits = range.substring(6).split("-", -1);
                                int start = Integer.parseInt(limits[0]);
                                int end = limits[1].isEmpty() ? bytes.length - 1 : Math.min(bytes.length - 1, Integer.parseInt(limits[1]));
                                headers.put("Content-Range", "bytes " + start + "-" + end + "/" + bytes.length);
                                headers.put("Content-Length", String.valueOf(end - start + 1));
                                return new WebResourceResponse("video/mp4", null, 206, "Partial Content", headers,
                                    new ByteArrayInputStream(bytes, start, end - start + 1));
                            }
                            return new WebResourceResponse(video ? "video/mp4" : "text/html", video ? null : "UTF-8",
                                200, "OK", headers, new ByteArrayInputStream(bytes));
                        }
                    });
                    web.loadUrl("https://example.com/transition-test");
                } catch (Exception error) { throw new AssertionError(error); }
            });
            for (int round = 0; round < 2; round++) {
                waitFor(scenario, activity -> {
                    PipFrames frames = (PipFrames) field(activity, "frames");
                    Bitmap image = frames.frame();
                    PipPlayer pip = (PipPlayer) field(activity, "nativePlayer");
                    ListenableFuture<MediaController> prepared = (ListenableFuture<MediaController>) field(pip, "prepared");
                    if (image == null || prepared == null || !prepared.isDone() || !prepared.get().isConnected()) return false;
                    int pixel = image.getPixel(image.getWidth() / 2, image.getHeight() / 2);
                    return Color.blue(pixel) > 200 && Color.red(pixel) < 40 && Color.green(pixel) < 40;
                }, "Web frame and idle native connection were not prepared");
                AtomicReference<Object> prepared = new AtomicReference<>();
                scenario.onActivity(activity -> {
                    try {
                        PipPlayer pip = (PipPlayer) field(activity, "nativePlayer");
                        prepared.set(field(pip, "prepared"));
                        PipFrames frames = (PipFrames) field(activity, "frames");
                        assertTrue(frames.source().width() < ((WebView) field(activity, "web")).getWidth());
                        Field sessions = MediaSession.class.getDeclaredField("SESSION_ID_TO_SESSION_MAP");
                        sessions.setAccessible(true);
                        MediaSession session = ((java.util.Map<String, MediaSession>) sessions.get(null)).get("");
                        ExoPlayer player = (ExoPlayer) ((SeekablePlayer) session.getPlayer()).getWrappedPlayer();
                        if (!hooked.add(player)) return;
                        player.addListener(new Player.Listener() {
                            @Override public void onMediaItemTransition(MediaItem item, int reason) {
                                if (item == null || item.localConfiguration == null
                                    || !"example.invalid".equals(item.localConfiguration.uri.getHost())) return;
                                AtomicBoolean first = new AtomicBoolean(true);
                                ResolvingDataSource.Factory source = new ResolvingDataSource.Factory(new DefaultDataSource.Factory(context), spec -> {
                                    if (spec.uri.toString().endsWith(".ts") && first.getAndSet(false)) SystemClock.sleep(1200);
                                    return spec;
                                });
                                player.setMediaSource(new HlsMediaSource.Factory(source)
                                    .setExtractorFactory(new DefaultHlsExtractorFactory(DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS, true))
                                    .createMediaSource(MediaItem.fromUri(android.net.Uri.fromFile(new File(folder, "live.m3u8")))
                                        .buildUpon().setMediaMetadata(item.mediaMetadata).setLiveConfiguration(item.liveConfiguration).build()));
                            }
                        });
                    } catch (Exception error) { throw new AssertionError(error); }
                });
                device.pressHome();
                waitFor(scenario, activity -> activity.isInPictureInPictureMode() && (boolean) field(activity, "handed"),
                    "Home did not automatically hand playback over to PiP");
                scenario.onActivity(activity -> {
                    try {
                        PipPlayer pip = (PipPlayer) field(activity, "nativePlayer");
                        assertSame("Prepared connection handoff failed; started=" + pip.started() + ", error=" + field(pip, "problem")
                            + ", handed=" + field(activity, "handed"), prepared.get(), field(pip, "connection"));
                    }
                    catch (Exception error) { throw new AssertionError(error); }
                });
                waitFor(scenario, activity -> {
                    PipPlayer pip = (PipPlayer) field(activity, "nativePlayer");
                    MediaController controller = (MediaController) field(pip, "controller");
                    return controller != null && controller.isPlaying() && controller.getVideoSize().width > 0
                        && ((android.widget.ImageView) field(pip, "preview")).getVisibility() == View.GONE;
                }, "Native PiP video did not replace the cached web frame");
                if (round == 0) {
                    context.startActivity(new Intent(context, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
                    waitFor(scenario, activity -> !activity.isInPictureInPictureMode() && !(boolean) field(activity, "handed"),
                        "Returning from PiP did not restore the web player");
                }
            }
            AtomicReference<android.graphics.Rect> bounds = new AtomicReference<>();
            scenario.onActivity(activity -> bounds.set(activity.getWindowManager().getCurrentWindowMetrics().getBounds()));
            device.click(bounds.get().centerX(), bounds.get().centerY());
            SystemClock.sleep(500);
            device.dumpWindowHierarchy(new File(context.getExternalFilesDir(null), "transitionUi.xml"));
            device.takeScreenshot(new File(context.getExternalFilesDir(null), "transitionPip.png"));
            var close = device.findObject(By.res("com.android.systemui", "dismiss"));
            assertNotNull("System PiP close control was not shown", close);
            close.click();
            long until = SystemClock.elapsedRealtime() + 10000;
            while (!owner.get().isDestroyed() && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100);
            assertTrue("PiP dismissal did not destroy the app", owner.get().isDestroyed());
            for (var task : context.getSystemService(ActivityManager.class).getAppTasks()) {
                assertNotEquals(owner.get().getTaskId(), task.getTaskInfo().taskId);
            }
            until = SystemClock.elapsedRealtime() + 5000;
            while (context.getSystemService(NotificationManager.class).getActiveNotifications().length > 0
                && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100);
            assertEquals(0, context.getSystemService(NotificationManager.class).getActiveNotifications().length);
            System.out.println("Automatic PiP playback, return, repeat and system close verified");
        } finally {
            if (owner.get() != null && !owner.get().isDestroyed()) {
                MediaActions.close(context).send();
                long until = SystemClock.elapsedRealtime() + 10000;
                while (!owner.get().isDestroyed() && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100);
            }
            if (owner.get() == null || !owner.get().isDestroyed()) scenario.close();
            Configurator.getInstance().setWaitForIdleTimeout(idle);
            context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }
}
