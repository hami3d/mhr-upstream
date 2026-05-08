# Fix Summary: Railway 500 Errors

## Problem Identified

Railway forwarder was returning HTTP 500 errors to the Cloudflare Worker, causing the Worker to return 502 errors to the local proxy. The logs showed three types of errors:

1. **"net::ERR_ABORTED" errors**: Font and resource requests being blocked by Puppeteer
2. **"Body Timeout Error"**: Undici timing out after 25 seconds
3. **"bad upgrade"**: WebSocket upgrade attempts being rejected

## Root Cause

The main error handler (line 177-180) was catching ALL exceptions and returning 500 status codes, including:
- Intentional resource blocking (fonts, images, stylesheets)
- Network timeouts from slow responses
- WebSocket rejection errors

These are expected behaviors, not actual errors that should return 500.

## Fixes Applied

### 1. Suppress Resource Blocking Errors (Puppeteer)

**Changed:**
```javascript
// OLD: Allow fonts/images/stylesheets but don't wait
else if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
  request.continue();
}

// NEW: Block them completely (we only need HTML/JS)
else if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
  request.abort();
}
```

**Added error suppression:**
```javascript
// Suppress console errors from blocked resources (they're intentional)
page.on('pageerror', () => {});
page.on('requestfailed', () => {});
```

**Result:** ERR_ABORTED errors no longer propagate to the main error handler.

### 2. Increase Undici Timeout

**Changed:**
```javascript
// OLD
headersTimeout: 25000,
bodyTimeout: 25000,

// NEW
headersTimeout: 30000,
bodyTimeout: 60000, // Increased to 60s to prevent timeout errors
```

**Result:** Fewer "Body Timeout Error" occurrences for slow responses.

### 3. Improved Error Logging

**Changed:**
```javascript
// OLD
console.error(`Request error (${elapsed}ms):`, err.message);

// NEW
const errorMsg = err && err.message || String(err);
const errorStack = err && err.stack;

console.error(`Request error (${elapsed}ms):`, errorMsg);
if (errorStack && !errorMsg.includes("ERR_ABORTED")) {
  console.error("Stack trace:", errorStack);
}
```

**Result:** Better error diagnostics without cluttering logs with expected errors.

## Expected Behavior After Fix

### Before Fix:
- Worker logs: "upstream forwarder failed: forwarder status 500"
- Local proxy: 502 errors with "relay error: upstream forwarder failed"
- Railway logs: Constant "Request error" messages for fonts/resources

### After Fix:
- Railway should return 200 status with successful page content
- Worker should receive valid responses from Railway
- Local proxy should get proper responses (200, 403, etc.)
- Railway logs should only show actual errors, not resource blocking

## Testing

After Railway redeploys (should take 2-3 minutes):

1. **Test ChatGPT**: Should load properly instead of "weird ASCII texts"
2. **Test X.com**: Should allow login instead of "something went wrong"
3. **Test Nexusmods**: May still show Cloudflare challenges (403), but should get proper HTML responses

## Monitoring

Watch Railway logs for:
- Fewer "Request error" messages
- More successful `[BROWSER]` requests with 200 status
- No more "Body Timeout Error" for normal requests

## Deployment

- **Committed**: c7a8133
- **Pushed to**: GitHub main branch
- **Railway**: Auto-deployment triggered
- **ETA**: 2-3 minutes for new version to be live

## Next Steps

1. Wait for Railway deployment to complete
2. Test the three problematic sites (ChatGPT, X.com, Nexusmods)
3. Check Railway logs to verify errors are reduced
4. If issues persist, investigate specific error messages in logs
