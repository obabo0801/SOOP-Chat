package com.soopchat.app;

import java.net.URI;
import java.util.Locale;

final class PlaybackState {
    String url = "";
    String title = "SOOP Chat";
    String artist = "";
    String artwork = "";
    boolean playing;
    boolean live;
    boolean muted;
    float volume = 1f;
    double position;
    double start;
    double end;
    int width = 16;
    int height = 9;

    static boolean secure(String value) {
        if (value == null) return false;
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                && uri.getRawUserInfo() == null;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    boolean eligible() {
        return playing && secure(url) && width > 0 && height > 0;
    }

    boolean seekable() { return Double.isFinite(start) && Double.isFinite(end) && end > start; }

    double seek(double target) {
        return seekable() && Double.isFinite(target) ? Math.max(start, Math.min(end, target)) : position;
    }

    androidx.media3.common.MediaMetadata metadata() {
        android.os.Bundle extras = new android.os.Bundle();
        extras.putString("soop.artist", artist);
        var builder = new androidx.media3.common.MediaMetadata.Builder().setTitle(title)
            .setArtist(description(artist, position)).setExtras(extras);
        if (secure(artwork)) builder.setArtworkUri(android.net.Uri.parse(artwork));
        return builder.build();
    }

    static String description(String artist, double position) {
        long seconds = Double.isFinite(position) ? Math.max(0, (long) position) : 0;
        String time = String.format(Locale.ROOT, "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60);
        return artist.isEmpty() ? time : artist + " " + time;
    }
}
