/**
 * WishShipped.com — Shopify Live Storefront Configuration
 * ========================================================
 * Edit ONLY this file (or inject window.__WISHSHIPPED_ENV__ before this script loads)
 * to link or update the Shopify store connection.
 *
 * How Live Sync Works:
 * 1. On page load (and every `pollIntervalMs`), the storefront queries the
 *    Shopify Storefront GraphQL API (`https://{domain}/api/{apiVersion}/graphql.json`)
 *    using `storefrontAccessToken`.
 * 2. Live Inventory (`availableForSale` per product and per size/variant) updates
 *    automatically — out-of-stock sizes are disabled and sold-out products update in real time.
 * 3. Newly added products in Shopify Admin are automatically pulled into the catalog,
 *    mapped into their exact Shopify collections/categories, and rendered with their
 *    live images, variants, and prices.
 * 4. Any empty category (`count === 0`) stays hidden until a product is added to it in Shopify.
 */
(function () {
  var env = (typeof window !== "undefined" && window.__WISHSHIPPED_ENV__) || {};

  window.SHOPIFY_CONFIG = {
    // Primary custom domain and underlying myshopify.com domain
    domain: env.SHOPIFY_DOMAIN || "wishshipped.com",
    myshopifyDomain: env.SHOPIFY_MYSHOPIFY_DOMAIN || "kumn11-qm.myshopify.com",

    // Numeric Shopify Shop ID (used for Shop Pay / Shop App & Customer Account OAuth)
    shopId: env.SHOPIFY_SHOP_ID || "102987006274",

    // Public Storefront API Token (Headless / Storefront GraphQL API)
    // Replace this single value if the client rotates or issues a new Headless Storefront token.
    storefrontAccessToken:
      env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "d7f2c4d005e479eb1eb245b00a8b64f0",

    // Storefront GraphQL API version
    apiVersion: env.SHOPIFY_API_VERSION || "2026-01",

    // Live Synchronization settings
    autoSyncOnLoad: env.SHOPIFY_AUTO_SYNC !== false,
    pollIntervalMs: Number(env.SHOPIFY_POLL_INTERVAL_MS) || 120000, // 2 minutes
    hideEmptyCategories: true
  };
})();
