package com.soopchat.app;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;
import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.os.Build;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowActivity;
import org.robolectric.shadows.ShadowAlertDialog;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {26, 35}, shadows = MainActivityTest.PipActivity.class)
public class MainActivityTest {
    @Implements(Activity.class)
    public static class PipActivity extends ShadowActivity {
        int entries;
        PictureInPictureParams params;
        @Implementation(minSdk = 26)
        protected void setPictureInPictureParams(PictureInPictureParams value) { params = value; }
        @Implementation(minSdk = 26)
        protected boolean enterPictureInPictureMode(PictureInPictureParams params) {
            entries++;
            return true;
        }
    }

    private <T extends View> T find(View view, Class<T> type) {
        if (type.isInstance(view)) return type.cast(view);
        if (view instanceof ViewGroup group) {
            for (int index = 0; index < group.getChildCount(); index++) {
                T result = find(group.getChildAt(index), type);
                if (result != null) return result;
            }
        }
        return null;
    }

    @Test public void firstLaunchShowsAddressAndIdleHomeDoesNotEnterPip() {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            View root = activity.findViewById(android.R.id.content);
            assertNotNull(find(root, EditText.class));
            assertEquals("접속", find(root, Button.class).getText().toString());
            activity.onUserLeaveHint();
            assertEquals(0, ((PipActivity) shadowOf(activity)).entries);
        }
    }

    @Test public void invalidAddressDoesNotSaveOrOpenWebView() {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            View root = activity.findViewById(android.R.id.content);
            find(root, EditText.class).setText("http://example.com");
            find(root, Button.class).performClick();
            assertNotNull(ShadowAlertDialog.getLatestAlertDialog());
            assertEquals("", activity.getPreferences(0).getString("address", ""));
        }
    }

    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void pageThemeUpdatesSystemBarsAndSurvivesPipReturn() {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            WebView web = new WebView(activity);
            web.loadUrl("https://example.com/1/");
            ReflectionHelpers.setField(activity, "web", web);
            ReflectionHelpers.setField(activity, "origin", "https://example.com");
            ReflectionHelpers.callInstanceMethod(activity, "receive",
                ReflectionHelpers.ClassParameter.from(String.class, "{\"type\":\"theme\",\"dark\":true}"));
            assertTrue(activity.getPreferences(0).getBoolean("dark", false));
            Bars bars = ReflectionHelpers.getField(activity, "bars");
            bars.inset(30);
            bars.setBounds(0, 0, 100, 100);
            Bitmap bitmap = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888);
            bars.draw(new Canvas(bitmap));
            assertEquals(Color.rgb(8, 8, 8), bitmap.getPixel(50, 10));
            assertEquals(Color.BLACK, bitmap.getPixel(50, 90));
            ReflectionHelpers.setField(activity, "handed", true);
            ReflectionHelpers.callInstanceMethod(activity, "restoreWeb");
            View root = ReflectionHelpers.getField(activity, "root");
            assertSame(bars, root.getBackground());
            ReflectionHelpers.callInstanceMethod(activity, "receive",
                ReflectionHelpers.ClassParameter.from(String.class, "{\"type\":\"theme\",\"dark\":false}"));
            bars.draw(new Canvas(bitmap));
            assertEquals(Color.WHITE, bitmap.getPixel(50, 10));
            assertEquals(Color.rgb(237, 237, 237), bitmap.getPixel(50, 90));
        }
    }

    @Test public void homeFromInlinePlaybackRequestsNativePipOnce() {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            shadowOf(activity.getPackageManager()).setSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE, true);
            WebView web = new WebView(activity);
            web.loadUrl("https://example.com/1/");
            ReflectionHelpers.setField(activity, "web", web);
            ReflectionHelpers.setField(activity, "origin", "https://example.com");
            PlaybackState state = new PlaybackState();
            state.url = "https://example.com/1/media/live/index.m3u8?media=ticket";
            state.playing = true;
            ReflectionHelpers.setField(activity, "playback", state);
            if (Build.VERSION.SDK_INT >= 31) {
                ReflectionHelpers.callInstanceMethod(activity, "refreshPip");
                assertTrue(((PipActivity) shadowOf(activity)).params.isAutoEnterEnabled());
                activity.onUserLeaveHint();
                assertEquals(0, ((PipActivity) shadowOf(activity)).entries);
                activity.onPictureInPictureModeChanged(true, activity.getResources().getConfiguration());
            }
            activity.onUserLeaveHint();
            activity.onUserLeaveHint();
            assertEquals(Build.VERSION.SDK_INT >= 31 ? 0 : 1, ((PipActivity) shadowOf(activity)).entries);
            assertEquals(View.INVISIBLE, web.getVisibility());
            PipPlayer player = ReflectionHelpers.getField(activity, "nativePlayer");
            assertTrue("Native startup must not wait for an invisible WebView callback", player.started());
            assertTrue(shadowOf(web).getLastEvaluatedJavascript().contains("\"active\":true"));
        }
    }

    @Test public void mediaHomeKeepsAppOpenAndClearsPlayback() {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            WebView web = new WebView(activity);
            web.loadUrl("https://example.com/2/");
            ReflectionHelpers.setField(activity, "web", web);
            ReflectionHelpers.setField(activity, "origin", "https://example.com");
            activity.onNewIntent(new Intent(activity, MainActivity.class).setAction(MediaActions.HOME));
            assertEquals("https://example.com/", web.getUrl());
            assertFalse(activity.isFinishing());
            PlaybackState state = ReflectionHelpers.getField(activity, "playback");
            assertFalse(state.playing);
        }
    }

    @Test public void defaultPipDismissFinishesTaskWithoutRestoringWeb() {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            ReflectionHelpers.setField(activity, "handed", true);
            ReflectionHelpers.setField(activity, "stopped", true);
            ReflectionHelpers.setField(activity, "resumed", false);
            activity.onPictureInPictureModeChanged(false, activity.getResources().getConfiguration());
            assertTrue(activity.isFinishing());
            assertTrue((boolean) ReflectionHelpers.getField(activity, "closed"));
            assertFalse((boolean) ReflectionHelpers.getField(activity, "handed"));
        }
    }

    @Test public void playerConnectionCannotWaitForever() {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            PipPlayer player = new PipPlayer(activity);
            PlaybackState state = new PlaybackState();
            state.url = "https://example.com/live.m3u8";
            state.playing = true;
            int[] failures = {0};
            player.start(state, () -> failures[0]++);
            assertTrue(player.started());
            Runnable deadline = ReflectionHelpers.getField(player, "deadline");
            deadline.run();
            assertEquals(1, failures[0]);
            assertFalse(player.started());
            assertEquals(View.VISIBLE, player.view.getVisibility());
            deadline.run();
            assertEquals(1, failures[0]);
            player.close();
        }
    }
}
