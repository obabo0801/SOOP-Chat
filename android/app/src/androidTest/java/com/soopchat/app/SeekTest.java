package com.soopchat.app;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.SystemClock;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SeekTest {
    @Test public void systemTimelineSeeksRealWebVideoAndPreservesPause() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        File fixture = new File(context.getExternalFilesDir(null), "nativeSeek.json");
        assumeTrue("Synthetic clip and production JavaScript fixture required", fixture.isFile());
        JSONObject data = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
        byte[] clip = Base64.getDecoder().decode(data.getString("clip"));
        String page = "<html><video id='video' autoplay muted playsinline src='/clip.mp4'></video><script type='module'>"
            + data.getString("native") + "\nconst video=document.getElementById('video');let live=true,moving=false;"
            + "const $=id=>document.getElementById(id);const position=()=>video.seekable.end(video.seekable.length-1)-4;"
            + "const overlay=()=>{};" + data.getString("seek")
            + "\ncreateNative(video,()=>({url:'https://example.com/live.m3u8',title:'탐색 검증',enabled:true,paused:video.paused,live}),"
            + "data=>{if(data.type==='seek')seekVideo(data.position);else if(data.playing)video.play()});video.play();</script></html>";
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        AtomicReference<WebView> web = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                try {
                    Method open = MainActivity.class.getDeclaredMethod("open", String.class);
                    open.setAccessible(true);
                    open.invoke(activity, "https://example.com/");
                    Field field = MainActivity.class.getDeclaredField("web");
                    field.setAccessible(true);
                    web.set((WebView) field.get(activity));
                    web.get().setWebViewClient(new WebViewClient() {
                        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                            boolean video = request.getUrl().getPath().equals("/clip.mp4");
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
                    web.get().loadUrl("https://example.com/media-test");
                } catch (Exception error) { throw new AssertionError(error); }
            });
            NotificationManager notifications = context.getSystemService(NotificationManager.class);
            MediaController controller = null;
            long until = SystemClock.elapsedRealtime() + 30000;
            while (controller == null && SystemClock.elapsedRealtime() < until) {
                for (var item : notifications.getActiveNotifications()) {
                    if (item.getId() != 1002) continue;
                    MediaSession.Token token = item.getNotification().extras.getParcelable(Notification.EXTRA_MEDIA_SESSION);
                    MediaController candidate = new MediaController(context, token);
                    if ((candidate.getPlaybackState().getActions() & PlaybackState.ACTION_SEEK_TO) != 0) controller = candidate;
                }
                SystemClock.sleep(200);
            }
            AtomicReference<String> diagnostic = new AtomicReference<>("");
            if (controller == null) {
                instrumentation.runOnMainSync(() -> web.get().evaluateJavascript(
                    "JSON.stringify({bridge:typeof window.SoopAndroid,ready:document.getElementById('video').readyState,"
                        + "paused:document.getElementById('video').paused,ranges:document.getElementById('video').seekable.length,"
                        + "error:document.getElementById('video').error?.code})", diagnostic::set));
                SystemClock.sleep(300);
            }
            assertNotNull("Seekable media timeline was not published: " + diagnostic.get(), controller);
            assertEquals(30000, controller.getMetadata().getLong(MediaMetadata.METADATA_KEY_DURATION), 100);
            controller.getTransportControls().seekTo(10000);
            AtomicReference<Double> actual = new AtomicReference<>(0d);
            until = SystemClock.elapsedRealtime() + 5000;
            while (actual.get() < 9.9 && SystemClock.elapsedRealtime() < until) {
                instrumentation.runOnMainSync(() -> web.get().evaluateJavascript("document.getElementById('video').currentTime",
                    value -> actual.set(Double.parseDouble(value))));
                SystemClock.sleep(100);
            }
            assertTrue("System seek did not reach the real video", actual.get() >= 9.9 && actual.get() < 15);
            controller.getTransportControls().pause();
            until = SystemClock.elapsedRealtime() + 5000;
            while (controller.getPlaybackState().getState() != PlaybackState.STATE_PAUSED && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100);
            controller.getTransportControls().seekTo(5000);
            until = SystemClock.elapsedRealtime() + 5000;
            while (Math.abs(actual.get() - 5) > .1 && SystemClock.elapsedRealtime() < until) {
                instrumentation.runOnMainSync(() -> web.get().evaluateJavascript("document.getElementById('video').currentTime",
                    value -> actual.set(Double.parseDouble(value))));
                SystemClock.sleep(100);
            }
            assertEquals(5, actual.get(), .1);
            assertEquals(PlaybackState.STATE_PAUSED, controller.getPlaybackState().getState());
        } finally {
            context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }
}
