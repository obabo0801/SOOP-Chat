package com.soopchat.app;

import android.app.AlertDialog;
import android.app.PictureInPictureParams;
import android.app.PictureInPictureUiState;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.content.ContextCompat;
import java.net.URI;
import java.util.Collections;
import org.json.JSONException;
import org.json.JSONObject;

@androidx.media3.common.util.UnstableApi
public final class MainActivity extends ComponentActivity {
    private FrameLayout root;
    private Bars bars;
    private WebMedia webMedia;
    private boolean closed;
    private final BroadcastReceiver dismiss = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if ((getPackageName() + ".DISMISS_MEDIA").equals(intent.getAction()) && !handed && !isInPictureInPictureMode()) returnHome();
            else closeApp();
        }
    };
    private WebView web;
    private PipPlayer nativePlayer;
    private PlaybackState playback = new PlaybackState();
    private String origin = "";
    private boolean entering;
    private boolean handed;
    private boolean resumed;
    private boolean stopped;
    private boolean homeLoading;
    private PlaybackState leaving;
    private final PipFrames frames = new PipFrames();
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        root = new FrameLayout(this);
        setContentView(root);
        bars = new Bars(getWindow(), root);
        bars.theme(getPreferences(MODE_PRIVATE).getBoolean("dark", false));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            MainActivity.this.bars.inset(bars.top);
            if (!isInPictureInPictureMode()) view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            else view.setPadding(0, 0, 0, 0);
            return insets;
        });
        nativePlayer = new PipPlayer(this);
        webMedia = new WebMedia(this, this::controlWeb, this::seekWeb, () -> MediaActions.openHome(this));
        IntentFilter media = new IntentFilter(getPackageName() + ".CLOSE_PIP");
        media.addAction(getPackageName() + ".DISMISS_MEDIA");
        if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.registerReceiver(this, dismiss, media,
                ContextCompat.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(dismiss, media,
                getPackageName() + ".CLOSE_MEDIA", null);
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { back(); }
        });
        String address = getPreferences(MODE_PRIVATE).getString("address", "");
        if (MediaActions.HOME.equals(getIntent().getAction()) && PlaybackState.secure(address)) {
            address = URI.create(address).resolve("/").toString();
        }
        if (address.isEmpty()) connection();
        else open(address);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (MediaActions.HOME.equals(intent.getAction())) returnHome();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void connection() {
        nativePlayer.close();
        frames.clear();
        webMedia.hide();
        if (web != null) { web.destroy(); web = null; }
        playback = new PlaybackState();
        refreshPip();
        root.removeAllViews();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_VERTICAL);
        panel.setPadding(dp(28), dp(28), dp(28), dp(28));
        TextView title = new TextView(this);
        title.setText("SOOP Chat");
        title.setTextSize(28);
        title.setTextColor(Color.rgb(0, 133, 255));
        panel.addView(title);
        TextView label = new TextView(this);
        label.setText("접속 주소");
        label.setTextSize(14);
        label.setPadding(0, dp(24), 0, dp(8));
        panel.addView(label);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextSize(16);
        input.setHint("https://");
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(getPreferences(MODE_PRIVATE).getString("address", ""));
        panel.addView(input, new LinearLayout.LayoutParams(-1, dp(56)));
        Button connect = new Button(this);
        connect.setText("접속");
        connect.setTextColor(Color.WHITE);
        connect.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(0, 133, 255)));
        LinearLayout.LayoutParams button = new LinearLayout.LayoutParams(-1, dp(52));
        button.topMargin = dp(20);
        panel.addView(connect, button);
        connect.setOnClickListener(view -> {
            String address = input.getText().toString().trim();
            if (!PlaybackState.secure(address)) {
                new AlertDialog.Builder(this).setMessage("HTTPS 접속 주소를 입력해주세요.")
                    .setPositiveButton("확인", null).show();
                return;
            }
            getPreferences(MODE_PRIVATE).edit().putString("address", address).apply();
            open(address);
        });
        root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private void open(String address) {
        if (!PlaybackState.secure(address)) { connection(); return; }
        URI uri = URI.create(address);
        origin = uri.getScheme() + "://" + uri.getRawAuthority();
        if (web != null) { web.destroy(); web = null; }
        root.removeAllViews();
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(247, 248, 250));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "SoopAndroid", Collections.singleton(origin),
                (view, message, sourceOrigin, mainFrame, reply) -> {
                    if (mainFrame && sameOrigin(sourceOrigin.toString())) receive(message.getData());
                });
        } else {
            new AlertDialog.Builder(this).setMessage("Android System WebView를 업데이트해주세요.")
                .setPositiveButton("확인", (dialog, which) -> finish()).show();
            return;
        }
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String target = request.getUrl().toString();
                if (sameOrigin(target)) return false;
                external(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!handed) {
                    playback = new PlaybackState();
                    nativePlayer.close();
                    frames.clear();
                    webMedia.hide();
                    refreshPip();
                }
            }
            @Override public void onPageFinished(WebView view, String url) {
                homeLoading = false;
                CookieManager.getInstance().flush();
                if (sameOrigin(url)) view.evaluateJavascript("window.dispatchEvent(new Event('theme'))", null);
                if (handed && !closed) notifyWeb(true, playback.playing, playback.position);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame() || isFinishing()) return;
                new AlertDialog.Builder(MainActivity.this).setMessage("화면을 불러오지 못했습니다.")
                    .setPositiveButton("다시 시도", (dialog, which) -> view.reload())
                    .setNegativeButton("주소 변경", (dialog, which) -> connection()).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message result) {
                WebView child = new WebView(MainActivity.this);
                child.getSettings().setJavaScriptEnabled(true);
                child.setWebViewClient(new WebViewClient() {
                    @Override public void onPageStarted(WebView popup, String url, android.graphics.Bitmap icon) {
                        if (url == null || "about:blank".equals(url)) return;
                        if (sameOrigin(url)) web.loadUrl(url);
                        else external(Uri.parse(url));
                        popup.stopLoading();
                        popup.post(popup::destroy);
                    }
                });
                ((WebView.WebViewTransport) result.obj).setWebView(child);
                result.sendToTarget();
                return true;
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
            }
            @Override public void onHideCustomView() { hideCustom(); }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.addView(nativePlayer.view, new FrameLayout.LayoutParams(-1, -1));
        web.loadUrl(address);
    }

    private boolean sameOrigin(String address) {
        if (address == null) return false;
        try {
            URI uri = URI.create(address);
            return origin.equals(uri.getScheme() + "://" + uri.getRawAuthority());
        } catch (IllegalArgumentException error) { return false; }
    }

    private void external(Uri address) {
        if (!"https".equals(address.getScheme()) && !"http".equals(address.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, address)); }
        catch (ActivityNotFoundException error) { Toast.makeText(this, "링크를 열 수 없습니다.", Toast.LENGTH_SHORT).show(); }
    }

    private void receive(String message) {
        if (web == null || message == null || message.length() > 12000 || !sameOrigin(web.getUrl())) return;
        try {
            JSONObject data = new JSONObject(message);
            if ("theme".equals(data.optString("type")) && data.opt("dark") instanceof Boolean) {
                boolean dark = data.getBoolean("dark");
                bars.theme(dark);
                getPreferences(MODE_PRIVATE).edit().putBoolean("dark", dark).apply();
                return;
            }
            if ("pip".equals(data.optString("type"))) { enterPip(); return; }
            if (!"playback".equals(data.optString("type")) || handed || homeLoading || closed) return;
            PlaybackState next = new PlaybackState();
            next.url = data.optString("url");
            next.title = data.optString("title", "SOOP Chat");
            next.artist = data.optString("artist");
            next.artwork = data.optString("artwork");
            next.playing = data.optBoolean("playing");
            next.live = data.optBoolean("live");
            next.muted = data.optBoolean("muted");
            next.volume = (float) Math.max(0, Math.min(1, data.optDouble("volume", 1)));
            next.position = Math.max(0, data.optDouble("position", 0));
            next.start = Math.max(0, data.optDouble("start", 0));
            next.end = Math.max(0, data.optDouble("end", 0));
            next.width = data.optInt("width", 0);
            next.height = data.optInt("height", 0);
            playback = next;
            if (resumed && !closed) {
                webMedia.update(next);
                frames.update(getWindow(), web, data.optJSONObject("bounds"), next.playing && customView == null);
                if (canPip()) nativePlayer.warm();
                else nativePlayer.close();
                refreshPip();
            }
        } catch (JSONException error) { /* Ignore incomplete messages from a navigating page. */ }
    }

    @Override protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < 31) enterPip();
    }

    @Override public boolean onPictureInPictureRequested() { return enterPip(); }

    @Override public void onPictureInPictureUiStateChanged(PictureInPictureUiState state) {
        super.onPictureInPictureUiStateChanged(state);
        if (Build.VERSION.SDK_INT < 35) return;
        if (state.isTransitioningToPip()) {
            restoreLeaving();
            if (canPip()) handOff();
        } else if (handed && entering && !isInPictureInPictureMode() && resumed) {
            entering = false;
            restoreWeb();
        }
    }

    private void restoreLeaving() {
        if (!handed && leaving != null && !closed && !homeLoading) playback = leaving;
    }

    private boolean canPip() {
        return !closed && !homeLoading && playback.eligible() && web != null && sameOrigin(web.getUrl())
            && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    private PictureInPictureParams parameters() {
        double ratio = Math.max(1 / 2.39, Math.min(2.39, playback.height > 0 ? (double) playback.width / playback.height : 16d / 9));
        PictureInPictureParams.Builder params = new PictureInPictureParams.Builder()
            .setAspectRatio(new Rational((int) (ratio * 1000), 1000));
        android.graphics.Rect bounds = frames.source();
        if (bounds == null && web != null) {
            bounds = new android.graphics.Rect();
            if (!web.getGlobalVisibleRect(bounds)) bounds = null;
        }
        if (bounds != null && !bounds.isEmpty()) params.setSourceRectHint(bounds);
        if (Build.VERSION.SDK_INT >= 31) params.setAutoEnterEnabled(canPip()).setSeamlessResizeEnabled(true);
        if (Build.VERSION.SDK_INT >= 33) {
            params.setTitle(playback.title);
            params.setCloseAction(new RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel),
                "닫기", "앱 닫기", MediaActions.close(this)));
        }
        return params.build();
    }

    private void refreshPip() {
        if (isFinishing() || isDestroyed() || handed
            || !getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return;
        setPictureInPictureParams(parameters());
    }

    private boolean enterPip() {
        if (entering || isInPictureInPictureMode()) return true;
        if (!canPip()) return false;
        PictureInPictureParams params = parameters();
        try {
            handOff();
            boolean accepted = enterPictureInPictureMode(params);
            if (!accepted) { entering = false; restoreWeb(); }
            return accepted;
        } catch (RuntimeException error) {
            entering = false;
            restoreWeb();
            return false;
        }
    }

    private void handOff() {
        if (handed || closed || web == null) return;
        entering = true;
        handed = true;
        leaving = null;
        webMedia.hide();
        notifyWeb(true, true, playback.position);
        hideCustom();
        web.setVisibility(View.INVISIBLE);
        root.setBackgroundColor(Color.BLACK);
        nativePlayer.view.setVisibility(View.VISIBLE);
        nativePlayer.start(playback, frames.frame(), () -> {
            playback.playing = false;
            Toast.makeText(this, "영상 연결을 확인해주세요.", Toast.LENGTH_SHORT).show();
        });
    }

    @Override public void onPictureInPictureModeChanged(boolean active, Configuration config) {
        super.onPictureInPictureModeChanged(active, config);
        if (active && !handed) {
            restoreLeaving();
            if (canPip()) handOff();
        }
        entering = false;
        root.requestApplyInsets();
        if (!active && handed) {
            if (stopped || isFinishing()) closeApp();
            else if (resumed && !closed) restoreWeb();
        }
    }

    private void restoreWeb() {
        if (!handed) return;
        boolean playing = playback.playing && (!nativePlayer.started() || nativePlayer.playing());
        double position = nativePlayer.started() ? nativePlayer.position() : playback.position;
        if (nativePlayer.started()) playback.live = nativePlayer.live();
        nativePlayer.close();
        handed = false;
        frames.clear();
        root.setBackground(bars);
        web.setVisibility(View.VISIBLE);
        web.onResume();
        notifyWeb(false, playing, position);
        playback.playing = playing;
        playback.position = position;
        webMedia.update(playback);
        refreshPip();
    }

    private void controlWeb(boolean playing) {
        if (closed || handed || web == null) return;
        playback.playing = playing;
        if (!playing) leaving = null;
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('soopnative',{detail:{type:'playback',playing:"
            + playing + "}}))", null);
        webMedia.update(playback);
        refreshPip();
    }

    private void seekWeb(double position) {
        if (closed || handed || web == null || !playback.seekable()) return;
        playback.position = playback.seek(position);
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('soopnative',{detail:{type:'seek',position:"
            + playback.position + "}}))", null);
        webMedia.update(playback);
    }

    private void closeApp() {
        if (closed) return;
        closed = true;
        leaving = null;
        playback.playing = false;
        handed = false;
        entering = false;
        frames.clear();
        refreshPip();
        try {
            nativePlayer.close();
            webMedia.hide();
            if (web != null) {
                root.removeView(web);
                web.stopLoading();
                web.destroy();
                web = null;
            }
        } finally {
            stopService(new Intent(this, PlaybackService.class));
            finishAndRemoveTask();
        }
    }

    private void returnHome() {
        if (closed || web == null || origin.isEmpty()) return;
        homeLoading = true;
        leaving = null;
        playback = new PlaybackState();
        nativePlayer.close();
        webMedia.hide();
        handed = false;
        entering = false;
        frames.clear();
        refreshPip();
        hideCustom();
        stopService(new Intent(this, PlaybackService.class));
        root.setBackground(bars);
        web.setVisibility(View.VISIBLE);
        web.onResume();
        web.loadUrl(origin + "/");
    }

    private void notifyWeb(boolean active, boolean playing, double position) {
        if (web == null) return;
        try {
            JSONObject data = new JSONObject().put("type", "pip").put("active", active)
                .put("live", playback.live)
                .put("playing", playing).put("position", position);
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('soopnative',{detail:"
                + data + "}))", null);
        } catch (JSONException error) { /* Values are generated locally. */ }
    }

    private void hideCustom() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (closed || isFinishing()) return;
        if (web != null) web.onResume();
        if (handed && !isInPictureInPictureMode()) {
            entering = false;
            restoreWeb();
        }
        leaving = null;
        refreshPip();
    }

    @Override protected void onStart() {
        super.onStart();
        stopped = false;
    }

    @Override protected void onPause() {
        if (!handed && canPip()) leaving = playback;
        resumed = false;
        super.onPause();
    }

    @Override protected void onStop() {
        super.onStop();
        stopped = true;
        if (!isInPictureInPictureMode() && !entering) {
            if (handed && !closed) { closeApp(); return; }
            playback.playing = false;
            nativePlayer.close();
            frames.clear();
            webMedia.hide();
            if (web != null) web.onPause();
        }
    }

    private void back() {
        if (customView != null) hideCustom();
        else if (web != null && web.canGoBack()) web.goBack();
        else new AlertDialog.Builder(this).setMessage("앱을 닫을까요?")
            .setPositiveButton("닫기", (dialog, which) -> closeApp())
            .setNeutralButton("주소 변경", (dialog, which) -> connection())
            .setNegativeButton("취소", null).show();
    }

    @Override protected void onDestroy() {
        unregisterReceiver(dismiss);
        nativePlayer.close();
        frames.clear();
        webMedia.release();
        if (isFinishing()) {
            stopService(new Intent(this, PlaybackService.class));
        }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
