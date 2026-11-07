package com.soopchat.app;

import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;

@androidx.media3.common.util.UnstableApi
final class SeekablePlayer extends ForwardingPlayer {
    SeekablePlayer(Player player) { super(player); }

    @Override public Player.Commands getAvailableCommands() {
        return super.getAvailableCommands().buildUpon()
            .remove(Player.COMMAND_SEEK_TO_PREVIOUS).remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            .remove(Player.COMMAND_SEEK_TO_NEXT).remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            .remove(Player.COMMAND_SEEK_BACK).remove(Player.COMMAND_SEEK_FORWARD).build();
    }

    @Override public boolean isCommandAvailable(int command) { return getAvailableCommands().contains(command); }

    @Override public boolean isCurrentMediaItemLive() {
        // Media3 hides live duration from Android controls. Expose the available DVR window there;
        // the underlying ExoPlayer keeps its original live timeline and playback speed control.
        return super.isCurrentMediaItemLive()
            && (!super.isCurrentMediaItemSeekable() || super.getDuration() == C.TIME_UNSET);
    }
}
