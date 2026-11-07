package com.soopchat.app;

import android.app.PendingIntent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;

@androidx.media3.common.util.UnstableApi
final class MediaActions {
    static final String CLOSE = "soop.close";
    static final String HOME = "soop.home";
    static final String CHANNEL = "web-playback";

    static void channel(Context context) {
        context.getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, "영상 재생", NotificationManager.IMPORTANCE_LOW));
    }

    static PendingIntent open(Context context) {
        return PendingIntent.getActivity(context, 0, new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT), PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent home(Context context) {
        return PendingIntent.getActivity(context, 2, new Intent(context, MainActivity.class).setAction(HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void openHome(Context context) {
        try { home(context).send(); }
        catch (PendingIntent.CanceledException ignored) { /* The request is no longer available. */ }
    }

    static PendingIntent close(Context context) {
        return PendingIntent.getBroadcast(context, 1,
            new Intent(context.getPackageName() + ".CLOSE_PIP").setPackage(context.getPackageName()),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent swipe(Context context) {
        return PendingIntent.getBroadcast(context, 3,
            new Intent(context.getPackageName() + ".DISMISS_MEDIA").setPackage(context.getPackageName()),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void dismiss(Context context) {
        try { close(context).send(); }
        catch (PendingIntent.CanceledException ignored) { /* The owning activity has already closed. */ }
    }
}
