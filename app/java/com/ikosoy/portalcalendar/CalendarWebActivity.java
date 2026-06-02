package com.ikosoy.portalcalendar;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/**
 * Full-screen in-app browser for a single calendar service (Google / Outlook /
 * Yahoo). Launched from MainActivity's JS bridge (window.Android.openCalendar).
 *
 * The user signs in to the provider's own web calendar directly on the Portal;
 * the WebView's cookie store persists the session, so subsequent opens land on
 * the calendar already logged in.
 *
 * Why a separate WebView (not an iframe in the agenda page): calendar.google.com
 * and friends send X-Frame-Options: DENY, so they cannot be framed. They also
 * refuse sign-in inside an "embedded WebView" (UA containing "; wv"), so we set
 * a plain desktop-Chrome User-Agent to be treated as a normal browser.
 */
public class CalendarWebActivity extends Activity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";

    // Desktop Chrome UA — omits the "; wv" token that triggers provider sign-in
    // blocks, and gives the full web calendar on the Portal's landscape screen.
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String url = getIntent().getStringExtra(EXTRA_URL);
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        if (url == null) {
            url = "https://calendar.google.com/calendar/r";
        }
        if (title == null) {
            title = "Calendar";
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        // --- top bar: back button + service title ---
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#0e1014"));
        bar.setPadding(28, 16, 28, 16);

        Button back = new Button(this);
        back.setText("‹  Calendar");          // ‹ Calendar
        back.setAllCaps(false);
        back.setTextColor(Color.WHITE);
        back.setBackgroundColor(Color.parseColor("#20242b"));
        back.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        bar.addView(back);

        TextView tv = new TextView(this);
        tv.setText("   " + title);
        tv.setTextColor(Color.parseColor("#8a8f98"));
        tv.setTextSize(16);
        bar.addView(tv);

        // --- web view ---
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUserAgentString(DESKTOP_UA);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        final ProgressBar spinner = new ProgressBar(this);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                spinner.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
            }
        });
        // Keep navigation inside this WebView (don't kick out to no browser).
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String u) {
                return false;
            }
        });

        // Layout: top bar, then webview filling the rest.
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        col.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        root.addView(col, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        sp.gravity = Gravity.CENTER;
        root.addView(spinner, sp);

        setContentView(root);
        webView.loadUrl(url);
    }

    /** Hardware/gesture back navigates the web history, then exits to the agenda. */
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
