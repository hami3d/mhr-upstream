# Cloudflare Worker Configuration Required

## Problem

ChatGPT is showing "ASCII words on a blank page" because:
1. Requests are going through the Cloudflare Worker (`broken-disk-47b5.hamidrb999.workers.dev`)
2. The Worker is NOT configured to use the Railway forwarder
3. The Worker falls back to direct fetch, which doesn't handle content encoding properly
4. Compressed responses (gzip/br) are not being decompressed

## Solution

Configure your Cloudflare Worker with these environment variables:

### Required Environment Variables

Go to your Cloudflare Worker dashboard:
https://dash.cloudflare.com/ → Workers & Pages → `broken-disk-47b5`

Add these **Secrets** and **Variables**:

#### 1. UPSTREAM_FORWARDER_URL (Secret)
```
https://mhr-upstream-production.up.railway.app/fwd
```

#### 2. UPSTREAM_AUTH_KEY (Secret)
```
<your-AUTH_KEY-from-railway>
```
**Note**: This must be the SAME 32+ character key you set in Railway's `AUTH_KEY` environment variable.

#### 3. UPSTREAM_FAIL_MODE (Variable)
```
open
```
**Explanation**: 
- `open` = Fall back to direct fetch if Railway fails (recommended for testing)
- `closed` = Return 502 error if Railway fails (recommended for production)

#### 4. UPSTREAM_TIMEOUT_MS (Variable - Optional)
```
60000
```
**Explanation**: Timeout for Railway requests in milliseconds (60 seconds)

### How to Add Environment Variables

1. Go to https://dash.cloudflare.com/
2. Click **Workers & Pages** in the left sidebar
3. Click on your worker: **broken-disk-47b5**
4. Click **Settings** tab
5. Scroll to **Environment Variables**
6. Click **Add variable**
7. For secrets (AUTH_KEY, FORWARDER_URL):
   - Click **Encrypt** button
   - Enter the name and value
   - Click **Save**
8. For regular variables (FAIL_MODE, TIMEOUT_MS):
   - Leave **Encrypt** unchecked
   - Enter the name and value
   - Click **Save**
9. Click **Deploy** to apply changes

### Verification

After configuring, test by visiting ChatGPT through your proxy. You should see in Railway logs:

```
[UNDICI] GET chatgpt.com/ → 200 (181ms)
```

Or for Cloudflare-protected sites:

```
[BROWSER] GET www.nexusmods.com/... → 200 (1433ms)
```

### Current Status

✅ Railway forwarder is deployed and working
✅ Cloudflare Worker is deployed (`broken-disk-47b5.hamidrb999.workers.dev`)
❌ Cloudflare Worker is NOT configured to use Railway
❌ Requests are falling back to direct fetch (causing encoding issues)

### What Happens After Configuration

1. **Before**: Worker → Direct Fetch → Compressed response → Encoding error → ASCII garbage
2. **After**: Worker → Railway Forwarder → Proper decompression → Clean HTML → ChatGPT loads

### Testing

After configuration, test these sites:
- **ChatGPT** (chatgpt.com) - Should load properly, no ASCII garbage
- **Nexusmods** (nexusmods.com) - Should bypass Cloudflare challenges
- **X.com** (x.com) - Should allow login

Check Railway logs to confirm requests are being routed through Railway:
```
[UNDICI] GET chatgpt.com/ → 200
[BROWSER] GET www.nexusmods.com/ → 200
```
