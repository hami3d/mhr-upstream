# MHR Upstream Forwarder

Minimal Node.js upstream forwarder for the MHR relay Worker.

## Railway

Set environment variables:

```text
HOST=0.0.0.0
AUTH_KEY=<same 32+ character secret as Cloudflare UPSTREAM_AUTH_KEY>
```

Start command:

```bash
npm start
```

Cloudflare Worker variable:

```text
UPSTREAM_FORWARDER_URL=https://<railway-domain>/fwd
```
