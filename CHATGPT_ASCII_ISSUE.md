# ChatGPT ASCII Garbage Issue - Diagnosis & Fix

## Problem Description

ChatGPT loads but shows "ASCII words on a blank page" - this is compressed/encoded content that's not being properly decoded.

## Root Cause Analysis

### What's Happening

1. Browser requests `https://chatgpt.com/`
2. Request goes through local proxy → Cloudflare Worker → Railway forwarder
3. Railway fetches the page (gets compressed HTML with gzip/br encoding)
4. Railway base64-encodes the compressed content
5. Worker receives base64-encoded compressed content
6. Worker base64-decodes it → gets compressed binary
7. Worker sends compressed binary to browser
8. Browser expects HTML but receives compressed binary → displays as ASCII garbage

### The Issue

The problem is in the **content-encoding chain**:
- ChatGPT sends: `Content-Encoding: br` (Brotli compressed)
- Railway doesn't decompress it (just base64-encodes the compressed bytes)
- Worker doesn't decompress it (just base64-decodes and forwards)
- Browser receives compressed binary instead of HTML

## Solutions Applied

### Solution 1: Use Browser Rendering for ChatGPT

Added `chatgpt.com` to the `CLOUDFLARE_HOSTS` list so Puppeteer handles it:

```javascript
const CLOUDFLARE_HOSTS = (process.env.CLOUDFLARE_HOSTS || 
  "nexusmods.com,x.com,twitter.com,discord.com,openai.com,chatgpt.com,reddit.com,steamcommunity.com"
).split(",").map(h => h.trim().toLowerCase());
```

**Why this helps**: Puppeteer automatically handles content decompression before returning the response.

### Solution 2: Fix ERR_ABORTED Errors

Fixed the issue where blocked resources (fonts, images) were causing 500 errors:

```javascript
} catch (err) {
  await page.close();
  browserPages--;
  
  // If this is an ERR_ABORTED error from blocked resources, don't propagate it
  if (err && err.message && err.message.includes('ERR_ABORTED')) {
    return {
      s: 204,
      h: {},
      b: "",
    };
  }
  
  throw err;
}
```

## Alternative Solution (If Browser Doesn't Work)

If using the browser still shows ASCII garbage, the issue might be in how undici handles content-encoding. We can force undici to NOT accept compressed responses:

### Option A: Remove Accept-Encoding Header

Modify `fetchWithUndici` to remove the `accept-encoding` header:

```javascript
async function fetchWithUndici(url, method, headers, bodyBase64, followRedirects) {
  // Remove accept-encoding to get uncompressed response
  const cleanHeaders = { ...headers };
  delete cleanHeaders['accept-encoding'];
  delete cleanHeaders['Accept-Encoding'];
  
  const options = {
    method,
    headers: cleanHeaders,
    maxRedirections: followRedirects === false ? 0 : 5,
    headersTimeout: 30000,
    bodyTimeout: 60000,
  };
  
  // ... rest of function
}
```

### Option B: Use Undici's Decompress Option

Enable automatic decompression in undici:

```javascript
const response = await undici.request(url, {
  ...options,
  decompress: true  // Auto-decompress gzip/br/deflate
});
```

## Testing Steps

1. **Wait 2-3 minutes** for Railway to deploy the latest changes
2. **Clear browser cache** (important!)
3. **Test ChatGPT**: Visit `https://chatgpt.com/` through your proxy
4. **Check Railway logs** for:
   ```
   [BROWSER] GET chatgpt.com/ → 200 (XXXms)
   ```
   (Should say `[BROWSER]` not `[UNDICI]`)

## Expected Results

After the fix:
- ✅ ChatGPT should load properly with full HTML rendering
- ✅ No ASCII garbage
- ✅ Railway logs show `[BROWSER] GET chatgpt.com/ → 200`
- ✅ Cloudflare Worker logs show no "forwarder status 500" errors

## If Problem Persists

If ChatGPT still shows ASCII garbage after using browser rendering, the issue might be:

1. **Browser cache**: Clear your browser cache completely
2. **Service Worker**: ChatGPT uses service workers that might cache old responses
3. **Content-Encoding in response headers**: The Worker might be forwarding `content-encoding: br` header along with decompressed content

### Debug Steps

1. Open browser DevTools (F12)
2. Go to Network tab
3. Visit ChatGPT
4. Click on the first request (chatgpt.com)
5. Check Response Headers:
   - If you see `content-encoding: br` or `content-encoding: gzip` → Problem is in Worker
   - If you don't see content-encoding → Problem is elsewhere

### Quick Fix: Strip Content-Encoding Header

If the Worker is forwarding the `content-encoding` header with decompressed content, we need to strip it in the forwarder:

```javascript
// In fetchWithBrowser function, after getting responseHeaders:
const responseHeaders = response.headers();

// Remove content-encoding since we're returning decompressed content
delete responseHeaders['content-encoding'];

return {
  s: status,
  h: responseHeaders,
  b: buffer.toString("base64"),
};
```

## Deployment Status

- ✅ Fix 1: ERR_ABORTED handling - Deployed (commit d908792)
- ✅ Fix 2: Add chatgpt.com to CLOUDFLARE_HOSTS - Deployed (commit 7027a68)
- ⏳ Railway deployment in progress (2-3 minutes)

## Next Steps

1. Wait for Railway deployment to complete
2. Clear browser cache
3. Test ChatGPT
4. If still showing ASCII, check DevTools Network tab for content-encoding header
5. Apply content-encoding stripping fix if needed
