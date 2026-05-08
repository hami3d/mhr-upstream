// Simple Upstream Forwarder - Works for ALL sites
//
// Purpose: Provide a stable exit IP for the Cloudflare Worker relay.
// Uses native Node.js fetch - simple, reliable, no special cases.
//
// Required env:
//   AUTH_KEY  — must match the Worker's UPSTREAM_AUTH_KEY (>= 32 chars)
//
// Optional env:
//   PORT  — listen port (default 8787)
//   HOST  — listen host (default 0.0.0.0 for Railway)

"use strict";

const http = require("http");

const AUTH_KEY = process.env.AUTH_KEY || "";
const PORT = parseInt(process.env.PORT, 10) || parseInt(process.env.RAILWAY_PORT, 10) || 8787;
const HOST = process.env.HOST || "0.0.0.0";

if (!AUTH_KEY || AUTH_KEY.length < 32) {
  console.error("FATAL: AUTH_KEY env var missing or shorter than 32 chars.");
  process.exit(1);
}

// Headers to skip (don't forward these)
const SKIP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "expect",
  "proxy-connection",
  "proxy-authorization",
]);

const EMPTY_BODY_METHODS = new Set(["GET", "HEAD"]);

const STATUS_PAGE =
  "<!DOCTYPE html><html><head><title>Forwarder Active</title></head>" +
  '<body style="font-family:sans-serif;max-width:600px;margin:40px auto">' +
  '<h1>Forwarder <span style="color:#16a34a;font-weight:700">Active</span></h1>' +
  "<p>Simple upstream forwarder using native Node.js fetch.</p>" +
  "</body></html>";

const server = http.createServer(async (req, res) => {
  const startTime = Date.now();
  
  // Health check
  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(STATUS_PAGE);
    return;
  }

  // Reject WebSocket upgrades immediately
  if (req.headers.upgrade) {
    sendJson(res, 400, { e: "WebSocket not supported" });
    return;
  }

  // Validate endpoint
  if (req.method !== "POST" || req.url !== "/fwd") {
    sendJson(res, 404, { e: "not found" });
    return;
  }

  // Validate auth
  if (req.headers["x-upstream-auth"] !== AUTH_KEY) {
    sendJson(res, 401, { e: "unauthorized" });
    return;
  }

  // Handle forwarding
  try {
    const raw = await readBody(req);
    let body;
    
    try {
      body = JSON.parse(raw);
    } catch (_) {
      sendJson(res, 400, { e: "invalid json" });
      return;
    }

    if (!body.u || typeof body.u !== "string" || !/^https?:\/\//i.test(body.u)) {
      sendJson(res, 400, { e: "bad url" });
      return;
    }

    const targetUrl = new URL(body.u);
    
    // Build headers
    const headers = {};
    if (body.h && typeof body.h === "object") {
      for (const [k, v] of Object.entries(body.h)) {
        if (typeof v !== "string") continue;
        if (SKIP_HEADERS.has(k.toLowerCase())) continue;
        headers[k] = v;
      }
    }
    headers["x-fwd-hop"] = "1";

    const method = (body.m || "GET").toUpperCase();
    
    // Fetch options
    const fetchOptions = {
      method,
      headers,
      redirect: body.r === false ? "manual" : "follow",
    };

    // Add body if needed
    if (body.b && !EMPTY_BODY_METHODS.has(method)) {
      fetchOptions.body = Buffer.from(body.b, "base64");
      fetchOptions.duplex = "half";
    }

    // Make the request with retry
    const response = await fetchWithRetry(body.u, fetchOptions, 2);
    
    // Read response
    const buffer = await response.arrayBuffer();
    
    // Get response headers
    const responseHeaders = {};
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`${method} ${targetUrl.hostname}${targetUrl.pathname} → ${response.status} (${elapsed}ms)`);

    // Send response
    sendJson(res, 200, {
      s: response.status,
      h: responseHeaders,
      b: Buffer.from(buffer).toString("base64"),
    });
    
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const errorMsg = err && err.message || String(err);
    
    console.error(`Request error (${elapsed}ms):`, errorMsg);
    sendJson(res, 500, { e: errorMsg });
  }
});

// Fetch with retry
async function fetchWithRetry(url, options, maxRetries) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      console.error(`Fetch attempt ${attempt}/${maxRetries} failed:`, err.message);
      
      if (attempt < maxRetries) {
        await sleep(250);
      }
    }
  }
  
  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

server.listen(PORT, HOST, () => {
  console.log(`Simple forwarder listening on ${HOST}:${PORT}`);
  console.log(`Using native Node.js fetch (simple and reliable)`);
});
