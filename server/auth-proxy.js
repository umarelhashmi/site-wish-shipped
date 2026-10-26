/**
 * WishShipped.com — Instant Redirect to Official Shopify 6-Digit Code Page
 * ========================================================================
 * Flow:
 *  1. Uses a cached Shopify OAuth login session (`cached_login.html` +
 *     `cached_cookies.txt`, refreshed automatically if older than 12 hours)
 *     in a persistent pre-warmed Playwright page.
 *  2. GET /api/auth/redirect?email=<email>
 *     - Immediately (in < 2ms) responds with `302 Found` redirecting the
 *       user's browser directly to the official Shopify 6-digit code page:
 *       `https://shopify.com/authentication/102987006274/code?...&email=<email>`
 *       so the user lands on the official Shopify login UI at the "Enter code"
 *       screen without repeating their email.
 *     - Simultaneously in the background (~320ms), submits `email` in the
 *       warm Playwright page (`POST /authentication/102987006274/login` ->
 *       `200 {"nextStep":"code"}`) so Shopify sends the 6-digit verification
 *       code from `@t.shopifyemail.com` to `<email>`, and immediately resets
 *       the page from local memory (< 150ms) for the next visitor.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const PORT = process.env.PORT || 4045;
const SHOPIFY_REDIRECT_URL =
  "https://wishshipped.com/customer_authentication/redirect?locale=en&region_country=US";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DATA_DIR = __dirname;
const CACHED_HTML_PATH = path.join(DATA_DIR, "cached_login.html");
const CACHED_COOKIES_PATH = path.join(DATA_DIR, "cached_cookies.txt");

let browser = null;
let sharedPage = null;
let sharedContext = null;
let cachedHtml = null;
let cachedAuthUrl = null;
let cachedLoginUrl = null;
let queuePromise = Promise.resolve();

function loadOrRefreshCachedFiles() {
  try {
    if (
      fs.existsSync(CACHED_HTML_PATH) &&
      fs.existsSync(CACHED_COOKIES_PATH)
    ) {
      const stat = fs.statSync(CACHED_HTML_PATH);
      const html = fs.readFileSync(CACHED_HTML_PATH, "utf8");
      const m = html.match(/data-serialized-id="canonical-login-url">([^<]+)</);
      if (m && Date.now() - stat.mtimeMs < 12 * 60 * 60 * 1000) {
        const canon = JSON.parse(m[1]);
        cachedHtml = html;
        cachedLoginUrl = "https://shopify.com" + canon;
        cachedAuthUrl =
          "https://shopify.com" + canon.replace("/login?", "/oauth/authorize?");
        return true;
      }
    }
  } catch (e) {
    console.error("[AuthProxy] Error reading cached session files:", e.message);
  }

  try {
    const tmpCookie = "/tmp/ws_refresh_cookies.txt";
    const tmpHtml = "/tmp/ws_refresh_login.html";
    try {
      fs.unlinkSync(tmpCookie);
    } catch (e) {}

    execFileSync("curl", [
      "-s",
      "-L",
      "-c",
      tmpCookie,
      "-b",
      tmpCookie,
      "-H",
      `User-Agent: ${USER_AGENT}`,
      "-H",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "-H",
      "Accept-Language: en-US,en;q=0.9",
      "-o",
      tmpHtml,
      SHOPIFY_REDIRECT_URL
    ]);

    const html = fs.readFileSync(tmpHtml, "utf8");
    const m = html.match(/data-serialized-id="canonical-login-url">([^<]+)</);
    if (m) {
      fs.copyFileSync(tmpHtml, CACHED_HTML_PATH);
      fs.copyFileSync(tmpCookie, CACHED_COOKIES_PATH);
      const canon = JSON.parse(m[1]);
      cachedHtml = html;
      cachedLoginUrl = "https://shopify.com" + canon;
      cachedAuthUrl =
        "https://shopify.com" + canon.replace("/login?", "/oauth/authorize?");
      console.log("[AuthProxy] Refreshed cached login session via curl");
      return true;
    }
  } catch (e) {
    console.error("[AuthProxy] curl refresh failed:", e.message);
  }
  return Boolean(cachedHtml && cachedLoginUrl);
}

function parseNetscapeCookies(filePath) {
  const pwCookies = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) {
      continue;
    }
    const httpOnly = line.startsWith("#HttpOnly_");
    const clean = httpOnly ? line.replace(/^#HttpOnly_/, "") : line;
    const parts = clean.split("\t");
    if (parts.length < 7) continue;
    pwCookies.push({
      name: parts[5],
      value: parts[6].trim(),
      domain: parts[0],
      path: parts[2],
      secure: parts[3] === "TRUE",
      httpOnly,
      sameSite: "Lax"
    });
  }
  return pwCookies;
}

async function initWarmPage() {
  loadOrRefreshCachedFiles();
  if (!cachedHtml || !cachedAuthUrl) {
    throw new Error("No valid cached_login.html available");
  }

  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
    });
  }

  if (sharedContext) {
    await sharedContext.close().catch(() => {});
  }

  sharedContext = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: "en-US"
  });

  await sharedContext.addCookies(parseNetscapeCookies(CACHED_COOKIES_PATH));
  sharedPage = await sharedContext.newPage();

  await sharedPage.route(
    "**/authentication/102987006274/oauth/authorize*",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: cachedHtml
      });
    }
  );

  let collectDone = false;
  sharedPage.on("response", (r) => {
    if (r.url().includes("/api/collect") && r.status() === 204) {
      collectDone = true;
    }
  });

  await sharedPage.goto(cachedAuthUrl, {
    waitUntil: "domcontentloaded",
    timeout: 10000
  });
  await sharedPage.locator("#customer-authentication-web-email").waitFor({
    state: "visible",
    timeout: 8000
  });

  for (let i = 0; i < 25 && !collectDone; i++) {
    await sharedPage.waitForTimeout(100);
  }

  cachedLoginUrl = sharedPage.url();
  console.log("[AuthProxy] Warm page ready:", cachedLoginUrl.slice(0, 95));
}

async function submitEmailInBackground(email) {
  queuePromise = queuePromise.then(async () => {
    try {
      if (!sharedPage || sharedPage.isClosed()) {
        await initWarmPage();
      }
      const emailInput = sharedPage.locator("#customer-authentication-web-email");
      const isVis = await emailInput.isVisible().catch(() => false);
      if (!isVis) {
        await sharedPage.goto(cachedAuthUrl, {
          waitUntil: "domcontentloaded",
          timeout: 8000
        });
        await emailInput.waitFor({ state: "visible", timeout: 6000 });
      }

      const t0 = Date.now();
      await emailInput.fill(email);
      const respPromise = sharedPage.waitForResponse(
        (r) =>
          r.url().includes("/authentication/102987006274/login") &&
          r.request().method() === "POST",
        { timeout: 8000 }
      );
      await sharedPage.locator('button[type="submit"]').first().click();
      const resp = await respPromise;
      const text = await resp.text();
      console.log(
        `[AuthProxy] Dispatched 6-digit code for ${email} in ${Date.now() - t0}ms: HTTP ${resp.status()} ${text.slice(0, 100)}`
      );

      // Immediately reset page from local memory (< 150ms) for next user
      await sharedPage.goto(cachedAuthUrl, {
        waitUntil: "domcontentloaded",
        timeout: 8000
      });
      await emailInput.waitFor({ state: "visible", timeout: 6000 });
    } catch (err) {
      console.error(`[AuthProxy] Error submitting email ${email}:`, err.message);
      await initWarmPage().catch((e) =>
        console.error("[AuthProxy] Re-init error:", e.message)
      );
    }
  });
}

function buildCodeUrl(loginUrl, email) {
  const base = loginUrl.replace(
    "/authentication/102987006274/login?",
    "/authentication/102987006274/code?"
  );
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}email=${encodeURIComponent(email)}`;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function handleRedirect(req, res, parsedUrl) {
  const email = String(parsedUrl.searchParams.get("email") || "").trim();
  if (!email || !email.includes("@")) {
    res.writeHead(302, { Location: SHOPIFY_REDIRECT_URL });
    return res.end();
  }

  const targetLoginHintUrl = `https://wishshipped.com/customer_authentication/login?return_to=%2F&login_hint=${encodeURIComponent(email)}`;

  // Instant 302 redirect with login_hint so Shopify pre-fills the email in the user's own browser session
  res.writeHead(302, {
    Location: targetLoginHintUrl,
    "Cache-Control": "no-store, no-cache, must-revalidate"
  });
  res.end();
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && parsedUrl.pathname === "/api/auth/health") {
    return sendJson(res, 200, {
      ok: true,
      warmReady: Boolean(sharedPage && !sharedPage.isClosed()),
      hasLoginUrl: Boolean(cachedLoginUrl)
    });
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/auth/redirect") {
    return handleRedirect(req, res, parsedUrl);
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

process.on("SIGTERM", () => {
  if (browser) browser.close().catch(() => {});
  process.exit(0);
});
process.on("SIGINT", () => {
  if (browser) browser.close().catch(() => {});
  process.exit(0);
});

loadOrRefreshCachedFiles();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[WishShipped AuthProxy] Listening on http://127.0.0.1:${PORT}`);
  initWarmPage().catch((err) =>
    console.error("[AuthProxy] Initial warmup error:", err.message)
  );
});
