/* ==========================================================================
   WishShipped.com — Storefront Application Logic
   Live Shopify Storefront GraphQL Sync · Multi-Photo Product Galleries
   Shop Pay Express · Customer Account Login · Contact & Mailing List
   ========================================================================== */

(function () {
  "use strict";

  const DATA = window.WISHSHIPPED_DATA;
  if (!DATA) {
    console.error("WISHSHIPPED_DATA failed to load.");
    return;
  }

  const CFG = window.SHOPIFY_CONFIG || {
    domain: "wishshipped.com",
    myshopifyDomain: "kumn11-qm.myshopify.com",
    shopId: "102987006274",
    storefrontAccessToken: "d7f2c4d005e479eb1eb245b00a8b64f0",
    apiVersion: "2026-01",
    autoSyncOnLoad: true,
    pollIntervalMs: 120000,
    hideEmptyCategories: true
  };

  const GRAPHQL_ENDPOINT = `https://${CFG.domain}/api/${CFG.apiVersion}/graphql.json`;

  const PRODUCTS = DATA.products || [];
  const PRODUCT_BY_HANDLE = new Map();
  const PRODUCT_BY_ID = new Map();

  function getProductImages(product) {
    if (Array.isArray(product.images) && product.images.length > 0) {
      return product.images;
    }
    return product.image ? [product.image] : [];
  }

  PRODUCTS.forEach((p) => {
    p.images = getProductImages(p);
    PRODUCT_BY_HANDLE.set(p.handle, p);
    PRODUCT_BY_ID.set(p.id, p);
  });

  // State
  const state = {
    currentView: "shop",
    collection: "all",
    character: "all",
    productType: "all",
    searchQuery: "",
    sortBy: "featured",
    pageSize: 48,
    visibleCount: 48,
    // Track active photo index per product handle
    photoIndexByHandle: new Map(),
    // Track selected variant index per product handle
    selectedVariantByHandle: new Map(),
    // Track currently open PDP handle
    openPdpHandle: null,
    // Shopping cart persisted in localStorage
    cart: loadCart(),
    activePolicyKey: "shipping",
    isSyncing: false
  };

  function loadCart() {
    try {
      const raw = localStorage.getItem("wishshipped_cart_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  }

  function saveCart() {
    try {
      localStorage.setItem("wishshipped_cart_v1", JSON.stringify(state.cart));
    } catch (e) {}
    updateCartBadgesAndDrawer();
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseNumericGid(gid) {
    if (!gid) return 0;
    const parts = String(gid).split("/");
    return Number(parts[parts.length - 1]) || 0;
  }

  // ========================================================================
  // 1. Navigation & View Switching
  // ========================================================================
  function switchView(viewName, options = {}) {
    state.currentView = viewName;
    const views = {
      shop: document.getElementById("view-shop"),
      about: document.getElementById("view-about"),
      reviews: document.getElementById("view-reviews"),
      contact: document.getElementById("view-contact"),
      policies: document.getElementById("view-policies")
    };

    Object.entries(views).forEach(([k, el]) => {
      if (!el) return;
      el.hidden = k !== viewName;
    });

    document.querySelectorAll("[data-nav-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-nav-view") === viewName);
    });

    document.querySelectorAll("[data-mobile-nav]").forEach((btn) => {
      const target = btn.getAttribute("data-mobile-nav");
      btn.classList.toggle(
        "active",
        (viewName === "shop" && target === "shop") ||
          (viewName === "about" && target === "story") ||
          (viewName === "contact" && target === "contact")
      );
    });

    if (viewName === "policies" && options.policyKey) {
      renderPolicyContent(options.policyKey);
    }

    if (!options.skipScroll) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // ========================================================================
  // 2. Product Card Renderer (Multi-Photo Gallery + Live Variants)
  // ========================================================================
  function getSelectedVariant(product) {
    const variants = product.variants || [];
    if (variants.length === 0) {
      return { id: 0, title: "Default Title", price: product.price, available: product.available !== false };
    }
    let idx = state.selectedVariantByHandle.get(product.handle);
    if (idx === undefined) {
      const firstAvail = variants.findIndex((v) => v.available !== false);
      idx = firstAvail >= 0 ? firstAvail : 0;
    }
    return variants[idx] || variants[0];
  }

  function getSelectedVariantIndex(product) {
    const variants = product.variants || [];
    if (variants.length === 0) return 0;
    let idx = state.selectedVariantByHandle.get(product.handle);
    if (idx === undefined) {
      const firstAvail = variants.findIndex((v) => v.available !== false);
      idx = firstAvail >= 0 ? firstAvail : 0;
    }
    return idx;
  }

  function createProductCardHtml(product) {
    const photos = getProductImages(product);
    const photoIdx = Math.min(state.photoIndexByHandle.get(product.handle) || 0, Math.max(0, photos.length - 1));
    const displayImg = photos[photoIdx] || product.image || "";
    const isCoverPhoto = displayImg.includes("assets/models/");

    const selectedIdx = getSelectedVariantIndex(product);
    const selectedVar = getSelectedVariant(product);
    const isProductAvailable = product.available !== false && Boolean(selectedVar && selectedVar.available !== false);

    // Multi-size variant chips (e.g. S, M, L, XL, 2X)
    const hasMultipleVariants =
      product.variants &&
      product.variants.length > 1 &&
      product.variants[0].title !== "Default Title";

    let variantsHtml = "";
    if (hasMultipleVariants) {
      variantsHtml = `<div class="product-card__variants" data-card-variants="${escapeHtml(product.handle)}">
        ${product.variants
          .map(
            (v, idx) => `<button
              type="button"
              class="size-chip ${idx === selectedIdx ? "active" : ""}"
              data-select-variant="${escapeHtml(product.handle)}"
              data-variant-idx="${idx}"
              ${v.available === false ? "disabled" : ""}
              title="${escapeHtml(v.title)}${v.available === false ? " (Out of Stock)" : ""}"
            >${escapeHtml(v.title)}</button>`
          )
          .join("")}
      </div>`;
    }

    // Multi-photo gallery controls (clean arrows + dots, no labels)
    let galleryControlsHtml = "";
    if (photos.length > 1) {
      galleryControlsHtml = `
        <button
          type="button"
          class="card-gallery-arrow card-gallery-arrow--prev"
          data-card-photo-step="-1"
          data-card-handle="${escapeHtml(product.handle)}"
          aria-label="Previous photo"
        >‹</button>
        <button
          type="button"
          class="card-gallery-arrow card-gallery-arrow--next"
          data-card-photo-step="1"
          data-card-handle="${escapeHtml(product.handle)}"
          aria-label="Next photo"
        >›</button>
        <div class="card-gallery-dots">
          ${photos
            .map(
              (_, i) => `<button
                type="button"
                class="card-gallery-dot ${i === photoIdx ? "active" : ""}"
                data-card-photo-idx="${i}"
                data-card-handle="${escapeHtml(product.handle)}"
                aria-label="Photo ${i + 1}"
              ></button>`
            )
            .join("")}
        </div>
      `;
    }

    const soldOutBadge = !isProductAvailable
      ? `<div class="product-card__badges"><span class="badge-2d badge-2d--soldout">Sold Out</span></div>`
      : "";

    return `<article class="product-card" data-product-handle="${escapeHtml(product.handle)}">
      <div class="product-card__media" data-open-pdp="${escapeHtml(product.handle)}">
        ${soldOutBadge}
        <img
          src="${escapeHtml(displayImg)}"
          alt="${escapeHtml(product.title)}"
          class="product-card__img ${isCoverPhoto ? "product-card__img--cover" : ""}"
          loading="lazy"
          width="400"
          height="500"
          onerror="if(this.src!=='${escapeHtml(product.cdnImage || "")}' && '${escapeHtml(product.cdnImage || "")}'){this.src='${escapeHtml(product.cdnImage || "")}';}"
        />
        ${galleryControlsHtml}
        <span class="product-card__price-sticker">$${escapeHtml(selectedVar.price)}</span>
      </div>
      <div class="product-card__body">
        <h3 class="product-card__title" data-open-pdp="${escapeHtml(product.handle)}">${escapeHtml(product.title)}</h3>
        ${variantsHtml}
        <div class="product-card__actions">
          <button
            type="button"
            class="card-btn-add"
            data-add-cart="${escapeHtml(product.handle)}"
            ${!isProductAvailable ? "disabled" : ""}
          >
            ${isProductAvailable ? "Add to Bag" : "Sold Out"}
          </button>
          <button
            type="button"
            class="card-btn-shop"
            data-buy-shop="${escapeHtml(product.handle)}"
            ${!isProductAvailable ? "disabled" : ""}
          >
            Buy with Shop
          </button>
        </div>
      </div>
    </article>`;
  }

  // ========================================================================
  // 3. Render Top Collection Tabs & Sidebar Filters (Zero Empty Filters!)
  // ========================================================================
  const CHARACTER_FILTERS = [
    { key: "all", label: "All" },
    { key: "mickey", label: "Mickey Mouse" },
    { key: "minnie", label: "Minnie Mouse" },
    { key: "stitch", label: "Stitch & Angel" },
    { key: "harry potter", label: "Harry Potter" },
    { key: "star wars", label: "Star Wars" },
    { key: "marvel", label: "Marvel / Spider-Man" },
    { key: "minion", label: "Minions" },
    { key: "princess", label: "Disney Princess" },
    { key: "pooh", label: "Winnie the Pooh" },
    { key: "tinker", label: "Tinkerbell" },
    { key: "toy story", label: "Toy Story" },
    { key: "mario", label: "Super Mario" }
  ];

  function matchesCharacter(product, charKey) {
    if (charKey === "all") return true;
    const hay = `${product.title} ${product.handle} ${(product.tags || []).join(" ")}`.toLowerCase();
    if (charKey === "harry potter") {
      return hay.includes("harry") || hay.includes("potter") || hay.includes("hogwarts") || hay.includes("gryff") || hay.includes("slyth");
    }
    if (charKey === "star wars") {
      return hay.includes("star wars") || hay.includes("vader") || hay.includes("mandalorian") || hay.includes("grogu") || hay.includes("yoda");
    }
    if (charKey === "marvel") {
      return hay.includes("marvel") || hay.includes("spiderman") || hay.includes("avengers");
    }
    if (charKey === "princess") {
      return (
        hay.includes("princess") ||
        hay.includes("ariel") ||
        hay.includes("moana") ||
        hay.includes("belle") ||
        hay.includes("elsa") ||
        hay.includes("aurora") ||
        hay.includes("cinderella")
      );
    }
    if (charKey === "toy story") {
      return hay.includes("toy story") || hay.includes("pizza planet") || hay.includes("buzz") || hay.includes("woody");
    }
    if (charKey === "mario") {
      return hay.includes("yoshi") || hay.includes("wario") || hay.includes("waluigi") || hay.includes("peach") || hay.includes("mario");
    }
    return hay.includes(charKey);
  }

  function computeNonEmptyCollections() {
    // Dynamically count products in each collection so empty collections (0 items) are never shown
    const countsByCol = new Map();
    PRODUCTS.forEach((p) => {
      (p.collections || []).forEach((colHandle) => {
        countsByCol.set(colHandle, (countsByCol.get(colHandle) || 0) + 1);
      });
    });

    const knownCols = (DATA.collections || []).filter((c) => c.handle !== "all");
    const result = [
      { handle: "all", title: "All Products", count: PRODUCTS.length }
    ];

    const seen = new Set(["all"]);
    knownCols.forEach((c) => {
      const cnt = countsByCol.get(c.handle) || 0;
      if (cnt > 0) {
        result.push({ handle: c.handle, title: c.title, count: cnt });
        seen.add(c.handle);
      }
    });

    // Include any new collections dynamically discovered from Shopify
    countsByCol.forEach((cnt, handle) => {
      if (!seen.has(handle) && cnt > 0 && handle !== "frontpage") {
        const pretty = handle
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        result.push({ handle, title: pretty, count: cnt });
      }
    });

    return result;
  }

  function renderFiltersAndTabs() {
    const nonEmptyCols = computeNonEmptyCollections();

    // 1. Top Collection Bar (exclude 'frontpage' internal collection from top bar)
    const topTabs = document.getElementById("top-collection-tabs");
    if (topTabs) {
      const topBarCols = nonEmptyCols.filter((c) => c.handle !== "frontpage");
      topTabs.innerHTML = topBarCols
        .map(
          (c) => `<button
            type="button"
            class="collection-tab ${state.collection === c.handle ? "active" : ""}"
            data-select-collection="${escapeHtml(c.handle)}"
          >
            <span>${escapeHtml(c.title)}</span>
            <span class="collection-tab__count">${c.count}</span>
          </button>`
        )
        .join("");
    }

    // 2. Sidebar Collections (only collections with count > 0)
    const sideCols = document.getElementById("sidebar-collections");
    if (sideCols) {
      const sideBarCols = nonEmptyCols.filter((c) => c.handle !== "frontpage");
      sideCols.innerHTML = sideBarCols
        .map(
          (c) => `<button
            type="button"
            class="sidebar-btn ${state.collection === c.handle ? "active" : ""}"
            data-select-collection="${escapeHtml(c.handle)}"
          >
            <span>${escapeHtml(c.title)}</span>
            <span class="sidebar-btn__count">${c.count}</span>
          </button>`
        )
        .join("");
    }

    // 3. Sidebar Characters (only characters with > 0 matching products)
    const sideChars = document.getElementById("sidebar-characters");
    if (sideChars) {
      const nonEmptyChars = CHARACTER_FILTERS.filter((cf) => {
        if (cf.key === "all") return true;
        return PRODUCTS.some((p) => matchesCharacter(p, cf.key));
      });
      sideChars.innerHTML = nonEmptyChars
        .map(
          (cf) => `<button
            type="button"
            class="tag-chip ${state.character === cf.key ? "active" : ""}"
            data-select-character="${escapeHtml(cf.key)}"
          >${escapeHtml(cf.label)}</button>`
        )
        .join("");
    }

    // 4. Sidebar Product Types (only product types with count > 0)
    const sideTypes = document.getElementById("sidebar-types");
    if (sideTypes) {
      const typeCounts = new Map();
      PRODUCTS.forEach((p) => {
        const t = (p.type || "").trim();
        if (!t) return;
        typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
      });
      const sortedTypes = Array.from(typeCounts.entries())
        .filter(([, cnt]) => cnt > 0)
        .sort((a, b) => b[1] - a[1]);

      sideTypes.innerHTML = [
        `<button type="button" class="sidebar-btn ${state.productType === "all" ? "active" : ""}" data-select-type="all">
          <span>All Categories</span>
          <span class="sidebar-btn__count">${PRODUCTS.length}</span>
        </button>`,
        ...sortedTypes.map(
          ([t, cnt]) => `<button
            type="button"
            class="sidebar-btn ${state.productType === t ? "active" : ""}"
            data-select-type="${escapeHtml(t)}"
          >
            <span>${escapeHtml(t)}</span>
            <span class="sidebar-btn__count">${cnt}</span>
          </button>`
        )
      ].join("");
    }
  }

  // ========================================================================
  // 4. Filter, Sort & Render Main Product Catalog
  // ========================================================================
  function getFilteredProducts() {
    const q = state.searchQuery.trim().toLowerCase();

    let list = PRODUCTS.filter((p) => {
      if (state.collection !== "all") {
        if (!(p.collections || []).includes(state.collection)) return false;
      }

      if (state.productType !== "all" && p.type !== state.productType) {
        return false;
      }

      if (state.character !== "all" && !matchesCharacter(p, state.character)) {
        return false;
      }

      if (q) {
        const hay = `${p.title} ${p.type} ${p.handle} ${(p.tags || []).join(" ")}`.toLowerCase();
        const terms = q.split(/\s+/);
        if (!terms.every((t) => hay.includes(t))) return false;
      }

      return true;
    });

    if (state.sortBy === "price-asc") {
      list = [...list].sort((a, b) => a.priceNum - b.priceNum);
    } else if (state.sortBy === "price-desc") {
      list = [...list].sort((a, b) => b.priceNum - a.priceNum);
    } else if (state.sortBy === "title-asc") {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else if (state.sortBy === "title-desc") {
      list = [...list].sort((a, b) => b.title.localeCompare(a.title));
    }

    return list;
  }

  const FEATURED_HANDLES = [
    "moana-adventure-dress",
    "harry-potter-hog-team-short-sleeve-top",
    "mickey-mouse-hiding-pant-bottoms",
    "40oz-stitch-tumbler"
  ];

  function renderFeaturedItems() {
    const featuredLanding = document.getElementById("featured-landing");
    const featuredGrid = document.getElementById("featured-grid");
    if (!featuredLanding || !featuredGrid) return;

    const isDefaultLanding =
      state.collection === "all" &&
      state.character === "all" &&
      state.productType === "all" &&
      !state.searchQuery.trim();

    if (!isDefaultLanding) {
      featuredLanding.hidden = true;
      return;
    }

    const featuredProducts = FEATURED_HANDLES.map((h) => PRODUCT_BY_HANDLE.get(h)).filter(Boolean);
    if (featuredProducts.length === 0) {
      featuredLanding.hidden = true;
      return;
    }

    featuredLanding.hidden = false;
    featuredGrid.innerHTML = featuredProducts.map((p) => createProductCardHtml(p)).join("");
  }

  function renderCatalog() {
    renderFeaturedItems();
    const filtered = getFilteredProducts();
    const total = filtered.length;
    const slice = filtered.slice(0, state.visibleCount);

    const grid = document.getElementById("catalog-grid");
    const countLabel = document.getElementById("catalog-count-label");
    const headingTitle = document.getElementById("catalog-heading-title");
    const activeChips = document.getElementById("active-filter-chips");
    const progressText = document.getElementById("pagination-progress-text");
    const loadMoreBtn = document.getElementById("load-more-btn");
    const loadAllBtn = document.getElementById("load-all-btn");

    const nonEmptyCols = computeNonEmptyCollections();
    const colObj = nonEmptyCols.find((c) => c.handle === state.collection);
    const colTitle = colObj ? colObj.title : "All Products";

    if (headingTitle) {
      headingTitle.textContent = `${colTitle} (${total})`;
    }

    if (countLabel) {
      countLabel.textContent =
        total === 0 ? "0 items" : `Showing 1–${slice.length} of ${total}`;
    }

    if (activeChips) {
      const chips = [];
      if (state.collection !== "all") {
        chips.push(`<span class="active-filter-tag" data-clear-filter="collection">${escapeHtml(colTitle)} ✕</span>`);
      }
      if (state.character !== "all") {
        chips.push(`<span class="active-filter-tag" data-clear-filter="character">${escapeHtml(state.character)} ✕</span>`);
      }
      if (state.productType !== "all") {
        chips.push(`<span class="active-filter-tag" data-clear-filter="productType">${escapeHtml(state.productType)} ✕</span>`);
      }
      if (state.searchQuery) {
        chips.push(`<span class="active-filter-tag" data-clear-filter="search">"${escapeHtml(state.searchQuery)}" ✕</span>`);
      }
      activeChips.innerHTML = chips.join("");
    }

    if (grid) {
      if (total === 0) {
        grid.innerHTML = `<div class="paper-card-2d" style="grid-column:1/-1;text-align:center;padding:32px;">
          <h3 style="font-family:var(--font-display);font-size:20px;margin-bottom:10px;">No products found</h3>
          <button type="button" class="btn-2d btn-2d--yellow" id="empty-reset-btn">Reset Filters</button>
        </div>`;
      } else {
        grid.innerHTML = slice.map((p) => createProductCardHtml(p)).join("");
      }
    }

    if (progressText) {
      progressText.textContent = `${slice.length} of ${total}`;
    }
    if (loadMoreBtn) {
      loadMoreBtn.hidden = slice.length >= total;
    }
    if (loadAllBtn) {
      loadAllBtn.hidden = slice.length >= total;
    }
  }

  // ========================================================================
  // 5. Predictive Search Dropdown
  // ========================================================================
  function renderPredictiveDropdown(query) {
    const dropdown = document.getElementById("predictive-dropdown");
    if (!dropdown) return;

    const q = query.trim().toLowerCase();
    if (!q) {
      dropdown.hidden = true;
      return;
    }

    const matches = PRODUCTS.filter((p) => {
      const hay = `${p.title} ${p.type} ${p.handle} ${(p.tags || []).join(" ")}`.toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    }).slice(0, 8);

    if (matches.length === 0) {
      dropdown.innerHTML = `<div style="padding:12px;font-size:13px;font-weight:700;">No products found for "${escapeHtml(query)}"</div>`;
      dropdown.hidden = false;
      return;
    }

    dropdown.innerHTML = matches
      .map((p) => {
        const photos = getProductImages(p);
        const img = photos[0] || p.image || "";
        return `<div class="predictive-item" data-open-pdp="${escapeHtml(p.handle)}">
          <img src="${escapeHtml(img)}" alt="${escapeHtml(p.title)}" class="predictive-item__img" loading="lazy" />
          <div>
            <div class="predictive-item__title">${escapeHtml(p.title)}</div>
            <div class="predictive-item__meta">${escapeHtml(p.type || "")}</div>
          </div>
          <div class="predictive-item__price">$${escapeHtml(p.price)}</div>
        </div>`;
      })
      .join("");
    dropdown.hidden = false;
  }

  // ========================================================================
  // 6. Product Detail Modal (PDP) — Clean Multi-Photo Gallery & Buttons
  // ========================================================================
  function openPdpModal(handle) {
    const product = PRODUCT_BY_HANDLE.get(handle);
    if (!product) return;

    state.openPdpHandle = handle;
    const modal = document.getElementById("pdp-modal");
    const body = document.getElementById("pdp-modal-body");
    if (!modal || !body) return;

    const photos = getProductImages(product);
    const activePhotoIdx = Math.min(state.photoIndexByHandle.get(product.handle) || 0, Math.max(0, photos.length - 1));
    const activePhoto = photos[activePhotoIdx] || product.image || "";

    const selectedIdx = getSelectedVariantIndex(product);
    const selectedVar = getSelectedVariant(product);
    const isAvailable = product.available !== false && Boolean(selectedVar && selectedVar.available !== false);

    const variantsButtonsHtml =
      product.variants && product.variants.length > 1 && product.variants[0].title !== "Default Title"
        ? `<div style="margin:12px 0;">
            <div style="font-size:12px;font-weight:800;text-transform:uppercase;margin-bottom:6px;">Size</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${product.variants
                .map(
                  (v, idx) => `<button
                    type="button"
                    class="btn-2d ${idx === selectedIdx ? "btn-2d--yellow" : ""}"
                    style="padding:6px 14px;"
                    data-pdp-variant-idx="${idx}"
                    data-pdp-handle="${escapeHtml(product.handle)}"
                    ${v.available === false ? "disabled" : ""}
                  >${escapeHtml(v.title)}</button>`
                )
                .join("")}
            </div>
          </div>`
        : "";

    const thumbsHtml =
      photos.length > 1
        ? `<div class="pdp-thumbs">
            ${photos
              .map(
                (src, idx) => `<button
                  type="button"
                  class="pdp-thumb-btn ${idx === activePhotoIdx ? "active" : ""}"
                  data-pdp-photo-idx="${idx}"
                  data-pdp-handle="${escapeHtml(product.handle)}"
                  aria-label="View photo ${idx + 1}"
                >
                  <img src="${escapeHtml(src)}" alt="${escapeHtml(product.title)}" loading="lazy" />
                </button>`
              )
              .join("")}
          </div>`
        : "";

    const cleanBodyHtml = (product.bodyHtml || "").trim();
    const descriptionBlock = cleanBodyHtml
      ? `<div style="margin-top:8px;font-size:14px;line-height:1.55;color:var(--ink-muted);">${cleanBodyHtml}</div>`
      : "";

    body.innerHTML = `
      <div class="pdp-modal-grid">
        <div>
          <div class="pdp-media-box">
            <img id="pdp-main-img" src="${escapeHtml(activePhoto)}" alt="${escapeHtml(product.title)}" />
          </div>
          ${thumbsHtml}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${product.type ? `<div><span class="badge-2d">${escapeHtml(product.type)}</span></div>` : ""}

          <h2 id="pdp-modal-title" style="font-family:var(--font-display);font-size:26px;line-height:1.15;">
            ${escapeHtml(product.title)}
          </h2>

          <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:10px;">
            <span>$${escapeHtml(selectedVar.price)}</span>
            ${!isAvailable ? `<span class="badge-2d badge-2d--soldout">Sold Out</span>` : ""}
          </div>

          ${variantsButtonsHtml}

          <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
            <button
              type="button"
              class="btn-2d btn-2d--blue"
              style="width:100%;padding:12px;font-size:15px;"
              data-add-cart="${escapeHtml(product.handle)}"
              data-close-after-add="true"
              ${!isAvailable ? "disabled" : ""}
            >
              ${isAvailable ? "Add to Shopping Bag" : "Sold Out"}
            </button>

            <button
              type="button"
              class="btn-2d btn-2d--shop"
              style="width:100%;padding:12px;font-size:15px;"
              data-buy-shop="${escapeHtml(product.handle)}"
              ${!isAvailable ? "disabled" : ""}
            >
              Buy with Shop
            </button>
          </div>

          ${descriptionBlock}
        </div>
      </div>
    `;

    modal.hidden = false;
  }

  // ========================================================================
  // 7. Shopping Bag / Cart + Shopify Storefront API Checkout & Shop Pay
  // ========================================================================
  function addToCart(handle, qty = 1) {
    const product = PRODUCT_BY_HANDLE.get(handle);
    if (!product) return;

    const selectedVar = getSelectedVariant(product);
    if (!selectedVar || selectedVar.available === false) return;

    const photos = getProductImages(product);
    const existing = state.cart.find((item) => item.variantId === selectedVar.id);
    if (existing) {
      existing.qty += qty;
    } else {
      state.cart.push({
        handle: product.handle,
        title: product.title,
        variantId: selectedVar.id,
        variantTitle: selectedVar.title === "Default Title" ? "" : selectedVar.title,
        price: parseFloat(selectedVar.price),
        priceStr: selectedVar.price,
        image: photos[0] || product.image,
        qty: qty
      });
    }
    saveCart();
  }

  function updateCartBadgesAndDrawer() {
    const totalCount = state.cart.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);

    const badge1 = document.getElementById("cart-count-badge");
    const badge2 = document.getElementById("drawer-cart-count");
    const badge3 = document.getElementById("mobile-dock-cart-count");
    if (badge1) badge1.textContent = String(totalCount);
    if (badge2) badge2.textContent = String(totalCount);
    if (badge3) badge3.textContent = String(totalCount);

    const subEl = document.getElementById("cart-subtotal-amount");
    if (subEl) subEl.textContent = `$${subtotal.toFixed(2)}`;

    const threshold = 49.99;
    const pct = Math.min(100, (subtotal / threshold) * 100);
    const barFill = document.getElementById("shipping-bar-fill");
    const barText = document.getElementById("shipping-bar-text");
    if (barFill) barFill.style.width = `${pct.toFixed(1)}%`;
    if (barText) {
      if (subtotal >= threshold) {
        barText.innerHTML = "Free shipping unlocked";
      } else {
        const diff = (threshold - subtotal).toFixed(2);
        barText.innerHTML = `Add <strong>$${diff}</strong> more for free shipping`;
      }
    }

    const container = document.getElementById("cart-items-container");
    if (!container) return;

    if (state.cart.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:40px 16px;">
        <h3 style="font-family:var(--font-display);font-size:19px;margin-bottom:12px;">Your bag is empty</h3>
        <button type="button" class="btn-2d btn-2d--yellow" id="empty-cart-shop-btn">Continue Shopping</button>
      </div>`;
      return;
    }

    container.innerHTML = state.cart
      .map(
        (item, idx) => `<div class="cart-line-item">
          <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="cart-line-item__img" />
          <div>
            <div style="font-size:13.5px;font-weight:700;line-height:1.25;">${escapeHtml(item.title)}</div>
            ${item.variantTitle ? `<div style="font-size:11.5px;color:var(--ink-muted);font-weight:700;">Size: ${escapeHtml(item.variantTitle)}</div>` : ""}
            <div style="font-family:var(--font-mono);font-size:13px;font-weight:700;margin-top:4px;">$${(item.price * item.qty).toFixed(2)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
            <div style="display:flex;align-items:center;gap:4px;">
              <button type="button" class="size-chip" data-cart-dec="${idx}">−</button>
              <span style="font-family:var(--font-mono);font-size:12px;font-weight:700;min-width:18px;text-align:center;">${item.qty}</span>
              <button type="button" class="size-chip" data-cart-inc="${idx}">＋</button>
            </div>
            <button type="button" style="background:none;border:none;font-size:11px;color:var(--red);font-weight:700;cursor:pointer;" data-cart-rm="${idx}">Remove</button>
          </div>
        </div>`
      )
      .join("");
  }

  function buildCartPermalink(items, useShopPay = false) {
    const pairs = items.map((i) => `${i.variantId}:${i.qty}`).join(",");
    const base = `https://${CFG.domain}/cart/${pairs}`;
    return useShopPay ? `${base}?payment=shop_pay` : base;
  }

  async function proceedToShopifyCheckout(useShopPay = false) {
    if (state.cart.length === 0) return;

    if (useShopPay) {
      window.location.href = buildCartPermalink(state.cart, true);
      return;
    }

    const checkoutBtn = document.getElementById("cart-checkout-btn");
    if (checkoutBtn) {
      checkoutBtn.textContent = "Loading...";
      checkoutBtn.disabled = true;
    }

    try {
      const lines = state.cart.map((item) => ({
        merchandiseId: `gid://shopify/ProductVariant/${item.variantId}`,
        quantity: item.qty
      }));

      const res = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": CFG.storefrontAccessToken
        },
        body: JSON.stringify({
          query: `mutation cartCreate($lines: [CartLineInput!]!) {
            cartCreate(input: { lines: $lines }) {
              cart { id checkoutUrl }
              userErrors { field message }
            }
          }`,
          variables: { lines }
        })
      });

      const json = await res.json();
      const checkoutUrl =
        json &&
        json.data &&
        json.data.cartCreate &&
        json.data.cartCreate.cart &&
        json.data.cartCreate.cart.checkoutUrl;

      if (checkoutUrl) {
        window.location.href = checkoutUrl;
        return;
      }
    } catch (err) {
      console.warn("Storefront API fallback to permalink:", err);
    }

    window.location.href = buildCartPermalink(state.cart, false);
  }

  // ========================================================================
  // 8. Live Shopify Storefront GraphQL Sync Engine
  //    (Syncs live in-stock / out-of-stock status, prices, categories,
  //     and auto-adds any new products added in Shopify Admin)
  // ========================================================================
  async function syncWithShopifyStorefront() {
    if (state.isSyncing || !CFG.storefrontAccessToken) return;
    state.isSyncing = true;

    const syncText = document.getElementById("shopify-sync-text");
    try {
      let hasNextPage = true;
      let cursor = null;
      let syncedCount = 0;
      let addedNewCount = 0;

      while (hasNextPage) {
        const query = `
          query SyncCatalog($cursor: String) {
            products(first: 250, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  handle
                  title
                  productType
                  availableForSale
                  descriptionHtml
                  tags
                  collections(first: 15) {
                    edges {
                      node {
                        handle
                        title
                      }
                    }
                  }
                  images(first: 10) {
                    edges {
                      node {
                        url
                      }
                    }
                  }
                  variants(first: 50) {
                    edges {
                      node {
                        id
                        title
                        availableForSale
                        sku
                        price {
                          amount
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const res = await fetch(GRAPHQL_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Storefront-Access-Token": CFG.storefrontAccessToken
          },
          body: JSON.stringify({ query, variables: { cursor } })
        });

        if (!res.ok) break;
        const payload = await res.json();
        const productsConn = payload && payload.data && payload.data.products;
        if (!productsConn) break;

        const edges = productsConn.edges || [];
        edges.forEach(({ node }) => {
          if (!node || !node.handle) return;
          syncedCount += 1;

          const numericPid = parseNumericGid(node.id);
          const liveVariants = (node.variants && node.variants.edges || []).map(({ node: v }) => ({
            id: parseNumericGid(v.id),
            title: v.title || "Default Title",
            price: Number(v.price && v.price.amount || 0).toFixed(2),
            sku: v.sku || "",
            available: Boolean(v.availableForSale)
          }));

          const firstPrice = liveVariants[0] ? liveVariants[0].price : "0.00";
          const colHandles = (node.collections && node.collections.edges || []).map(({ node: c }) => {
            // Ensure collection is registered in DATA.collections if new
            if (c && c.handle && !(DATA.collections || []).some((dc) => dc.handle === c.handle)) {
              DATA.collections.push({ handle: c.handle, title: c.title || c.handle, count: 1 });
            }
            return c.handle;
          });

          const liveImages = (node.images && node.images.edges || [])
            .map(({ node: img }) => img && img.url)
            .filter(Boolean);

          const existing = PRODUCT_BY_HANDLE.get(node.handle);
          if (existing) {
            existing.title = node.title || existing.title;
            existing.type = node.productType || existing.type;
            existing.available = Boolean(node.availableForSale);
            existing.price = firstPrice;
            existing.priceNum = parseFloat(firstPrice) || existing.priceNum;
            existing.variants = liveVariants.length > 0 ? liveVariants : existing.variants;
            if (colHandles.length > 0) {
              existing.collections = colHandles;
            }
            if (Array.isArray(node.tags) && node.tags.length > 0) {
              existing.tags = node.tags;
            }
            if (node.descriptionHtml !== undefined) {
              existing.bodyHtml = node.descriptionHtml;
            }
            if (liveImages[0]) {
              existing.cdnImage = liveImages[0];
            }
            // If Shopify has additional product photos beyond the first flat photo, append them
            if (liveImages.length > 1) {
              const curImgs = getProductImages(existing);
              liveImages.slice(1).forEach((extraUrl) => {
                if (!curImgs.includes(extraUrl)) curImgs.push(extraUrl);
              });
              existing.images = curImgs;
            }
          } else {
            // Brand-new product added in Shopify Admin!
            const newProd = {
              id: numericPid,
              handle: node.handle,
              title: node.title,
              type: node.productType || "Souvenir",
              vendor: "WishShipped",
              price: firstPrice,
              priceNum: parseFloat(firstPrice) || 0,
              available: Boolean(node.availableForSale),
              image: liveImages[0] || "assets/brand/logo.png",
              images: liveImages.length > 0 ? liveImages : ["assets/brand/logo.png"],
              cdnImage: liveImages[0] || "",
              collections: colHandles,
              tags: node.tags || [],
              variants: liveVariants,
              bodyHtml: node.descriptionHtml || ""
            };
            PRODUCTS.unshift(newProd);
            PRODUCT_BY_HANDLE.set(newProd.handle, newProd);
            PRODUCT_BY_ID.set(newProd.id, newProd);
            addedNewCount += 1;
          }
        });

        hasNextPage = Boolean(productsConn.pageInfo && productsConn.pageInfo.hasNextPage);
        cursor = productsConn.pageInfo ? productsConn.pageInfo.endCursor : null;
      }

      if (syncedCount > 0) {
        renderFiltersAndTabs();
        renderCatalog();
        if (state.openPdpHandle && !document.getElementById("pdp-modal").hidden) {
          openPdpModal(state.openPdpHandle);
        }
        if (syncText) {
          syncText.textContent = addedNewCount > 0
            ? `Synced · ${PRODUCTS.length} Products (+${addedNewCount} New)`
            : `Live Inventory (${PRODUCTS.length} Items)`;
        }
      }
    } catch (err) {
      console.warn("Shopify live sync check:", err);
    } finally {
      state.isSyncing = false;
    }
  }

  // ========================================================================
  // 9. Render Reviews & Policies
  // ========================================================================
  function renderReviewsWall() {
    const gmaps = DATA.googleMaps || {};
    const grid = document.getElementById("reviews-wall-grid");
    if (grid && gmaps.reviews) {
      grid.innerHTML = gmaps.reviews
        .map(
          (r) => `<article class="review-card-2d">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <strong style="font-size:15px;">${escapeHtml(r.author)}</strong>
                <div style="font-size:11.5px;color:var(--ink-muted);">${escapeHtml(r.badge)}</div>
              </div>
              <span class="badge-2d">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span>
            </div>
            <p style="font-size:14px;line-height:1.55;">“${escapeHtml(r.text)}”</p>
            <div style="font-size:11.5px;color:var(--ink-muted);margin-top:auto;">${escapeHtml(r.date)}</div>
          </article>`
        )
        .join("");
    }
  }

  function renderPolicyContent(key) {
    state.activePolicyKey = key;
    document.querySelectorAll("[data-policy-key]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-policy-key") === key);
    });

    const box = document.getElementById("policy-content-box");
    if (!box) return;

    const p = DATA.pages || {};
    const gpcActive = Boolean(navigator.globalPrivacyControl);

    const map = {
      shipping: `<h2>Shipping Policy</h2>${p.shippingPolicyHtml || ""}`,
      refund: `<h2>Refund Policy</h2>${p.refundPolicyHtml || ""}`,
      privacy: `<h2>Privacy Policy</h2>${p.privacyPolicyHtml || ""}`,
      terms: `<h2>Terms of Service</h2>${p.termsOfServiceHtml || ""}`,
      legal: `<h2>Legal Notice</h2>${p.legalNoticeHtml || ""}`,
      contactInfo: `<h2>Contact Information</h2>${p.contactInfoHtml || ""}`,
      optOut: `
        <h2>Your Privacy Choices</h2>
        <p>As described in our Privacy Policy, we collect personal information from your interactions with us and our website, including through cookies and similar technologies. We may also share this personal information with third parties, including advertising partners. We do this in order to show you ads on other websites that are more relevant to your interests and for other reasons outlined in our privacy policy.</p>
        <p>Sharing of personal information for targeted advertising based on your interaction on different websites may be considered "sales", "sharing", or "targeted advertising" under certain U.S. state privacy laws. Depending on where you live, you may have the right to opt out of these activities. If you would like to exercise this opt-out right, please follow the instructions below.</p>
        <p>If you visit our website with the Global Privacy Control opt-out preference signal enabled, depending on where you are, we will treat this as a request to opt-out of activity that may be considered a “sale” or “sharing” of personal information or other uses that may be considered targeted advertising for the device and browser you used to visit our website.</p>
        <div style="margin-top:16px;padding:16px;background:var(--bg-yellow-tint);border:var(--border-2d);border-radius:10px;">
          <strong>Global Privacy Control (GPC):</strong>
          <span class="badge-2d" style="margin-left:8px;">${gpcActive ? "Active" : "Not Detected"}</span>
          <div style="margin-top:12px;">
            <button type="button" class="btn-2d btn-2d--blue" id="opt-out-confirm-btn">Opt Out</button>
            <span id="opt-out-status-msg" style="margin-left:10px;font-weight:700;color:var(--green);" hidden>✓ Preference saved.</span>
          </div>
        </div>
      `,
      news: `
        <h2>News</h2>
        <p>No posts yet.</p>
      `
    };

    box.innerHTML = map[key] || map.shipping;
  }

  // ========================================================================
  // 10. Event Delegation & Form Bindings
  // ========================================================================
  function bindEvents() {
    document.addEventListener("click", (e) => {
      const target = e.target;

      // 1. View Navigation
      const navBtn = target.closest("[data-nav-view]");
      if (navBtn) {
        e.preventDefault();
        switchView(navBtn.getAttribute("data-nav-view"));
        return;
      }

      // 2. Policy Jump Links
      const polJump = target.closest("[data-policy-jump]");
      if (polJump) {
        e.preventDefault();
        switchView("policies", { policyKey: polJump.getAttribute("data-policy-jump") });
        return;
      }

      const polTab = target.closest("[data-policy-key]");
      if (polTab) {
        renderPolicyContent(polTab.getAttribute("data-policy-key"));
        return;
      }

      if (target.id === "opt-out-confirm-btn") {
        localStorage.setItem("wishshipped_privacy_opt_out", "true");
        const msg = document.getElementById("opt-out-status-msg");
        if (msg) msg.hidden = false;
        return;
      }

      // 3. Collection Selection
      const colBtn = target.closest("[data-select-collection]");
      if (colBtn) {
        const col = colBtn.getAttribute("data-select-collection");
        state.collection = col;
        state.visibleCount = state.pageSize;
        if (state.currentView !== "shop") switchView("shop", { skipScroll: true });
        renderFiltersAndTabs();
        renderCatalog();
        return;
      }

      const colJump = target.closest("[data-col-jump]");
      if (colJump) {
        e.preventDefault();
        state.collection = colJump.getAttribute("data-col-jump");
        state.visibleCount = state.pageSize;
        switchView("shop", { skipScroll: false });
        renderFiltersAndTabs();
        renderCatalog();
        return;
      }

      // 4. Character & Product Type Filters
      const charBtn = target.closest("[data-select-character]");
      if (charBtn) {
        state.character = charBtn.getAttribute("data-select-character");
        state.visibleCount = state.pageSize;
        renderFiltersAndTabs();
        renderCatalog();
        return;
      }

      const typeBtn = target.closest("[data-select-type]");
      if (typeBtn) {
        state.productType = typeBtn.getAttribute("data-select-type");
        state.visibleCount = state.pageSize;
        renderFiltersAndTabs();
        renderCatalog();
        return;
      }

      const clearChip = target.closest("[data-clear-filter]");
      if (clearChip) {
        const fType = clearChip.getAttribute("data-clear-filter");
        if (fType === "collection") state.collection = "all";
        if (fType === "character") state.character = "all";
        if (fType === "productType") state.productType = "all";
        if (fType === "search") {
          state.searchQuery = "";
          const sIn = document.getElementById("search-input");
          if (sIn) sIn.value = "";
        }
        renderFiltersAndTabs();
        renderCatalog();
        return;
      }

      if (target.id === "mobile-filter-toggle-btn") {
        const sb = document.querySelector(".catalog-sidebar");
        if (sb) sb.classList.toggle("mobile-open");
        return;
      }

      if (target.id === "reset-filters-btn" || target.id === "empty-reset-btn") {
        state.collection = "all";
        state.character = "all";
        state.productType = "all";
        state.searchQuery = "";
        state.visibleCount = state.pageSize;
        const sIn = document.getElementById("search-input");
        if (sIn) sIn.value = "";
        renderFiltersAndTabs();
        renderCatalog();
        return;
      }

      // 5. Multi-Photo Card Gallery Arrows & Dots
      const stepBtn = target.closest("[data-card-photo-step]");
      if (stepBtn) {
        e.stopPropagation();
        const h = stepBtn.getAttribute("data-card-handle");
        const step = parseInt(stepBtn.getAttribute("data-card-photo-step"), 10) || 1;
        const p = PRODUCT_BY_HANDLE.get(h);
        if (p) {
          const photos = getProductImages(p);
          const cur = state.photoIndexByHandle.get(h) || 0;
          const next = (cur + step + photos.length) % photos.length;
          state.photoIndexByHandle.set(h, next);
          renderCatalog();
        }
        return;
      }

      const dotBtn = target.closest("[data-card-photo-idx]");
      if (dotBtn) {
        e.stopPropagation();
        const h = dotBtn.getAttribute("data-card-handle");
        const idx = parseInt(dotBtn.getAttribute("data-card-photo-idx"), 10) || 0;
        state.photoIndexByHandle.set(h, idx);
        renderCatalog();
        return;
      }

      // 6. Variant Size Selection on Card
      const varChip = target.closest("[data-select-variant]");
      if (varChip) {
        e.stopPropagation();
        const h = varChip.getAttribute("data-select-variant");
        const idx = parseInt(varChip.getAttribute("data-variant-idx"), 10) || 0;
        state.selectedVariantByHandle.set(h, idx);
        renderCatalog();
        return;
      }

      // 7. Variant & Photo Thumbnail Selection inside PDP Modal
      const pdpVarBtn = target.closest("[data-pdp-variant-idx]");
      if (pdpVarBtn) {
        const h = pdpVarBtn.getAttribute("data-pdp-handle");
        const idx = parseInt(pdpVarBtn.getAttribute("data-pdp-variant-idx"), 10) || 0;
        state.selectedVariantByHandle.set(h, idx);
        openPdpModal(h);
        renderCatalog();
        return;
      }

      const pdpPhotoBtn = target.closest("[data-pdp-photo-idx]");
      if (pdpPhotoBtn) {
        const h = pdpPhotoBtn.getAttribute("data-pdp-handle");
        const idx = parseInt(pdpPhotoBtn.getAttribute("data-pdp-photo-idx"), 10) || 0;
        state.photoIndexByHandle.set(h, idx);
        openPdpModal(h);
        renderCatalog();
        return;
      }

      // 8. Add to Bag & Buy with Shop
      const addBtn = target.closest("[data-add-cart]");
      if (addBtn) {
        e.stopPropagation();
        if (addBtn.disabled) return;
        const h = addBtn.getAttribute("data-add-cart");
        addToCart(h, 1);
        if (addBtn.getAttribute("data-close-after-add") === "true") {
          document.getElementById("pdp-modal").hidden = true;
        }
        document.getElementById("cart-drawer-backdrop").hidden = false;
        return;
      }

      const shopBtn = target.closest("[data-buy-shop]");
      if (shopBtn) {
        e.stopPropagation();
        if (shopBtn.disabled) return;
        const h = shopBtn.getAttribute("data-buy-shop");
        const p = PRODUCT_BY_HANDLE.get(h);
        if (p) {
          const v = getSelectedVariant(p);
          if (v && v.available !== false) {
            window.location.href = `https://${CFG.domain}/cart/${v.id}:1?payment=shop_pay`;
          }
        }
        return;
      }

      // 9. Open PDP Modal
      const openPdpEl = target.closest("[data-open-pdp]");
      if (openPdpEl && !target.closest("button")) {
        const h = openPdpEl.getAttribute("data-open-pdp");
        document.getElementById("predictive-dropdown").hidden = true;
        openPdpModal(h);
        return;
      }
      if (openPdpEl && openPdpEl.classList.contains("predictive-item")) {
        const h = openPdpEl.getAttribute("data-open-pdp");
        document.getElementById("predictive-dropdown").hidden = true;
        openPdpModal(h);
        return;
      }

      // 10. Cart Drawer Controls
      if (target.closest("#open-cart-btn")) {
        document.getElementById("cart-drawer-backdrop").hidden = false;
        return;
      }
      if (target.id === "close-cart-btn" || target.id === "empty-cart-shop-btn" || target.id === "cart-drawer-backdrop") {
        document.getElementById("cart-drawer-backdrop").hidden = true;
        return;
      }

      const incBtn = target.closest("[data-cart-inc]");
      if (incBtn) {
        const idx = parseInt(incBtn.getAttribute("data-cart-inc"), 10);
        if (state.cart[idx]) {
          state.cart[idx].qty += 1;
          saveCart();
        }
        return;
      }

      const decBtn = target.closest("[data-cart-dec]");
      if (decBtn) {
        const idx = parseInt(decBtn.getAttribute("data-cart-dec"), 10);
        if (state.cart[idx]) {
          state.cart[idx].qty -= 1;
          if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
          saveCart();
        }
        return;
      }

      const rmBtn = target.closest("[data-cart-rm]");
      if (rmBtn) {
        const idx = parseInt(rmBtn.getAttribute("data-cart-rm"), 10);
        state.cart.splice(idx, 1);
        saveCart();
        return;
      }

      if (target.id === "cart-shop-pay-btn") {
        proceedToShopifyCheckout(true);
        return;
      }
      if (target.id === "cart-checkout-btn") {
        proceedToShopifyCheckout(false);
        return;
      }

      // 11. Close Modals
      if (target.id === "close-pdp-btn" || target.id === "pdp-modal") {
        document.getElementById("pdp-modal").hidden = true;
        state.openPdpHandle = null;
        return;
      }
      if (target.closest("#open-login-btn") || target.id === "footer-login-trigger") {
        e.preventDefault();
        document.getElementById("login-modal").hidden = false;
        return;
      }
      if (target.id === "close-login-btn" || target.id === "login-modal") {
        document.getElementById("login-modal").hidden = true;
        return;
      }

      // 12. Pagination
      if (target.id === "load-more-btn") {
        state.visibleCount += state.pageSize;
        renderCatalog();
        return;
      }
      if (target.id === "load-all-btn") {
        state.visibleCount = PRODUCTS.length;
        renderCatalog();
        return;
      }

      // 13. Mobile Bottom Dock
      const mobBtn = target.closest("[data-mobile-nav]");
      if (mobBtn) {
        const dest = mobBtn.getAttribute("data-mobile-nav");
        if (dest === "shop") switchView("shop");
        if (dest === "story") switchView("about");
        if (dest === "contact") switchView("contact");
        if (dest === "login") document.getElementById("login-modal").hidden = false;
        if (dest === "cart") document.getElementById("cart-drawer-backdrop").hidden = false;
        return;
      }

      // Click outside predictive search closes dropdown
      if (!target.closest(".header-search")) {
        const dd = document.getElementById("predictive-dropdown");
        if (dd) dd.hidden = true;
      }
    });

    // Search Input
    const searchInput = document.getElementById("search-input");
    const clearBtn = document.getElementById("search-clear-btn");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const val = searchInput.value;
        state.searchQuery = val;
        state.visibleCount = state.pageSize;
        if (clearBtn) clearBtn.hidden = !val;
        renderPredictiveDropdown(val);
        renderCatalog();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        state.searchQuery = "";
        clearBtn.hidden = true;
        document.getElementById("predictive-dropdown").hidden = true;
        renderCatalog();
      });
    }

    // Sort Select
    const sortSelect = document.getElementById("sort-select");
    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        state.sortBy = sortSelect.value;
        renderCatalog();
      });
    }

    // Customer Login: Redirect with login_hint so Shopify pre-fills the email in the user's own browser session
    const loginForm = document.getElementById("customer-login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("customer-login-email");
        const email = emailInput ? emailInput.value.trim() : "";
        if (!email) return;
        window.location.href = `https://${CFG.domain}/customer_authentication/login?return_to=%2F&login_hint=${encodeURIComponent(email)}`;
      });
    }

    // Contact Form Submission
    const contactForm = document.getElementById("shopify-contact-form");
    if (contactForm) {
      contactForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const statusEl = document.getElementById("contact-form-status");
        const formData = new FormData(contactForm);
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.style.color = "var(--blue-bright)";
          statusEl.textContent = "Sending...";
        }
        try {
          await fetch(`https://${CFG.domain}/contact`, {
            method: "POST",
            mode: "no-cors",
            body: formData
          });
        } catch (err) {}
        if (statusEl) {
          statusEl.style.color = "var(--green)";
          statusEl.textContent = "✓ Message sent.";
        }
        contactForm.reset();
      });
    }

    // Footer Mailing List Signup
    const newsletterForm = document.getElementById("footer-newsletter-form");
    if (newsletterForm) {
      newsletterForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const statusEl = document.getElementById("newsletter-status");
        const formData = new FormData(newsletterForm);
        try {
          await fetch(`https://${CFG.domain}/contact#contact_form`, {
            method: "POST",
            mode: "no-cors",
            body: formData
          });
        } catch (err) {}
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.style.color = "var(--green)";
          statusEl.textContent = "✓ Subscribed!";
        }
        newsletterForm.reset();
      });
    }

    // Re-sync when tab becomes visible
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && CFG.autoSyncOnLoad !== false) {
        syncWithShopifyStorefront();
      }
    });
  }

  // ========================================================================
  // 11. Initialize Storefront + Start Live Shopify Sync
  // ========================================================================
  function init() {
    renderFiltersAndTabs();
    renderCatalog();
    renderReviewsWall();
    renderPolicyContent("shipping");
    updateCartBadgesAndDrawer();
    bindEvents();

    if (CFG.autoSyncOnLoad !== false) {
      syncWithShopifyStorefront();
      if (CFG.pollIntervalMs && CFG.pollIntervalMs >= 15000) {
        setInterval(syncWithShopifyStorefront, CFG.pollIntervalMs);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
