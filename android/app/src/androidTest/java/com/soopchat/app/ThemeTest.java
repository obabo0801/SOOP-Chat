package com.soopchat.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ThemeTest {
    @Test public void webThemeChangesBothSystemBars() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                try {
                    Method open = MainActivity.class.getDeclaredMethod("open", String.class);
                    open.setAccessible(true);
                    open.invoke(activity, "https://example.com/");
                } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
            });
            AtomicBoolean dark = new AtomicBoolean(false);
            long until = SystemClock.elapsedRealtime() + 45000;
            while (!dark.get() && SystemClock.elapsedRealtime() < until) {
                scenario.onActivity(activity -> {
                    dark.set(activity.getPreferences(0).getBoolean("dark", false));
                    try {
                        Field field = MainActivity.class.getDeclaredField("web");
                        field.setAccessible(true);
                        ((WebView) field.get(activity)).evaluateJavascript(
                            "if(window.SoopAndroid)SoopAndroid.postMessage(JSON.stringify({type:'theme',dark:true}))", null);
                    } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
                });
                SystemClock.sleep(200);
            }
            assertTrue("Web theme did not reach Android", dark.get());
            SystemClock.sleep(500);
            Bitmap screen = instrumentation.getUiAutomation().takeScreenshot();
            assertEquals(0xff080808, screen.getPixel(10, 10));
            assertEquals(0xff000000, screen.getPixel(10, screen.getHeight() - 10));
            scenario.onActivity(activity -> {
                var bars = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
                assertFalse(bars.isAppearanceLightStatusBars());
                assertFalse(bars.isAppearanceLightNavigationBars());
            });
        } finally {
            context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }
}
