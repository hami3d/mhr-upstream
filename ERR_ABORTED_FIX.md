# ERR_ABORTED Fix - Railway 500 Errors

## Problem Identified

The Railway forwarder was returning **500 errors** for intentionally blocked resources (fonts, images, stylesheets), causing the Cloudflare Worker to fall back to direct connections.

### Evidence from Logs

**Railway logs showed**:
```
Request error (50ms): net::ERR_ABORTED at https://www.nexusmods.com/assets/fonts/material/Baseline/Material-Icons-Baseline.woff2
Request error (144ms): net::ERR_ABORTED at https://www.nexusmods.com/assets/fonts/material/Baseline/Material-Icons-Baseline.woff
Request error (161ms): net::ERR_ABORTED at https://www.nexusmods.com/assets/fonts/material/Baseline/Material-Icons-Baseline.ttf
```

**Cloudflare Worker logs showed**:
```
upstream forwarder failed (falling back to direct): forwarder status 500
```

## Root Cause

When Puppeteer's `request.abort()` is called to block resources:
1. Puppeteer throws a `net::ERR_ABORTED` error
2. This error was caught by the main try-catch block in `fetchWithBrowser()`
3. The error was propagated up, causing a 500 response
4. The Cloudflare Worker saw the 500 and fell back to direct connection
5. This defeated the purpose of using the Railway forwarder

## Solution Applied

Added specific error handling for `ERR_ABORTED` errors in the `fetchWithBrowser()` function:

```javascript
} catch (err) {
  await page.close();
  browserPages--;
  
  // If this is an ERR_ABORTED error from blocked resources, don't propagate it
  // These are intentional blocks and should not cause 500 errors
  if (err && err.message && err.message.includes('ERR_ABORTED')) {
    // Return a synthetic 204 No Content response for blocked resources
    return {
      s: 204,
      h: {},
      b: "",
    };
  }
  
  throw err;
}
```

### Additional Improvements

Also improved the request interception logic to only block resources that are NOT the main page request:

```javascript
page.on('request', (request) => {
  const resourceType = request.resourceType();
  const requestUrl = request.url();
  
  // Only block resources that are NOT the main page request
  if (requestUrl !== url) {
    if (resourceType === 'websocket') {
      request.abort();
    } else if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
      request.abort();
    } else {
      request.continue();
    }
  } else {
    request.continue();
  }
});
```

## Expected Results

After this fix:
- ✅ Blocked resources (fonts, images, stylesheets) return 204 instead of 500
- ✅ Cloudflare Worker no longer falls back to direct connection
- ✅ Railway forwarder successfully handles all Cloudflare-protected sites
- ✅ Nexusmods, ChatGPT, X.com should load properly through the proxy

## Testing

Wait 2-3 minutes for Railway to deploy, then test:
1. **Nexusmods** - Should load without 502 errors
2. **ChatGPT** - Should load properly instead of "weird ASCII texts"
3. **X.com** - Should allow login instead of "something went wrong"

Check Railway logs for:
- `[BROWSER] GET www.nexusmods.com/... → 200` (success)
- No more "Request error: net::ERR_ABORTED" messages causing 500s
- Cloudflare Worker logs should show no "forwarder status 500" warnings

## Deployment

- **Commit**: d908792
- **Message**: "Fix ERR_ABORTED errors from blocked resources causing 500 responses"
- **Status**: Pushed to GitHub, Railway auto-deploying
- **ETA**: 2-3 minutes
