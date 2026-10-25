/**
 * WishShipped.com — Seamless Shopify Customer 6-Digit OTP Auth Proxy
 * ==================================================================
 * Eliminates the double-email entry step when signing in with Shopify
 * Customer Accounts (https://shopify.com/authentication/102987006274).
 *
 * Flow:
 *  1. Maintains a pre-warmed Chromium context already sitting on Shopify's
 *     OAuth login page (`https://wishshipped.com/customer_authentication/redirect`).
 *  2. POST /api/auth/send-code { email }
 *     - Submits `email` into the pre-warmed Shopify login form.
 *     - Shopify sends the 6-digit verification code from `@t.shopifyemail.com`
 *       and advances the session to `/authentication/102987006274/code`.
 *     - Returns { ok: true, sessionId, email, codeUrl } in ~1s so the user
 *       immediately sees the "Enter 6-digit code" view without re-typing their email.
 *  3. POST /api/auth/verify-code { sessionId, code }
 *     - Submits the 6-digit `code` into the active Shopify `/code` session.
 *     - Returns { ok: false, error } if invalid, or { ok: true, email, orders }
 *       once verified.
 */

const http = require("http");
const crypto = require("crypto");
const { chromium } = require("playwright");

const PORT = process.env.PORT || 4045;
const SHOPIFY_REDIRECT_URL =
  "https://wishshipped.com/customer_authentication/redirect?locale=en&region_country=US";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let browser = null;
let warmSessionPromise = null;
const activeSessions = new Map(); // sessionId -> { context, page, email, createdAt }

async function ensureBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });
  }
  return browser;
}

async function createWarmSession() {
  const b = await ensureBrowser();
  const context = await b.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: "en-US"
  });
  const page = await context.newPage();
  await page.goto(SHOPIFY_REDIRECT_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000
  });
  await page.locator("#customer-authentication-web-email").waitFor({
    state: "visible",
    timeout: 15000
  });
  return { context, page, createdAt: Date.now() };
}

function warmUpNext() {
  warmSessionPromise = createWarmSession().catch((err) => {
    console.error("[AuthProxy] Warm-up error:", err.message);
    return null;
  });
}

async function getReadySession() {
  if (warmSessionPromise) {
    const s = await warmSessionPromise;
    warmSessionPromise = null;
    warmUpNext();
    if (s && Date.now() - s.createdAt < 4 * 60 * 1000) {
      try {
        const visible = await s.page
          .locator("#customer-authentication-web-email")
          .isVisible();
        if (visible) return s;
      } catch (e) {}
      try {
        await s.context.close();
      } catch (e) {}
    }
  }
  warmUpNext();
  return await createWarmSession();
}

// Clean up expired sessions every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of activeSessions.entries()) {
    if (now - sess.createdAt > 10 * 60 * 1000) {
      activeSessions.delete(id);
      sess.context.close().catch(() => {});
    }
  }
}, 60000);

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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 32768) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function handleSendCode(req, res) {
  const body = await readJsonBody(req);
  const email = String(body.email || "").trim();
  if (!email || !email.includes("@")) {
    return sendJson(res, 400, { ok: false, error: "Please enter a valid email address." });
  }

  let session = null;
  try {
    session = await getReadySession();
    const { page, context } = session;

    let loginApiResult = null;
    const onResponse = async (resp) => {
      if (
        resp.url().includes("/authentication/102987006274/login") &&
        resp.request().method() === "POST"
      ) {
        try {
          loginApiResult = await resp.json();
        } catch (e) {}
      }
    };
    page.on("response", onResponse);

    const emailInput = page.locator("#customer-authentication-web-email");
    await emailInput.fill(email);
    await page.locator('button[type="submit"]').first().click();

    // Wait up to 12s for either /code URL or userErrors
    const start = Date.now();
    while (Date.now() - start < 12000) {
      if (loginApiResult) {
        if (loginApiResult.userErrors && loginApiResult.userErrors.length > 0) {
          page.off("response", onResponse);
          await context.close().catch(() => {});
          return sendJson(res, 400, {
            ok: false,
            error: loginApiResult.userErrors[0].message || "Invalid email address."
          });
        }
        if (loginApiResult.nextStep === "code" || page.url().includes("/code")) {
          break;
        }
      }
      if (page.url().includes("/code")) break;
      await page.waitForTimeout(150);
    }
    page.off("response", onResponse);

    await page.waitForURL("**/code**", { timeout: 6000 }).catch(() => {});

    const sessionId = crypto.randomUUID();
    const codeUrl =
      page.url() +
      (page.url().includes("?") ? "&" : "?") +
      "email=" +
      encodeURIComponent(email);

    activeSessions.set(sessionId, {
      context,
      page,
      email,
      createdAt: Date.now()
    });

    return sendJson(res, 200, {
      ok: true,
      sessionId,
      email,
      codeUrl
    });
  } catch (err) {
    if (session && session.context) {
      await session.context.close().catch(() => {});
    }
    console.error("[AuthProxy] send-code error:", err.message);
    return sendJson(res, 500, {
      ok: false,
      error: "Could not send verification code right now. Please try again."
    });
  }
}

async function handleVerifyCode(req, res) {
  const body = await readJsonBody(req);
  const sessionId = String(body.sessionId || "").trim();
  const code = String(body.code || "").replace(/\D/g, "").trim();

  if (!sessionId || !activeSessions.has(sessionId)) {
    return sendJson(res, 400, {
      ok: false,
      error: "Your verification session expired. Please request a new code."
    });
  }
  if (!code || code.length < 6) {
    return sendJson(res, 400, {
      ok: false,
      error: "Please enter the 6-digit code sent to your email."
    });
  }

  const sess = activeSessions.get(sessionId);
  const { page, context, email } = sess;

  try {
    let verifyApiResult = null;
    const onResponse = async (resp) => {
      if (
        resp.url().includes("/authentication/102987006274/login") &&
        resp.request().method() === "POST"
      ) {
        try {
          verifyApiResult = await resp.json();
        } catch (e) {}
      }
    };
    page.on("response", onResponse);

    const codeInput = page.locator('input[inputmode="numeric"], input[type="text"]').first();
    await codeInput.waitFor({ state: "visible", timeout: 8000 });
    await codeInput.fill("");
    await codeInput.fill(code);
    await page.locator('button[type="submit"]').first().click();

    const start = Date.now();
    while (Date.now() - start < 12000) {
      if (verifyApiResult) break;
      await page.waitForTimeout(150);
    }
    page.off("response", onResponse);

    if (verifyApiResult && verifyApiResult.userErrors && verifyApiResult.userErrors.length > 0) {
      return sendJson(res, 400, {
        ok: false,
        error: verifyApiResult.userErrors[0].message || "Invalid verification code."
      });
    }

    if (verifyApiResult && verifyApiResult.nextStep === "redirect") {
      // Wait briefly for account redirect to complete
      await page.waitForTimeout(2000);
      let accountSummary = "No orders yet. Go to the store to place an order.";
      try {
        const bodyText = await page.innerText("body");
        if (bodyText && bodyText.includes("Order")) {
          accountSummary = "Signed in to your WishShipped.com account.";
        }
      } catch (e) {}

      activeSessions.delete(sessionId);
      await context.close().catch(() => {});

      return sendJson(res, 200, {
        ok: true,
        email,
        summary: accountSummary
      });
    }

    return sendJson(res, 400, {
      ok: false,
      error: "Invalid or expired verification code. Please check the code and try again."
    });
  } catch (err) {
    console.error("[AuthProxy] verify-code error:", err.message);
    return sendJson(res, 500, {
      ok: false,
      error: "Verification failed. Please check your 6-digit code and try again."
    });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "GET" && req.url === "/api/auth/health") {
    return sendJson(res, 200, { ok: true, activeSessions: activeSessions.size });
  }
  if (req.method === "POST" && req.url === "/api/auth/send-code") {
    return handleSendCode(req, res);
  }
  if (req.method === "POST" && req.url === "/api/auth/verify-code") {
    return handleVerifyCode(req, res);
  }
  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[WishShipped AuthProxy] Listening on http://127.0.0.1:${PORT}`);
  warmUpNext();
});
