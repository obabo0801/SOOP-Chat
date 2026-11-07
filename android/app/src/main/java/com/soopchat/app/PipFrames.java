package com.soopchat.app;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;
import org.json.JSONObject;

final class PipFrames {
    private Rect source;
    private Bitmap frame;
    private boolean copying;
    private long captured;
    private int generation;

    Rect source() { return source == null ? null : new Rect(source); }
    Bitmap frame() { return frame; }

    void update(Window window, View web, JSONObject bounds, boolean playing) {
        if (bounds == null || web.getWidth() <= 0 || bounds.optDouble("viewport") <= 0) return;
        double scale = web.getWidth() / bounds.optDouble("viewport");
        int[] location = new int[2];
        web.getLocationInWindow(location);
        int left = location[0] + (int) Math.round(bounds.optDouble("x") * scale);
        int top = location[1] + (int) Math.round(bounds.optDouble("y") * scale);
        Rect rect = new Rect(left, top, left + (int) Math.round(bounds.optDouble("width") * scale),
            top + (int) Math.round(bounds.optDouble("height") * scale));
        if (!rect.intersect(location[0], location[1], location[0] + web.getWidth(), location[1] + web.getHeight())
            || rect.isEmpty()) return;
        source = rect;
        if (!playing || copying || !web.isAttachedToWindow() || web.getVisibility() != View.VISIBLE
            || SystemClock.elapsedRealtime() - captured < 900) return;
        int width = Math.min(320, rect.width());
        Bitmap image = Bitmap.createBitmap(width, Math.max(1, width * rect.height() / rect.width()), Bitmap.Config.ARGB_8888);
        captured = SystemClock.elapsedRealtime();
        copying = true;
        int request = generation;
        try {
            PixelCopy.request(window, rect, image, result -> {
                copying = false;
                if (request == generation && result == PixelCopy.SUCCESS && web.getVisibility() == View.VISIBLE) frame = image;
            }, new Handler(Looper.getMainLooper()));
        } catch (IllegalArgumentException error) { copying = false; }
    }

    void clear() {
        generation++;
        source = null;
        frame = null;
        captured = 0;
    }
}
