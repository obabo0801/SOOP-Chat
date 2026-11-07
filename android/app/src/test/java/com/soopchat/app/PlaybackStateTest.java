package com.soopchat.app;

import static org.junit.Assert.*;
import org.junit.Test;

public class PlaybackStateTest {
    @Test public void mediaSeeksStayWithinAvailableHistory() {
        PlaybackState state = new PlaybackState();
        state.position = 15;
        assertFalse(state.seekable());
        assertEquals(15, state.seek(0), 0);
        state.start = 10;
        state.end = 100;
        assertTrue(state.seekable());
        assertEquals(10, state.seek(-50), 0);
        assertEquals(100, state.seek(500), 0);
        assertEquals(50, state.seek(50), 0);
        assertEquals(15, state.seek(Double.NaN), 0);
    }
    @Test public void mediaTimeUsesPlaybackPositionAndSupportsLongBroadcasts() {
        assertEquals("스트리머 01:02:03", PlaybackState.description("스트리머", 3723.9));
        assertEquals("25:00:00", PlaybackState.description("", 90000));
        assertEquals("00:00:00", PlaybackState.description("", Double.NaN));
        assertEquals("00:00:00", PlaybackState.description("", -5));
    }
    @Test public void onlyReadyHttpsPlaybackCanEnterPip() {
        PlaybackState state = new PlaybackState();
        state.url = "https://example.com/1/media/live/index.m3u8?media=ticket";
        assertFalse(state.eligible());
        state.playing = true;
        assertTrue(state.eligible());
        state.width = 0;
        assertFalse(state.eligible());
    }

    @Test public void localSourcesAndEmbeddedCredentialsAreRejected() {
        for (String value : new String[] {"", "blob:https://example.com/id", "file:///secret",
            "javascript:alert(1)", "http://example.com", "https://user:password@example.com", "https://"}) {
            assertFalse(value, PlaybackState.secure(value));
        }
        assertTrue(PlaybackState.secure("https://example.com:10443/2/media/live?media=ticket"));
    }
}
