package com.soopchat.app;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;

final class Bars extends Drawable {
    private final Window window;
    private final View view;
    private final Paint paint = new Paint();
    private int top;
    private int bottom;
    private int inset;

    Bars(Window window, View view) {
        this.window = window;
        this.view = view;
        view.setBackground(this);
    }

    @SuppressWarnings("deprecation")
    void theme(boolean dark) {
        top = dark ? Color.rgb(8, 8, 8) : Color.WHITE;
        bottom = dark ? Color.BLACK : Color.rgb(237, 237, 237);
        window.setStatusBarColor(top);
        window.setNavigationBarColor(bottom);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        var controller = WindowCompat.getInsetsController(window, view);
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
        invalidateSelf();
    }

    void inset(int value) {
        inset = value;
        invalidateSelf();
    }

    @Override public void draw(Canvas canvas) {
        paint.setColor(bottom);
        canvas.drawRect(getBounds(), paint);
        paint.setColor(top);
        canvas.drawRect(getBounds().left, getBounds().top, getBounds().right,
            getBounds().top + inset, paint);
    }

    @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); }
    @Override public int getOpacity() { return PixelFormat.OPAQUE; }
}
