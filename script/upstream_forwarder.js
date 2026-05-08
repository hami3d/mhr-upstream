// Upstream Forwarder with Puppeteer for Cloudflare bypass
//
// Required env:
//   AUTH_KEY  — must match the Worker's UPSTREAM_AUTH_KEY (>= 32 chars)
//
// Optional env:
//   PORT       — listen port (default 8787)
//   HOST       — listen host (default 0.0.0.0 for Railway)

"use strict";

const http = require("http");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const AUTH_KEY = process.env.AUTH_KEY || "";
const PORT = parseInt(process.env.PORT, 10) || 8787;
const HOST = process.env.HOST || "0.0.0.0";

if (!AUTH_KEY || AUTH_KEY.length < 32) {
  console.error("FATAL: AUTH_KEY env var missing or shorter than 32 chars.");
  process.exit(1);
}

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
  "<p>Browser-based forwarder with Cloudflare bypass.</p>" +
  "</body></html>";

let browser = null;
let browserPages = 0;
const MAX_PAGES = 3;

async function getBrowser() {
  if (browser) return browser;
  console.log("Launching browser...");
  browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  console.log("✓ Browser ready");
  return browser;
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(STATUS_PAGE);
    return;
  }

  // Reject WebSocket
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    sendJson(res, 400, { e: "WebSocket not supported" });
    return;
  }

  if (req.method !== "POST" || req.url !== "/fwd") {
    sendJson(res, 404, { e: "not found" });
    return;
  }

  if (req.headers["x-upstream-auth"] !== AUTH_KEY) {
    sendJson(res, 401, { e: "unauthorized" });
    return;
  }

  const startTime = Date.now();
  
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
    
    let result;
    
    // Use browser if under page limit, otherwise fallback to fetch
    if (browserPages < MAX_PAGES) {
      result = await fetchWithBrowser(body.u, method, headers);
    } else {
      result = await fetchWithNative(body.u, method, headers, body.b, body.r);
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`${method} ${targetUrl.hostname}${targetUrl.pathname} → ${result.s} (${elapsed}ms)`);

    sendJson(res, 200, result);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`Error (${elapsed}ms):`, err.message);
    sendJson(res, 500, { e: err.message });
  }
});

async function fetchWithBrowser(url, method, headers) {
  const browser = await getBrowser();
  browserPages++;
  
  const page = await browser.newPage();
  
  try {
    // Set headers and viewport
    await page.setExtraHTTPHeaders(headers);
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Use provided User-Agent or default
    const userAgent = headers["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    await page.setUserAgent(userAgent);
    
    // Navigate and wait for Cloudflare challenge to complete
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    
    if (!response) {
      throw new Error("No response from page");
    }
    
    // Wait for challenge to complete - check if we're on a challenge page
    const currentUrl = page.url();
    if (currentUrl.includes('challenge') || currentUrl.includes('cdn-cgi')) {
      // Wait longer for challenge
      await new Promise(resolve => setTimeout(resolve, 8000));
    } else {
      // Normal page, shorter wait
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Get final page content after any redirects/challenges
    const content = await page.content();
    
    // Get response headers from the navigation response
    const status = response.status();
    const responseHeaders = response.headers();
    
    await page.close();
    browserPages--;
    
    return {
      s: status,
      h: responseHeaders,
      b: Buffer.from(content).toString("base64"),
    };
  } catch (err) {
    await page.close();
    browserPages--;
    throw err;
  }
}

async function fetchWithNative(url, method, headers, bodyBase64, followRedirects) {
  const options = {
    method,
    headers,
    redirect: followRedirects === false ? "manual" : "follow",
  };
  
  if (bodyBase64 && !EMPTY_BODY_METHODS.has(method)) {
    options.body = Buffer.from(bodyBase64, "base64");
    options.duplex = "half";
  }
  
  const response = await fetch(url, options);
  const buffer = await response.arrayBuffer();
  
  const responseHeaders = {};
  response.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });
  
  return {
    s: response.status,
    h: responseHeaders,
    b: Buffer.from(buffer).toString("base64"),
  };
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

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  if (browser) await browser.close();
  process.exit(0);
});

server.listen(PORT, HOST, () => {
  console.log(`Forwarder listening on ${HOST}:${PORT}`);
});
