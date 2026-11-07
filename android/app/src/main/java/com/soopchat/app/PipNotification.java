package com.soopchat.app;

import android.app.Notification;
import android.content.Context;
import android.os.Bundle;
import androidx.media3.session.CommandButton;
import androidx.media3.session.DefaultMediaNotificationProvider;
import androidx.media3.session.MediaNotification;
import androidx.media3.session.MediaSession;
import com.google.common.collect.ImmutableList;

@androidx.media3.common.util.UnstableApi
final class PipNotification implements MediaNotification.Provider {
    private final DefaultMediaNotificationProvider provider;
    private final Context context;

    PipNotification(Context context) {
        this.context = context;
        MediaActions.channel(context);
        provider = new DefaultMediaNotificationProvider.Builder(context).setChannelId(MediaActions.CHANNEL).build();
        provider.setSmallIcon(R.drawable.icon);
    }

    private MediaNotification dismissible(MediaNotification notification) {
        notification.notification.flags &= ~Notification.FLAG_ONGOING_EVENT;
        notification.notification.deleteIntent = MediaActions.swipe(context);
        return notification;
    }

    @Override public MediaNotification createNotification(MediaSession session, ImmutableList<CommandButton> buttons,
        MediaNotification.ActionFactory actions, Callback changed) {
        return dismissible(provider.createNotification(session, buttons, actions,
            notification -> changed.onNotificationChanged(dismissible(notification))));
    }

    @Override public boolean handleCustomCommand(MediaSession session, String action, Bundle extras) {
        return provider.handleCustomCommand(session, action, extras);
    }
}
