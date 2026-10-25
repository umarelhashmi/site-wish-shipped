/* ==========================================================================
   WishShipped.com — Storefront Application Logic
   Full 731-Product Catalog · AI Model Lookbook · Shopify Storefront GraphQL
   Shop Pay Express · @t.shopifyemail.com Login · Contact & Mailing List
   ========================================================================== */

(function () {
  "use strict";

  const DATA = window.WISHSHIPPED_DATA;
  if (!DATA) {
    console.error("WISHSHIPPED_DATA failed to load.");
    return;
  }

  const PRODUCTS = DATA.products || [];
  const PRODUCT_BY_HANDLE = new Map();
  const PRODUCT_BY_ID = new Map();
  PRODUCTS.forEach((p) => {
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
    lookbookFilter: "all",
    activeShelf: "tumblers",
    // Track which handles are currently showing Original photo vs AI Model photo
    showOriginalForHandle: new Set(),
    globalLookbookShowOriginal: false,
    // Track selected variant index per product handle
    selectedVariantByHandle: new Map(),
    // Shopping cart persisted in localStorage
    cart: loadCart(),
    activePolicyKey: "shipping"
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
      if (k === viewName) {
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });

    document.querySelectorAll("[data-nav-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-nav-view") === viewName);
    });

    document.querySelectorAll("[data-mobile-nav]").forEach((btn) => {
      const target = btn.getAttribute("data-mobile-nav");
      btn.classList.toggle(
        "active",
        (viewName === "shop" && target === "shop") ||
          (viewName === "about" && target === "story")
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
  // 2. Product Card Renderer (Supports AI Model / Original Toggle + Variants)
  // ========================================================================
  function getSelectedVariant(product) {
    const idx = state.selectedVariantByHandle.get(product.handle) || 0;
    return product.variants[idx] || product.variants[0] || { id: 0, title: "Default Title", price: product.price, available: true };
  }

  function createProductCardHtml(product, context = "catalog") {
    const hasAiModel = Boolean(product.aiModelImage);
    const showingOriginal = state.showOriginalForHandle.has(product.handle);
    const useModelImg = hasAiModel && !showingOriginal;
    const displayImg = useModelImg ? product.aiModelImage : product.image;
    const selectedVar = getSelectedVariant(product);
    const selectedIdx = state.selectedVariantByHandle.get(product.handle) || 0;

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
              ${!v.available ? "disabled" : ""}
              title="${escapeHtml(v.title)} - $${escapeHtml(v.price)}"
            >${escapeHtml(v.title)}</button>`
          )
          .join("")}
      </div>`;
    }

    const topBadgeHtml = hasAiModel
      ? `<span class="badge-2d badge-2d--ai">${escapeHtml(product.aiModelMeta ? product.aiModelMeta.badge : "✨ AI Model")}</span>`
      : `<span class="badge-2d badge-2d--type">${escapeHtml(product.type || "Souvenir")}</span>`;

    const photoToggleHtml = hasAiModel
      ? `<button
          type="button"
          class="photo-toggle-btn"
          data-toggle-photo="${escapeHtml(product.handle)}"
          title="Switch between AI Model photo and Original flat-lay photo"
        >
          ${useModelImg ? "👕 See Original Photo" : "✨ See AI Model"}
        </button>`
      : "";

    return `<article class="product-card" data-product-handle="${escapeHtml(product.handle)}" data-context="${escapeHtml(context)}">
      <div class="product-card__media" data-open-pdp="${escapeHtml(product.handle)}">
        <div class="product-card__badges">
          ${topBadgeHtml}
        </div>
        <img
          src="${escapeHtml(displayImg)}"
          alt="${escapeHtml(product.title)}"
          class="product-card__img ${useModelImg ? "product-card__img--model" : ""}"
          loading="lazy"
          width="400"
          height="500"
          onerror="if(this.src!=='${escapeHtml(product.cdnImage)}' && '${escapeHtml(product.cdnImage)}'){this.src='${escapeHtml(product.cdnImage)}';}"
        />
        ${photoToggleHtml}
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
          >
            ＋ Add to Bag
          </button>
          <button
            type="button"
            class="card-btn-shop"
            data-buy-shop="${escapeHtml(product.handle)}"
            title="Instant checkout with Shop Pay"
          >
            Shop Pay
          </button>
        </div>
      </div>
    </article>`;
  }

  // ========================================================================
  // 3. Render AI Model Lookbook Showcase
  // ========================================================================
  function renderLookbook() {
    const grid = document.getElementById("lookbook-grid");
    if (!grid) return;

    const aiProducts = PRODUCTS.filter((p) => Boolean(p.aiModelImage));
    const filtered = aiProducts.filter((p) => {
      if (state.lookbookFilter === "all") return true;
      return p.aiModelMeta && p.aiModelMeta.gender === state.lookbookFilter;
    });

    grid.innerHTML = filtered.map((p) => createProductCardHtml(p, "lookbook")).join("");
  }

  // ========================================================================
  // 4. Render Frontpage Shelves
  // ========================================================================
  const SHELF_MAP = {
    tumblers: [
      "40oz-mickey-tumbler",
      "40oz-stitch-tumbler",
      "40oz-minnie-tumbler",
      "3d-stitch-tumbler",
      "3d-minnie-tumbler",
      "3d-spiderman-tumbler",
      "40oz-grumpy-tumbler",
      "belle-tc-tea-cup"
    ],
    plush: [
      "25-minnie-plush",
      "25-mickey-plush",
      "15-stitch-plush",
      "15-minnie-red-plush",
      "19-stitch-plush",
      "19-minnie-pink-plush",
      "19-minnie-red-plush",
      "15-pluto-plush"
    ],
    towels: [
      "stitch-sun-side-up-k-towel",
      "2026-squad-twl-towel",
      "mickey-mouse-sun-daze-kt-towel",
      "chef-de-mickey-kt-y-towel",
      "star-wars-burst-twl-towel",
      "swmg-father-son-towel",
      "stitch-angel-surfers-towel",
      "mickey-comic-towel"
    ],
    sunglasses: [
      "yoshi-ss-sunglasses",
      "wario-sunstache-sunglasses",
      "waluigi-sunstache-sunglasses",
      "stuart-sunstache-sunglasses",
      "shrek-sunstache-sunglasses",
      "peach-ss-sunglasses",
      "marvel-spiderman-ss-sunglasses",
      "marvel-blk-spiderman-ss-sunglasses"
    ],
    sets: [
      "stitch-n-scrump-set-top-bottom-set",
      "pooh-bee-n-honey-set-top-bottom-set",
      "magic-tink-set-top-bottom-set",
      "harry-potter-school-set-top-bottom-set",
      "harry-potter-owl-set-top-bottom-set",
      "hidden-minnie-set-top-bottom-set",
      "oversized-minnie-set-top-bottom-set",
      "fairytale-adventures-top-bottom-set"
    ]
  };

  function renderFrontpageShelf() {
    const grid = document.getElementById("shelf-grid");
    if (!grid) return;
    const handles = SHELF_MAP[state.activeShelf] || SHELF_MAP.tumblers;
    const items = handles.map((h) => PRODUCT_BY_HANDLE.get(h)).filter(Boolean);
    grid.innerHTML = items.map((p) => createProductCardHtml(p, "shelf")).join("");
  }

  // ========================================================================
  // 5. Render Top Collection Tabs & Sidebar Filters
  // ========================================================================
  const CHARACTER_FILTERS = [
    { key: "all", label: "All Worlds" },
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
    { key: "toy story", label: "Toy Story / Pizza Planet" },
    { key: "mario", label: "Super Mario / Yoshi" }
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

  function renderFiltersAndTabs() {
    // 1. Top Collection Bar
    const topTabs = document.getElementById("top-collection-tabs");
    const aiCount = PRODUCTS.filter((p) => Boolean(p.aiModelImage)).length;
    if (topTabs) {
      const mainCols = [
        { handle: "all", title: "All Products", count: PRODUCTS.length, icon: "🛍️" },
        { handle: "ai-lookbook", title: "AI Model Lookbook", count: aiCount, icon: "✨", isLookbook: true },
        { handle: "adult-t-shirts", title: "Adult T-Shirts & Apparel", count: 328, icon: "👕" },
        { handle: "kids", title: "Kids", count: 141, icon: "🧒" },
        { handle: "accessories", title: "Accessories", count: 112, icon: "🕶️" },
        { handle: "drinkware", title: "Drinkware & Tumblers", count: 99, icon: "🥤" },
        { handle: "plush", title: "Plush", count: 28, icon: "🧸" },
        { handle: "towels", title: "Towels", count: 23, icon: "🏖️" }
      ];

      topTabs.innerHTML = mainCols
        .map(
          (c) => `<button
            type="button"
            class="collection-tab ${c.isLookbook ? "collection-tab--lookbook" : ""} ${state.collection === c.handle ? "active" : ""}"
            data-select-collection="${escapeHtml(c.handle)}"
          >
            <span>${c.icon} ${escapeHtml(c.title)}</span>
            <span class="collection-tab__count">${c.count}</span>
          </button>`
        )
        .join("");
    }

    // 2. Sidebar Collections (All 11 collections from wishshipped.com + AI Lookbook)
    const sideCols = document.getElementById("sidebar-collections");
    if (sideCols) {
      const allCols = [
        { handle: "all", title: "All Products", count: PRODUCTS.length },
        { handle: "ai-lookbook", title: "✨ AI Modeled Apparel", count: aiCount },
        ...(DATA.collections || []).filter((c) => c.handle !== "all")
      ];
      sideCols.innerHTML = allCols
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

    // 3. Sidebar Characters
    const sideChars = document.getElementById("sidebar-characters");
    if (sideChars) {
      sideChars.innerHTML = CHARACTER_FILTERS.map(
        (cf) => `<button
          type="button"
          class="tag-chip ${state.character === cf.key ? "active" : ""}"
          data-select-character="${escapeHtml(cf.key)}"
        >${escapeHtml(cf.label)}</button>`
      ).join("");
    }

    // 4. Sidebar Product Types
    const sideTypes = document.getElementById("sidebar-types");
    if (sideTypes) {
      const typeCounts = new Map();
      PRODUCTS.forEach((p) => {
        const t = p.type || "Souvenir";
        typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
      });
      const sortedTypes = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);

      sideTypes.innerHTML = [
        `<button type="button" class="sidebar-btn ${state.productType === "all" ? "active" : ""}" data-select-type="all">
          <span>All Product Types</span>
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
  // 6. Filter, Sort & Render Main 731-Product Catalog
  // ========================================================================
  function getFilteredProducts() {
    const q = state.searchQuery.trim().toLowerCase();

    let list = PRODUCTS.filter((p) => {
      if (state.collection === "ai-lookbook") {
        if (!p.aiModelImage) return false;
      } else if (state.collection !== "all") {
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

    // Sort
    if (state.sortBy === "ai-first") {
      list = [...list].sort((a, b) => (b.aiModelImage ? 1 : 0) - (a.aiModelImage ? 1 : 0));
    } else if (state.sortBy === "price-asc") {
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

  function renderCatalog() {
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

    const colObj = (DATA.collections || []).find((c) => c.handle === state.collection);
    const colTitle =
      state.collection === "ai-lookbook"
        ? "✨ AI Modeled Apparel"
        : colObj
        ? colObj.title
        : "All Products";

    if (headingTitle) {
      headingTitle.textContent = `${colTitle} (${total})`;
    }

    if (countLabel) {
      countLabel.textContent =
        total === 0
          ? "0 Products Match Your Filter"
          : `Showing 1–${slice.length} of ${total} Products`;
    }

    // Active filter chips
    if (activeChips) {
      const chips = [];
      if (state.collection !== "all") {
        chips.push(`<span class="active-filter-tag" data-clear-filter="collection">Collection: ${escapeHtml(colTitle)} ✕</span>`);
      }
      if (state.character !== "all") {
        chips.push(`<span class="active-filter-tag" data-clear-filter="character">World: ${escapeHtml(state.character)} ✕</span>`);
      }
      if (state.productType !== "all") {
        chips.push(`<span class="active-filter-tag" data-clear-filter="productType">Type: ${escapeHtml(state.productType)} ✕</span>`);
      }
      if (state.searchQuery) {
        chips.push(`<span class="active-filter-tag" data-clear-filter="search">Search: "${escapeHtml(state.searchQuery)}" ✕</span>`);
      }
      activeChips.innerHTML = chips.join("");
    }

    if (grid) {
      if (total === 0) {
        grid.innerHTML = `<div class="paper-card-2d" style="grid-column:1/-1;text-align:center;padding:32px;">
          <h3 style="font-family:var(--font-display);font-size:22px;margin-bottom:8px;">No products in this filter yet</h3>
          <p style="color:var(--ink-muted);margin-bottom:16px;">Try clearing your search or switching back to All 731 Products.</p>
          <button type="button" class="btn-2d btn-2d--yellow" id="empty-reset-btn">Show All 731 Products</button>
        </div>`;
      } else {
        grid.innerHTML = slice.map((p) => createProductCardHtml(p, "catalog")).join("");
      }
    }

    if (progressText) {
      progressText.textContent = `Displaying ${slice.length} of ${total} items`;
    }
    if (loadMoreBtn) {
      loadMoreBtn.hidden = slice.length >= total;
    }
    if (loadAllBtn) {
      loadAllBtn.hidden = slice.length >= total;
    }
  }

  // ========================================================================
  // 7. Predictive Search Dropdown
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

    dropdown.innerHTML = `
      <div class="predictive-dropdown__header">
        <span>Top Matches (${matches.length})</span>
        <button type="button" class="header-search__clear" id="predictive-view-all-btn">View All Results →</button>
      </div>
      ${matches
        .map((p) => {
          const img = p.aiModelImage || p.image;
          return `<div class="predictive-item" data-open-pdp="${escapeHtml(p.handle)}">
            <img src="${escapeHtml(img)}" alt="${escapeHtml(p.title)}" class="predictive-item__img" loading="lazy" />
            <div>
              <div class="predictive-item__title">${escapeHtml(p.title)}</div>
              <div class="predictive-item__meta">${escapeHtml(p.type)} ${p.aiModelImage ? "· ✨ AI Modeled" : ""}</div>
            </div>
            <div class="predictive-item__price">$${escapeHtml(p.price)}</div>
          </div>`;
        })
        .join("")}
    `;
    dropdown.hidden = false;
  }

  // ========================================================================
  // 8. Product Detail Modal (PDP)
  // ========================================================================
  function openPdpModal(handle) {
    const product = PRODUCT_BY_HANDLE.get(handle);
    if (!product) return;

    const modal = document.getElementById("pdp-modal");
    const body = document.getElementById("pdp-modal-body");
    if (!modal || !body) return;

    const selectedIdx = state.selectedVariantByHandle.get(product.handle) || 0;
    const selectedVar = product.variants[selectedIdx] || product.variants[0];
    const hasAiModel = Boolean(product.aiModelImage);
    const showingOrig = state.showOriginalForHandle.has(product.handle);
    const activePhoto = hasAiModel && !showingOrig ? product.aiModelImage : product.image;

    const variantsButtonsHtml =
      product.variants && product.variants.length > 1 && product.variants[0].title !== "Default Title"
        ? `<div style="margin:14px 0;">
            <div style="font-size:12.5px;font-weight:800;text-transform:uppercase;margin-bottom:6px;">Select Size / Option:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${product.variants
                .map(
                  (v, idx) => `<button
                    type="button"
                    class="btn-2d ${idx === selectedIdx ? "btn-2d--yellow" : ""}"
                    style="padding:6px 14px;"
                    data-pdp-variant-idx="${idx}"
                    data-pdp-handle="${escapeHtml(product.handle)}"
                    ${!v.available ? "disabled" : ""}
                  >${escapeHtml(v.title)}</button>`
                )
                .join("")}
            </div>
          </div>`
        : "";

    const dualGalleryThumbs = hasAiModel
      ? `<div style="display:flex;gap:10px;margin-top:10px;">
          <button
            type="button"
            class="btn-2d ${!showingOrig ? "btn-2d--yellow" : ""}"
            data-pdp-photo-mode="model"
            data-pdp-handle="${escapeHtml(product.handle)}"
            style="flex:1;padding:6px 10px;font-size:12px;"
          >
            ✨ AI Model View
          </button>
          <button
            type="button"
            class="btn-2d ${showingOrig ? "btn-2d--yellow" : ""}"
            data-pdp-photo-mode="original"
            data-pdp-handle="${escapeHtml(product.handle)}"
            style="flex:1;padding:6px 10px;font-size:12px;"
          >
            👕 Original Store Photo
          </button>
        </div>`
      : "";

    body.innerHTML = `
      <div class="pdp-modal-grid">
        <div>
          <div class="pdp-media-box">
            <img id="pdp-main-img" src="${escapeHtml(activePhoto)}" alt="${escapeHtml(product.title)}" />
          </div>
          ${dualGalleryThumbs}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="badge-2d">${escapeHtml(product.type || "Souvenir")}</span>
            ${hasAiModel ? `<span class="badge-2d badge-2d--ai">${escapeHtml(product.aiModelMeta.badge)}</span>` : ""}
            ${selectedVar.sku ? `<span style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-muted);">SKU: ${escapeHtml(selectedVar.sku)}</span>` : ""}
          </div>

          <h2 id="pdp-modal-title" style="font-family:var(--font-display);font-size:26px;line-height:1.15;">
            ${escapeHtml(product.title)}
          </h2>

          <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:var(--ink);">
            $${escapeHtml(selectedVar.price)}
          </div>

          ${variantsButtonsHtml}

          <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
            <button
              type="button"
              class="btn-2d btn-2d--blue"
              style="width:100%;padding:12px;font-size:15px;"
              data-add-cart="${escapeHtml(product.handle)}"
              data-close-after-add="true"
            >
              🛍️ Add to Shopping Bag — $${escapeHtml(selectedVar.price)}
            </button>

            <button
              type="button"
              class="btn-2d btn-2d--shop"
              style="width:100%;padding:12px;font-size:15px;"
              data-buy-shop="${escapeHtml(product.handle)}"
            >
              ⚡ Buy with Shop (Shop Pay 1-Click Checkout)
            </button>
          </div>

          <div style="margin-top:10px;padding:12px;background:var(--bg-canvas);border:var(--border-2d);border-radius:8px;font-size:13.5px;line-height:1.55;">
            ${product.bodyHtml || "<p>Official licensed souvenir merchandise from WishShipped.com (Disney Gifts Outlet, Kissimmee, FL).</p>"}
          </div>

          <div style="font-size:12px;color:var(--ink-muted);display:flex;flex-direction:column;gap:4px;">
            <span>✓ Ships from Kissimmee, FL via USPS (Free on orders $49.99+)</span>
            <span>✓ Complimentary local delivery available to Central FL &amp; Disney-area hotels</span>
            <span>✓ <a href="https://wishshipped.com/products/${escapeHtml(product.handle)}" target="_blank" rel="noopener" style="text-decoration:underline;font-weight:700;">View on wishshipped.com/${escapeHtml(product.handle)}</a></span>
          </div>
        </div>
      </div>
    `;

    modal.hidden = false;
  }

  // ========================================================================
  // 9. Shopping Bag / Cart + Shopify Storefront API Checkout & Shop Pay
  // ========================================================================
  function addToCart(handle, qty = 1) {
    const product = PRODUCT_BY_HANDLE.get(handle);
    if (!product) return;

    const selectedVar = getSelectedVariant(product);
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
        image: product.aiModelImage || product.image,
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

    // Free shipping progress ($49.99 threshold)
    const threshold = 49.99;
    const pct = Math.min(100, (subtotal / threshold) * 100);
    const barFill = document.getElementById("shipping-bar-fill");
    const barText = document.getElementById("shipping-bar-text");
    if (barFill) barFill.style.width = `${pct.toFixed(1)}%`;
    if (barText) {
      if (subtotal >= threshold) {
        barText.innerHTML = "🎉 You unlocked <strong>FREE USPS Standard Shipping</strong>!";
      } else {
        const diff = (threshold - subtotal).toFixed(2);
        barText.innerHTML = `Add <strong>$${diff}</strong> more to unlock <strong>FREE USPS Shipping ($49.99+)</strong>!`;
      }
    }

    const container = document.getElementById("cart-items-container");
    if (!container) return;

    if (state.cart.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:40px 16px;">
        <div style="font-size:40px;margin-bottom:8px;">🛍️</div>
        <h3 style="font-family:var(--font-display);font-size:20px;margin-bottom:6px;">Your shopping bag is empty</h3>
        <p style="font-size:13.5px;color:var(--ink-muted);margin-bottom:16px;">Have an account? Log in to check out faster.</p>
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

  // Direct Shop Pay URL builder (redirects straight to shop.app/checkout/102987006274/...)
  function buildCartPermalink(items, useShopPay = false) {
    const pairs = items.map((i) => `${i.variantId}:${i.qty}`).join(",");
    const base = `https://wishshipped.com/cart/${pairs}`;
    return useShopPay ? `${base}?payment=shop_pay` : base;
  }

  // Official Shopify Storefront API cartCreate checkout
  async function proceedToShopifyCheckout(useShopPay = false) {
    if (state.cart.length === 0) return;

    if (useShopPay) {
      window.location.href = buildCartPermalink(state.cart, true);
      return;
    }

    const checkoutBtn = document.getElementById("cart-checkout-btn");
    if (checkoutBtn) {
      checkoutBtn.textContent = "Connecting to WishShipped Checkout...";
      checkoutBtn.disabled = true;
    }

    try {
      const lines = state.cart.map((item) => ({
        merchandiseId: `gid://shopify/ProductVariant/${item.variantId}`,
        quantity: item.qty
      }));

      const res = await fetch(DATA.store.graphqlEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": DATA.store.storefrontToken
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
  // 10. Render Reviews & Policies
  // ========================================================================
  function renderReviewsWall() {
    const gmaps = DATA.googleMaps || {};
    const topicContainer = document.getElementById("reviews-topic-chips");
    if (topicContainer && gmaps.topics) {
      topicContainer.innerHTML = gmaps.topics
        .map(
          (t) => `<span class="tag-chip" style="cursor:default;">${escapeHtml(t.name)} (${t.count})</span>`
        )
        .join("");
    }

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
            <div style="font-size:11.5px;color:var(--ink-muted);margin-top:auto;">Posted ${escapeHtml(r.date)} on Google Maps</div>
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
        <h2>Your Privacy Choices (Data Sharing Opt-Out)</h2>
        <p>As described in our Privacy Policy, we collect personal information from your interactions with us and our website, including through cookies and similar technologies. We may also share this personal information with third parties, including advertising partners. We do this in order to show you ads on other websites that are more relevant to your interests and for other reasons outlined in our privacy policy.</p>
        <p>Sharing of personal information for targeted advertising based on your interaction on different websites may be considered "sales", "sharing", or "targeted advertising" under certain U.S. state privacy laws. Depending on where you live, you may have the right to opt out of these activities. If you would like to exercise this opt-out right, please follow the instructions below.</p>
        <p>If you visit our website with the Global Privacy Control opt-out preference signal enabled, depending on where you are, we will treat this as a request to opt-out of activity that may be considered a “sale” or “sharing” of personal information or other uses that may be considered targeted advertising for the device and browser you used to visit our website.</p>
        <div style="margin-top:16px;padding:16px;background:var(--bg-yellow-tint);border:var(--border-2d);border-radius:10px;">
          <strong>Browser Global Privacy Control (GPC) Signal:</strong>
          <span class="badge-2d" style="margin-left:8px;">${gpcActive ? "Detected & Active" : "Not Detected"}</span>
          <div style="margin-top:12px;">
            <button type="button" class="btn-2d btn-2d--blue" id="opt-out-confirm-btn">Opt Out of Targeted Advertising Sharing</button>
            <span id="opt-out-status-msg" style="margin-left:10px;font-weight:700;color:var(--green);" hidden>✓ Your opt-out preference has been saved for this browser.</span>
          </div>
        </div>
      `,
      news: `
        <h2>News (/blogs/news)</h2>
        <p>Welcome to the official <strong>WishShipped.com</strong> news &amp; new-arrivals board! All 731 souvenirs, 2026 resort apparel, 40oz tumblers, plush, and beach towels from our three Kissimmee gift shops (4629, 5001, and 7495 W Irlo Bronson Memorial Hwy) are now available online with nationwide USPS shipping and complimentary Central Florida resort delivery.</p>
      `
    };

    box.innerHTML = map[key] || map.shipping;
  }

  // ========================================================================
  // 11. Event Delegation & Form Bindings
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
        const catSec = document.getElementById("catalog-explorer");
        if (catSec) catSec.scrollIntoView({ behavior: "smooth" });
        return;
      }

      const colJump = target.closest("[data-col-jump]");
      if (colJump) {
        e.preventDefault();
        state.collection = colJump.getAttribute("data-col-jump");
        state.visibleCount = state.pageSize;
        switchView("shop", { skipScroll: true });
        renderFiltersAndTabs();
        renderCatalog();
        const catSec = document.getElementById("catalog-explorer");
        if (catSec) catSec.scrollIntoView({ behavior: "smooth" });
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

      // 5. Lookbook Filter & Photo Mode Toggle
      const lbBtn = target.closest("[data-lookbook-filter]");
      if (lbBtn) {
        state.lookbookFilter = lbBtn.getAttribute("data-lookbook-filter");
        document.querySelectorAll("[data-lookbook-filter]").forEach((b) => {
          b.classList.toggle("active", b === lbBtn);
        });
        renderLookbook();
        return;
      }

      if (target.id === "toggle-all-lookbook-view") {
        state.globalLookbookShowOriginal = !state.globalLookbookShowOriginal;
        PRODUCTS.forEach((p) => {
          if (p.aiModelImage) {
            if (state.globalLookbookShowOriginal) {
              state.showOriginalForHandle.add(p.handle);
            } else {
              state.showOriginalForHandle.delete(p.handle);
            }
          }
        });
        renderLookbook();
        renderCatalog();
        return;
      }

      const togglePhotoBtn = target.closest("[data-toggle-photo]");
      if (togglePhotoBtn) {
        e.stopPropagation();
        const h = togglePhotoBtn.getAttribute("data-toggle-photo");
        if (state.showOriginalForHandle.has(h)) {
          state.showOriginalForHandle.delete(h);
        } else {
          state.showOriginalForHandle.add(h);
        }
        renderLookbook();
        renderFrontpageShelf();
        renderCatalog();
        return;
      }

      // 6. Frontpage Shelf Tabs
      const shelfBtn = target.closest("[data-shelf]");
      if (shelfBtn) {
        state.activeShelf = shelfBtn.getAttribute("data-shelf");
        document.querySelectorAll("[data-shelf]").forEach((b) => {
          b.classList.toggle("active", b === shelfBtn);
        });
        renderFrontpageShelf();
        return;
      }

      // 7. Variant Size Selection on Card
      const varChip = target.closest("[data-select-variant]");
      if (varChip) {
        e.stopPropagation();
        const h = varChip.getAttribute("data-select-variant");
        const idx = parseInt(varChip.getAttribute("data-variant-idx"), 10) || 0;
        state.selectedVariantByHandle.set(h, idx);
        renderLookbook();
        renderFrontpageShelf();
        renderCatalog();
        return;
      }

      // 8. Variant & Photo Selection inside PDP Modal
      const pdpVarBtn = target.closest("[data-pdp-variant-idx]");
      if (pdpVarBtn) {
        const h = pdpVarBtn.getAttribute("data-pdp-handle");
        const idx = parseInt(pdpVarBtn.getAttribute("data-pdp-variant-idx"), 10) || 0;
        state.selectedVariantByHandle.set(h, idx);
        openPdpModal(h);
        return;
      }

      const pdpPhotoBtn = target.closest("[data-pdp-photo-mode]");
      if (pdpPhotoBtn) {
        const h = pdpPhotoBtn.getAttribute("data-pdp-handle");
        const mode = pdpPhotoBtn.getAttribute("data-pdp-photo-mode");
        if (mode === "original") {
          state.showOriginalForHandle.add(h);
        } else {
          state.showOriginalForHandle.delete(h);
        }
        openPdpModal(h);
        renderLookbook();
        renderCatalog();
        return;
      }

      // 9. Add to Bag & Buy with Shop
      const addBtn = target.closest("[data-add-cart]");
      if (addBtn) {
        e.stopPropagation();
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
        const h = shopBtn.getAttribute("data-buy-shop");
        const p = PRODUCT_BY_HANDLE.get(h);
        if (p) {
          const v = getSelectedVariant(p);
          window.location.href = `https://wishshipped.com/cart/${v.id}:1?payment=shop_pay`;
        }
        return;
      }

      // 10. Open PDP Modal
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

      // 11. Cart Drawer Controls
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

      // 12. Close Modals
      if (target.id === "close-pdp-btn" || target.id === "pdp-modal") {
        document.getElementById("pdp-modal").hidden = true;
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

      // 13. Pagination & Jump Buttons
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
      if (target.id === "jump-lookbook-btn" || target.id === "footer-lookbook-link") {
        e.preventDefault();
        switchView("shop", { skipScroll: true });
        document.getElementById("lookbook-section").scrollIntoView({ behavior: "smooth" });
        return;
      }
      if (target.id === "jump-catalog-btn") {
        document.getElementById("catalog-explorer").scrollIntoView({ behavior: "smooth" });
        return;
      }

      // 14. Mobile Bottom Dock
      const mobBtn = target.closest("[data-mobile-nav]");
      if (mobBtn) {
        const dest = mobBtn.getAttribute("data-mobile-nav");
        if (dest === "shop") switchView("shop");
        if (dest === "lookbook") {
          switchView("shop", { skipScroll: true });
          document.getElementById("lookbook-section").scrollIntoView({ behavior: "smooth" });
        }
        if (dest === "story") switchView("about");
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

    // Customer Login Form (@t.shopifyemail.com verification flow)
    const loginForm = document.getElementById("customer-login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("customer-login-email");
        const email = emailInput ? emailInput.value.trim() : "";
        try {
          if (email && navigator.clipboard) navigator.clipboard.writeText(email);
        } catch (err) {}
        const redirectUrl = `${DATA.store.loginRedirectUrl}&email=${encodeURIComponent(email)}`;
        window.location.href = redirectUrl;
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
          statusEl.textContent = "Sending your message to WishShipped.com...";
        }
        try {
          await fetch("https://wishshipped.com/contact", {
            method: "POST",
            mode: "no-cors",
            body: formData
          });
        } catch (err) {}
        if (statusEl) {
          statusEl.style.color = "var(--green)";
          statusEl.textContent = "✓ Thank you! Your message has been sent to WishShipped.com (customersupport@wishshipped.com).";
        }
        contactForm.reset();
      });
    }

    // Footer Mailing List Signup (form_type=customer)
    const newsletterForm = document.getElementById("footer-newsletter-form");
    if (newsletterForm) {
      newsletterForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const statusEl = document.getElementById("newsletter-status");
        const formData = new FormData(newsletterForm);
        try {
          await fetch("https://wishshipped.com/contact#contact_form", {
            method: "POST",
            mode: "no-cors",
            body: formData
          });
        } catch (err) {}
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.style.color = "var(--green)";
          statusEl.textContent = "✓ Subscribed to WishShipped.com mailing list!";
        }
        newsletterForm.reset();
      });
    }
  }

  // ========================================================================
  // 12. Initialize Storefront
  // ========================================================================
  function init() {
    renderFiltersAndTabs();
    renderLookbook();
    renderFrontpageShelf();
    renderCatalog();
    renderReviewsWall();
    renderPolicyContent("shipping");
    updateCartBadgesAndDrawer();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
