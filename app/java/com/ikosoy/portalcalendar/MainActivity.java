package com.ikosoy.portalcalendar;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Portal Calendar — a pure display app.
 *
 * It hosts a full-screen WebView that loads the bundled web UI from
 * assets/index.html, then periodically reads two files from the app's external
 * files dir and injects them into the page:
 *
 *   events.json  — written/pushed by the exporter (see exporter/calendar_sync.py)
 *   config.json  — display options
 *
 * No authentication or network access happens on the device. Data is pushed via
 *   adb push <file> /sdcard/Android/data/com.ikosoy.portalcalendar/files/
 * which maps to getExternalFilesDir(null) and is writable by adb on a user build.
 */
public class MainActivity extends Activity {

    // How often to re-read the data files and re-render (ms). Cheap local reads.
    private static final long REFRESH_MS = 30_000L;

    private WebView webView;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean pageReady = false;

    private final Runnable refreshTask = new Runnable() {
        @Override
        public void run() {
            pushDataToPage();
            handler.postDelayed(this, REFRESH_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Always-on display: keep the screen awake while the app is foreground.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                pushDataToPage();
            }
        });

        setContentView(webView);
        enterImmersiveMode();

        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(refreshTask);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(refreshTask);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterImmersiveMode();
        }
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    /** Read events.json + config.json from the files dir and inject into the page. */
    private void pushDataToPage() {
        if (!pageReady || webView == null) {
            return;
        }
        String events = readFilesDir("events.json");
        String config = readFilesDir("config.json");
        if (events == null) {
            events = "null";
        }
        if (config == null) {
            config = "null";
        }
        final String js = "window.renderCalendar(" + events + "," + config + ");";
        webView.post(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(js, null);
            }
        });
    }

    /** Returns file contents as a string, or null if missing/unreadable. */
    private String readFilesDir(String name) {
        File dir = getExternalFilesDir(null);
        if (dir == null) {
            return null;
        }
        File f = new File(dir, name);
        if (!f.exists()) {
            return null;
        }
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Exception ignored) {
                }
            }
        }
    }
}
