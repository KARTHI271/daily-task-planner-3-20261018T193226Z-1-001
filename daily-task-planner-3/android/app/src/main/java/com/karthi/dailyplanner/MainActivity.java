package com.karthi.dailyplanner;

import android.app.DownloadManager;
import android.app.Activity;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.util.Locale;


public class MainActivity extends Activity {
    private static final int WRITE_STORAGE_REQUEST = 41;
    private WebView webView;
    private String pendingApkUrl;

    private boolean isPlannerOrigin(Uri uri) {
        Uri planner = Uri.parse(BuildConfig.PLANNER_URL);
        return "https".equalsIgnoreCase(uri.getScheme())
                && planner.getHost() != null
                && planner.getHost().equalsIgnoreCase(uri.getHost())
                && effectivePort(planner) == effectivePort(uri);
    }

    private int effectivePort(Uri uri) {
        return uri.getPort() == -1 ? 443 : uri.getPort();
    }

    private boolean isPlannerApkDownload(Uri uri) {
        String host = uri.getHost();
        String path = uri.getPath();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || path == null
                || !path.endsWith("DailyTaskPlanner.apk")) return false;
        if (host.equalsIgnoreCase("github.com")) {
            return path.startsWith("/KARTHI271/daily-task-planner-3-20261018T193226Z-1-001/releases/download/");
        }
        String normalizedHost = host.toLowerCase(Locale.ROOT);
        return normalizedHost.equals("githubusercontent.com")
                || normalizedHost.endsWith(".githubusercontent.com");
    }

    private boolean handleUrlLoading(WebView view, Uri uri) {
        if (isPlannerOrigin(uri) || isPlannerApkDownload(uri)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            Toast.makeText(this, "Unable to open this link", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrlLoading(view, request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrlLoading(view, Uri.parse(url));
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Uri uri = Uri.parse(url);
            if (!isPlannerApkDownload(uri)) {
                Toast.makeText(this, "Blocked an unexpected download", Toast.LENGTH_LONG).show();
                return;
            }
            startApkDownload(url);
        });

        webView.loadUrl(BuildConfig.PLANNER_URL);
    }

    private void startApkDownload(String url) {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingApkUrl = url;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, WRITE_STORAGE_REQUEST);
            return;
        }
        enqueueApkDownload(url);
    }

    private void enqueueApkDownload(String url) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("DailyTaskPlanner.apk");
            request.setDescription("Downloading Daily Task Planner for Android");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "DailyTaskPlanner.apk");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this, "APK download started", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Download could not be started", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != WRITE_STORAGE_REQUEST) return;
        String url = pendingApkUrl;
        pendingApkUrl = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED && url != null) {
            enqueueApkDownload(url);
        } else {
            Toast.makeText(this, "Storage permission is needed to save the APK", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
