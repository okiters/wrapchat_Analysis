package com.wrapchat.app;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String EVENT_NAME = "wrapchat:native-share";
    private JSONObject pendingSharePayload;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        captureShareIntent(getIntent());
        dispatchPendingShareWithDelay();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureShareIntent(intent);
        dispatchPendingShareWithDelay();
    }

    @Override
    public void onResume() {
        super.onResume();
        dispatchPendingShareWithDelay();
    }

    private void captureShareIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;

        try {
            if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (uris != null && !uris.isEmpty()) {
                    pendingSharePayload = buildPayloadFromUri(uris.get(0), intent.getType());
                    return;
                }
            }

            Uri streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (streamUri != null) {
                pendingSharePayload = buildPayloadFromUri(streamUri, intent.getType());
                return;
            }

            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text != null && text.length() > 0) {
                pendingSharePayload = buildPayloadFromText(text.toString());
            }
        } catch (Exception error) {
            pendingSharePayload = buildErrorPayload(error);
        }
    }

    private JSONObject buildPayloadFromUri(Uri uri, String fallbackMimeType) throws Exception {
        String name = getDisplayName(uri);
        String mimeType = getContentResolver().getType(uri);
        if (mimeType == null || mimeType.trim().isEmpty()) mimeType = fallbackMimeType;
        if (mimeType == null || mimeType.trim().isEmpty()) mimeType = guessMimeType(name);

        byte[] bytes = readAllBytes(uri);
        JSONObject payload = new JSONObject();
        payload.put("kind", "file");
        payload.put("name", name);
        payload.put("mimeType", mimeType);
        payload.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
        payload.put("size", bytes.length);
        return payload;
    }

    private JSONObject buildPayloadFromText(String text) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("kind", "file");
        payload.put("name", "shared-chat.txt");
        payload.put("mimeType", "text/plain");
        payload.put("base64", Base64.encodeToString(text.getBytes("UTF-8"), Base64.NO_WRAP));
        payload.put("size", text.length());
        return payload;
    }

    private JSONObject buildErrorPayload(Exception error) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("kind", "error");
            payload.put("message", error.getMessage() != null ? error.getMessage() : "Could not open shared file");
        } catch (Exception ignored) {
            // Best effort only.
        }
        return payload;
    }

    private byte[] readAllBytes(Uri uri) throws Exception {
        try (InputStream input = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Shared file could not be opened");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private String getDisplayName(Uri uri) {
        String fallback = "shared-chat";
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
            // Fall back to URI path.
        }

        String path = uri.getLastPathSegment();
        if (path != null && !path.trim().isEmpty()) {
            int slash = path.lastIndexOf('/');
            return slash >= 0 ? path.substring(slash + 1) : path;
        }
        return fallback;
    }

    private String guessMimeType(String name) {
        String lower = name == null ? "" : name.toLowerCase();
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        return "text/plain";
    }

    private void dispatchPendingShareWithDelay() {
        mainHandler.postDelayed(this::dispatchPendingShare, 500);
        mainHandler.postDelayed(this::dispatchPendingShare, 1400);
    }

    private void dispatchPendingShare() {
        if (pendingSharePayload == null || bridge == null) return;
        String data = pendingSharePayload.toString();
        bridge.eval("window.__wrapchatNativeSharePayload = " + data + ";", null);
        bridge.eval("if (window.location.pathname !== '/import') { window.history.replaceState({}, '', '/import'); window.dispatchEvent(new PopStateEvent('popstate')); }", null);
        bridge.triggerWindowJSEvent(EVENT_NAME, data);
        pendingSharePayload = null;
    }
}
