// Loader is managed by the inline `manageLoader()` script in index.html

/* ------------------------------------------------------------
  Zomax Frontend — Developer Notes (brief)

  Overview:
  - `main.js` is organized into sections: State, Persistence, Backend Adapter,
    UI Renderers, Modal & UX helpers, and Actions. Keep functions grouped.
  - Backend developers should implement `/api` endpoints as documented in
    BACKEND_CONNECT.md. The `backend` adapter below provides local fallbacks
    so the frontend remains usable without a server.

  Conventions:
  - Functions that change app state should call `saveState()` after changes.
  - Use `backend.*` helpers to read/write shared resources (cart, orders, account, reviews).
  - Dates: orders store friendly date strings for display; analytics uses ISO dates.
------------------------------------------------------------ */

const categories = [
  { id: "fashion", name: "Fashion", icon: "shirt", color: "bg-pink-100 text-pink-600" },
  { id: "electronics", name: "Electronics", icon: "smartphone", color: "bg-blue-100 text-blue-600" },
  { id: "home", name: "Home & Living", icon: "lamp-ceiling", color: "bg-amber-100 text-amber-600" },
  { id: "beauty", name: "Beauty", icon: "sparkles", color: "bg-purple-100 text-purple-600" },
  { id: "food", name: "Food & Groceries", icon: "utensils", color: "bg-emerald-100 text-emerald-600" },
  { id: "sports", name: "Sports", icon: "dumbbell", color: "bg-cyan-100 text-cyan-600" },
  { id: "automotive", name: "Automotive", icon: "car-front", color: "bg-slate-200 text-slate-700" },
  { id: "kids", name: "Kids", icon: "baby", color: "bg-yellow-100 text-yellow-600" },
  { id: "services", name: "Services", icon: "handshake", color: "bg-indigo-100 text-indigo-600" },
  { id: "phones", name: "Phones & Tablets", icon: "tablet-smartphone", color: "bg-red-100 text-red-600" }
];

let products = [];

const defaultAccount = {
  name: "",
  username: "",
  email: "",
  phone: "",
  address: "",
  addresses: [],
  paymentMethod: "",
  paymentMethods: [],
  cardName: "",
  cardLast4: "",
  memberSince: ""
};

let cart = JSON.parse(localStorage.getItem("zomax_cart") || "[]");
let wishlist = JSON.parse(localStorage.getItem("zomax_wishlist") || "[]");
let orders = JSON.parse(localStorage.getItem("zomax_orders") || "[]");
let account = JSON.parse(localStorage.getItem("zomax_account") || JSON.stringify(defaultAccount));
let currentUser = JSON.parse(localStorage.getItem("zomax_currentUser") || "null");
let currentSearch = "";
let currentProductModalId = null;
let currentProductModalTab = "overview";
let currentProductModalImageIndex = 0;
let lastOrder = null;

// Reviews store (persisted in localStorage)
let reviewsStore = JSON.parse(localStorage.getItem('zomax_reviews') || '{}');

let editingReviewProductId = null;
let editingReviewIndex = null;

function getReviewsForProduct(id) {
  return (reviewsStore[id] || []).slice().sort((a,b) => b.createdAt - a.createdAt);
}

function saveReviewsStore() {
  localStorage.setItem('zomax_reviews', JSON.stringify(reviewsStore));
}

function addReview(productId, { author, rating, text }) {
  const id = String(productId);
  reviewsStore[id] = reviewsStore[id] || [];
  const review = { author: author || 'Anonymous', rating: Number(rating) || 5, text: text || '', createdAt: Date.now() };
  reviewsStore[id].push(review);
  // update product aggregate rating and reviews count for quick display
  const product = products.find(p => p.id === productId);
  if (product) {
    const all = getReviewsForProduct(productId);
    const avg = all.reduce((s,r) => s + r.rating, 0) / (all.length || 1);
    product.rating = Number(avg.toFixed(1));
    product.reviews = all.length;
  }
  saveReviewsStore();
  saveState();
  backend.saveReview(productId, review).catch(err => {
    console.warn('Failed to save review to backend', err);
    // fallback: attempt to sync entire store later
    backend.syncReviews(reviewsStore).catch(() => {});
  });
}

const money = value => "₦" + Number(value).toLocaleString("en-NG");

function readLocalAuthUsers() {
  try {
    const users = JSON.parse(localStorage.getItem('zomax_authUsers') || '[]');
    return Array.isArray(users) ? users : [];
  } catch (error) {
    return [];
  }
}

function randomHex(byteCount) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteCount)), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashLocalPassword(password, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 210000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
}

function localPublicUser(user) {
  return { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role, memberSince: user.memberSince };
}

function usesLocalAuthPreview() {
  return window.location.protocol === 'file:' || location.port === '5500';
}

function startLocalAuthSession(user) {
  const token = `local-${randomHex(32)}`;
  const safeUser = localPublicUser(user);
  localStorage.setItem('zomax_authToken', token);
  localStorage.setItem('zomax_localSession', JSON.stringify({ token, userId: user.id }));
  localStorage.setItem('zomax_currentUser', JSON.stringify(safeUser));
  return safeUser;
}

async function localRegister({ name, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  if (name.trim().length < 2 || name.trim().length > 100) throw new Error('Enter your name (2 to 100 characters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.');
  if (password.length < 8 || password.length > 128) throw new Error('Use a password between 8 and 128 characters.');
  const users = readLocalAuthUsers();
  if (users.some(user => user.email === normalizedEmail)) throw new Error('An account already exists for this email. Sign in instead.');
  const salt = randomHex(16);
  const user = {
    id: `local-${randomHex(16)}`,
    username: normalizedEmail.split('@')[0],
    name: name.trim(),
    email: normalizedEmail,
    role: 'buyer',
    memberSince: new Date().getFullYear().toString(),
    passwordSalt: salt,
    passwordHash: await hashLocalPassword(password, salt)
  };
  users.push(user);
  localStorage.setItem('zomax_authUsers', JSON.stringify(users));
  return startLocalAuthSession(user);
}

async function localLogin({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = readLocalAuthUsers().find(item => item.email === normalizedEmail);
  if (!user) throw new Error('No account is saved in this browser yet. Create your account here first.');
  if (!user.passwordSalt || !user.passwordHash || await hashLocalPassword(password, user.passwordSalt) !== user.passwordHash) {
    throw new Error('Email or password is incorrect.');
  }
  return startLocalAuthSession(user);
}



/**
 * Backend adapter
 * Provides a minimal adapter that prefers localStorage and `data/*.json` fallbacks.
 * Backend developers should implement matching `/api` endpoints to provide
 * persistent, server-side data. Keep responses compatible with shapes in `data/`.
 */
const backend = {
  async getJson(url, fallback = null) {
    try {
      // Attempt to read static data files for known read-only endpoints.
      if (url === '/api/products') {
        const res = await fetch('data/products.json');
        if (res.ok) return await res.json();
      }

      // Local reviews are stored in localStorage; return them if present.
      if (url.startsWith('/api/products/') && url.endsWith('/reviews')) {
        const productId = String(url.split('/')[3]);
        return reviewsStore[productId] || [];
      }

      if (url === '/api/cart') return JSON.parse(localStorage.getItem('zomax_cart') || '[]');
      if (url === '/api/wishlist') return JSON.parse(localStorage.getItem('zomax_wishlist') || '[]');
      if (url === '/api/orders') return JSON.parse(localStorage.getItem('zomax_orders') || '[]');
      if (url === '/api/account') return JSON.parse(localStorage.getItem('zomax_account') || JSON.stringify(defaultAccount));
      // As a last resort, try to fetch the URL (will fail if no backend is present).
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (err) {
      // fall through to fallback
    }

    return fallback;
  },

  async postJson(url, body, fallback = null) {
    try {
      if (url === '/api/account') {
        localStorage.setItem('zomax_account', JSON.stringify(body || defaultAccount));
        return body || defaultAccount;
      }

      if (url === '/api/cart') {
        localStorage.setItem('zomax_cart', JSON.stringify(body || []));
        return body || [];
      }

      if (url === '/api/wishlist') {
        localStorage.setItem('zomax_wishlist', JSON.stringify(body || []));
        return body || [];
      }

      if (url === '/api/orders') {
        localStorage.setItem('zomax_orders', JSON.stringify(body || []));
        return body || [];
      }

      if (url === '/api/reviews') {
        reviewsStore = body || reviewsStore || {};
        saveReviewsStore();
        return reviewsStore;
      }

      if (url.startsWith('/api/products/') && url.endsWith('/reviews')) {
        const productId = String(url.split('/')[3]);
        reviewsStore[productId] = reviewsStore[productId] || [];
        reviewsStore[productId].push(body);
        saveReviewsStore();
        return body;
      }

      if (url === '/api/products') {
        const newProduct = Object.assign({ id: Date.now(), createdAt: new Date().toISOString() }, body);
        products.unshift(newProduct);
        saveState();
        return newProduct;
      }
    } catch (err) {
      // ignore and return fallback
    }

    return fallback;
  },

  async deleteJson(url, fallback = null) {
    try {
      if (url.startsWith('/api/products/') && url.includes('/reviews/')) {
        const parts = url.split('/');
        const productId = String(parts[3]);
        const index = Number(parts[5]);
        if (Array.isArray(reviewsStore[productId]) && reviewsStore[productId][index]) {
          const [deleted] = reviewsStore[productId].splice(index, 1);
          saveReviewsStore();
          return deleted || {};
        }
        return fallback;
      }
    } catch (err) {}
    return fallback;
  },

  // High-level helpers used across the app — all operate locally when possible.
  fetchAccount: async () => JSON.parse(localStorage.getItem('zomax_account') || JSON.stringify(defaultAccount)),
  fetchCurrentUser: async () => {
    const token = localStorage.getItem('zomax_authToken');
    if (!token) return null;
    if (token.startsWith('local-') || usesLocalAuthPreview()) {
      try {
        const session = JSON.parse(localStorage.getItem('zomax_localSession') || 'null');
        const user = readLocalAuthUsers().find(item => item.id === session?.userId);
        if (session?.token === token && user) return localPublicUser(user);
      } catch (error) {}
      localStorage.removeItem('zomax_authToken');
      localStorage.removeItem('zomax_localSession');
      localStorage.removeItem('zomax_currentUser');
      return null;
    }
    try {
      const response = await fetch('/api/auth/current-user', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Session expired');
      return await response.json();
    } catch (error) {
      localStorage.removeItem('zomax_authToken');
      localStorage.removeItem('zomax_currentUser');
      return null;
    }
  },
  fetchProducts: async () => {
    try {
      const res = await fetch('data/products.json');
      if (res.ok) return await res.json();
    } catch (e) {}
    return products || [];
  },
  fetchProductReviews: async productId => reviewsStore[String(productId)] || [],
  fetchCart: async () => JSON.parse(localStorage.getItem('zomax_cart') || '[]'),
  fetchWishlist: async () => JSON.parse(localStorage.getItem('zomax_wishlist') || '[]'),
  fetchOrders: async () => JSON.parse(localStorage.getItem('zomax_orders') || '[]'),
  authenticate: async (url, credentials) => {
    const useLocalAuth = () => url.endsWith('/register') ? localRegister(credentials) : localLogin(credentials);
    if (usesLocalAuthPreview()) return useLocalAuth();
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
    } catch (error) {
      return useLocalAuth();
    }
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 405 || (response.status === 404 && !contentType.includes('json')) || (response.ok && !contentType.includes('json'))) {
      return useLocalAuth();
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Authentication failed. Please try again.');
    if (!result.token || !result.user) throw new Error('The authentication server returned an invalid response.');
    localStorage.setItem('zomax_authToken', result.token);
    localStorage.setItem('zomax_currentUser', JSON.stringify(result.user));
    return result.user;
  },
  login: async credentials => backend.authenticate('/api/auth/login', credentials),
  register: async credentials => backend.authenticate('/api/auth/register', credentials),
  logout: async () => {
    const token = localStorage.getItem('zomax_authToken');
    try {
      if (token && !token.startsWith('local-') && !usesLocalAuthPreview()) await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    } finally {
      localStorage.removeItem('zomax_authToken');
      localStorage.removeItem('zomax_currentUser');
      localStorage.removeItem('zomax_localSession');
    }
    return null;
  },
  syncAccount: async updatedAccount => { localStorage.setItem('zomax_account', JSON.stringify(updatedAccount)); return updatedAccount; },
  syncCart: async updatedCart => { localStorage.setItem('zomax_cart', JSON.stringify(updatedCart)); return updatedCart; },
  syncWishlist: async updatedWishlist => { localStorage.setItem('zomax_wishlist', JSON.stringify(updatedWishlist)); return updatedWishlist; },
  syncOrders: async updatedOrders => { localStorage.setItem('zomax_orders', JSON.stringify(updatedOrders)); return updatedOrders; },
  saveOrder: async order => { orders.unshift(order); localStorage.setItem('zomax_orders', JSON.stringify(orders)); return order; },
  saveProductListing: async product => { const result = Object.assign({ id: Date.now(), createdAt: new Date().toISOString() }, product); if (!products.some(item => item.id === result.id)) products.unshift(result); saveState(); return result; },
  saveReview: async (productId, review) => { const id = String(productId); reviewsStore[id] = reviewsStore[id] || []; reviewsStore[id].push(review); saveReviewsStore(); return review; },
  deleteReview: async (productId, index) => { const id = String(productId); if (Array.isArray(reviewsStore[id]) && reviewsStore[id][index]) { const [del] = reviewsStore[id].splice(index, 1); saveReviewsStore(); return del; } return {}; },
  syncReviews: async allReviews => { reviewsStore = allReviews || reviewsStore; saveReviewsStore(); return reviewsStore; }
};

function saveState() {
  localStorage.setItem("zomax_cart", JSON.stringify(cart));
  localStorage.setItem("zomax_wishlist", JSON.stringify(wishlist));
  localStorage.setItem("zomax_orders", JSON.stringify(orders));
  localStorage.setItem("zomax_account", JSON.stringify(account));
  if (currentUser) {
    localStorage.setItem("zomax_currentUser", JSON.stringify(currentUser));
  } else {
    localStorage.removeItem("zomax_currentUser");
  }
  updateBadges();
  try { backend.syncAccount(account); } catch (e) {}
  try { backend.syncCart(cart); } catch (e) {}
  try { backend.syncWishlist(wishlist); } catch (e) {}
}

function setPrimaryAddress(index) {
  account.addresses = account.addresses || [];
  if (index < 0 || index >= account.addresses.length) { showToast('Invalid address'); return; }
  const [item] = account.addresses.splice(index,1);
  account.addresses.unshift(item);
  saveState();
  renderProfilePage();
  showToast('Primary address updated');
}

function setPrimaryPayment(index) {
  account.paymentMethods = account.paymentMethods || [];
  if (index < 0 || index >= account.paymentMethods.length) { showToast('Invalid payment'); return; }
  const [item] = account.paymentMethods.splice(index,1);
  account.paymentMethods.unshift(item);
  saveState();
  renderProfilePage();
  showToast('Primary payment updated');
}

function showConfirm(message) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    if (!modal) {
      const ok = window.confirm(message);
      resolve(ok);
      return;
    }
    const msgEl = document.getElementById('confirmModalMessage');
    const yesBtn = document.getElementById('confirmModalYes');
    const noBtn = document.getElementById('confirmModalNo');
    msgEl.textContent = message;

    function cleanup(result) {
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      closeModal('confirmModal');
      resolve(result);
    }

    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }

    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);

    openModal('confirmModal');
  });
}

async function initializeApp() {
  // Initialize state from localStorage / static files; no backend required.
  account = await backend.fetchAccount();
  currentUser = await backend.fetchCurrentUser();
  products = await backend.fetchProducts();
  cart = await backend.fetchCart();
  wishlist = await backend.fetchWishlist();
  orders = await backend.fetchOrders();
  renderCategories();
  renderHome();
  renderShop();
  renderDashboard();
  renderProfilePage();
  renderAuthState();
  updateBadges();
  // Respect direct page links via hash (e.g. /shop.html -> index.html#shop)
  const initialPage = (window.location.hash && window.location.hash.slice(1)) || (new URLSearchParams(window.location.search).get('page')) || 'home';
  navigate(initialPage || 'home');
  renderDashboardAnalytics();
  refreshIcons();
}


function categoryName(id) {
  return categories.find(category => category.id === id)?.name || id;
}

function navigate(page) {
  const pageIds = {
    home: 'page-home',
    shop: 'page-shop',
    categories: 'page-categories',
    cart: 'page-cart',
    wishlist: 'page-wishlist',
    orders: 'page-orders',
    confirmation: 'page-confirmation',
    profile: 'page-profile',
    login: 'page-login',
    signup: 'page-signup',
    dashboard: 'page-dashboard',
    sell: 'page-sell'
  };

  const targetId = pageIds[page] || pageIds.home;
  if (window.location.hash !== `#${page}`) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${page}`);
  }
  document.querySelectorAll('.page').forEach(section => {
    section.classList.toggle('active', section.id === targetId);
  });

  document.querySelectorAll('[data-nav]').forEach(button => {
    button.classList.toggle('active', button.dataset.nav === page);
  });

  const desktopHeader = document.getElementById('desktopHeader');
  const mobileHeader = document.getElementById('mobileHeader');
  const isMobileViewport = window.innerWidth < 768;
  const isAuthPage = page === 'login' || page === 'signup';
  if (desktopHeader) desktopHeader.classList.toggle('hidden', isMobileViewport || isAuthPage);
  if (mobileHeader) mobileHeader.classList.toggle('hidden', !isMobileViewport || isAuthPage);

  if (targetId === 'page-confirmation') renderOrderConfirmation();

  renderHome();
  renderShop();
  renderCart();
  renderWishlist();
  renderOrders();
  renderProfilePage();
  renderDashboard();
  refreshIcons();
}

// Seller CTA: require seller auth, then directly open the store editor after sign-in.
function becomeSeller() {
  try {
    if (window.loader && typeof window.loader.addSignal === 'function') window.loader.addSignal('become:seller');
    if (window.loader && typeof window.loader.setProgress === 'function') window.loader.setProgress(10);
  } catch (e) {}

  if (!currentUser) {
    window.pendingSellerRedirect = 'storeSettings';
    openStoreAuthModal();
  } else {
    window.pendingSellerRedirect = null;
    renderStoreSettings();
    openModal('storeSettingsModal');
  }

  try {
    const ms = 15000;
    setTimeout(() => { try { if (window.loader && typeof window.loader.markDone === 'function') window.loader.markDone('become:seller'); } catch (e) {} }, ms);
  } catch (e) { }
}

function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

function renderCategories() {
  const categoryMarkup = categories.map(category => `
    <button onclick="filterByCategory('${category.id}')" class="group min-w-[110px] rounded-[28px] border border-slate-200/80 bg-white/95 p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <span class="mx-auto grid h-14 w-14 place-items-center rounded-2xl ${category.color}">
        <i data-lucide="${category.icon}" class="h-6 w-6"></i>
      </span>
      <span class="mt-3 block text-xs font-bold leading-4 text-slate-700">${category.name}</span>
    </button>
  `).join("");

  document.getElementById("homeCategories").innerHTML = categoryMarkup;
  document.getElementById("allCategories").innerHTML = categories.map(category => `
    <button onclick="filterByCategory('${category.id}')" class="rounded-[32px] border border-slate-200/80 bg-white/95 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
      <span class="grid h-14 w-14 place-items-center rounded-2xl ${category.color}">
        <i data-lucide="${category.icon}" class="h-7 w-7"></i>
      </span>
      <h3 class="mt-5 font-black">${category.name}</h3>
      <p class="mt-1 text-xs text-slate-500">${products.filter(product => product.category === category.id).length} products</p>
    </button>
  `).join("");

  document.getElementById("categoryFilter").innerHTML = `
    <option value="all">All categories</option>
    ${categories.map(category => `<option value="${category.id}">${category.name}</option>`).join("")}
  `;

  document.getElementById("sellerCategory").innerHTML = categories.map(category => `
    <option value="${category.id}">${category.name}</option>
  `).join("");

  refreshIcons();
}

function fallbackProductImage(product) {
  const fallback = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85';
  return product?.image || fallback;
}

function productLocation(product) {
  return product?.location || product?.storeLocation || 'Location not set';
}

function productWholesalePrice(product) {
  return Number(product?.wholesalePrice || product?.price || 0);
}

function productMinimumOrder(product) {
  return Number(product?.minimumOrder || product?.moq || 1);
}

function productLeadTime(product) {
  return product?.leadTime || 'Ships in 2-5 days';
}

function productTradeBadges(product) {
  return `
    <div class="mt-3 flex flex-wrap gap-1.5">
      ${product?.verifiedSupplier ? '<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700"><i data-lucide="badge-check" class="h-3 w-3"></i> Verified supplier</span>' : ''}
      ${product?.shipsInternationally ? '<span class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700"><i data-lucide="globe-2" class="h-3 w-3"></i> Export ready</span>' : ''}
    </div>
  `;
}

function productCard(product) {
  const saved = wishlist.includes(product.id);
  const safeImage = fallbackProductImage(product);

  return `
    <article class="product-card overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div class="product-card-media relative cursor-pointer" onclick="openProduct(${product.id})">
        <img src="${safeImage}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85'" alt="${product.name}" class="h-full w-full object-contain p-4 sm:p-5" />
        
        <div class="absolute left-3 bottom-3 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs font-black text-slate-900 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4 fill-amber-400 stroke-amber-400"><path d="M12 .587l3.668 7.431L23.4 9.748l-5.7 5.557L18.834 24 12 20.202 5.166 24l1.134-8.695L.6 9.748l7.732-1.73L12 .587z"/></svg>
          <span>${product.rating}</span>
          <span class="text-slate-400">(${product.reviews})</span>
        </div>
        <button onclick="event.stopPropagation(); toggleWishlist(${product.id})" class="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-500 shadow-sm hover:text-red-500">
          <i data-lucide="heart" class="h-4 w-4 ${saved ? "fill-red-500 text-red-500" : ""}"></i>
        </button>
      </div>

      <div class="p-4">
        <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">${categoryName(product.category)}</p>
        <h3 onclick="openProduct(${product.id})" class="mt-1 cursor-pointer line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-slate-800">${product.name}</h3>

        <div class="mt-2 flex items-center gap-1 text-xs text-slate-500">
          <i data-lucide="star" class="h-3.5 w-3.5 fill-amber-400 text-amber-400"></i>
          <b>${product.rating}</b>
          <span class="text-slate-400">(${product.reviews})</span>
        </div>

        <div class="mt-3 flex items-center gap-1.5 text-xs text-slate-500" title="Seller location">
          <i data-lucide="map-pin" class="h-3.5 w-3.5 shrink-0 text-orange-500"></i>
          <span class="truncate">${productLocation(product)}</span>
        </div>

        ${productTradeBadges(product)}

        <div class="mt-4 flex items-end justify-between gap-2 border-t border-slate-100 pt-3">
          <div>
            <p class="text-base font-black text-slate-900">${money(product.price)}</p>
            <p class="mt-1 text-[10px] font-bold text-orange-600">Wholesale from ${money(productWholesalePrice(product))} · MOQ ${productMinimumOrder(product)}</p>
            ${product.oldPrice ? `<p class="text-[11px] text-slate-400 line-through">${money(product.oldPrice)}</p>` : ""}
          </div>
          <button onclick="event.stopPropagation(); addToCart(${product.id})" class="grid h-11 w-11 place-items-center rounded-3xl bg-gradient-to-br from-orange-500 to-orange-400 text-white shadow-lg shadow-orange-200 hover:from-orange-600 hover:to-orange-500">
            <i data-lucide="plus" class="h-4 w-4"></i>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderHome() {
  document.getElementById("homeProducts").innerHTML = products.slice(0, 8).map(productCard).join("");
  refreshIcons();
}

function renderShop() {
  const category = document.getElementById("categoryFilter")?.value || "all";
  const sort = document.getElementById("sortFilter")?.value || "featured";
  const verifiedOnly = document.getElementById('verifiedFilter')?.checked || false;
  const exportOnly = document.getElementById('exportFilter')?.checked || false;
  const bulkOnly = document.getElementById('bulkFilter')?.checked || false;

  let result = products.filter(product => {
    const matchesCategory = category === "all" || product.category === category;
    const text = `${product.name} ${product.seller} ${categoryName(product.category)}`.toLowerCase();
    const matchesVerified = !verifiedOnly || product.verifiedSupplier;
    const matchesExport = !exportOnly || product.shipsInternationally;
    const matchesBulk = !bulkOnly || productWholesalePrice(product) < Number(product.price || 0) || productMinimumOrder(product) > 1;
    return matchesCategory && text.includes(currentSearch.toLowerCase()) && matchesVerified && matchesExport && matchesBulk;
  });

  if (sort === "low") result.sort((a, b) => a.price - b.price);
  if (sort === "high") result.sort((a, b) => b.price - a.price);
  if (sort === "rating") result.sort((a, b) => b.rating - a.rating);

  document.getElementById("shopResultText").textContent = `${result.length} product${result.length === 1 ? "" : "s"} found`;
  document.getElementById("shopProducts").innerHTML = result.length
    ? result.map(productCard).join("")
    : emptyState("search-x", "No products found", "Try another keyword or category.");
  refreshIcons();
}

// renderDeals removed — deals page deprecated

function renderDashboard() {
  const totalProducts = products.length;
  const totalRevenue = products.reduce((sum, product) => sum + Number(product.price || 0), 0);
  const activeProducts = products.filter(product => Number(product.stock || 0) > 0).length;
  const averagePrice = totalProducts ? Math.round(totalRevenue / totalProducts) : 0;
  const totalOrders = orders.length;
  const quoteRequests = JSON.parse(localStorage.getItem('zomax_rfqs') || '[]');
  const openQuotes = quoteRequests.filter(request => request.status === 'pending' || request.status === 'quoted').length;
  const acceptedQuotes = quoteRequests.filter(request => request.status === 'accepted').length;

  document.getElementById("dashboardStats").innerHTML = `
    <div class="rounded-2xl md:rounded-3xl bg-white p-3 md:p-5 shadow-sm">
      <p class="text-[10px] md:text-xs uppercase tracking-[0.3em] text-slate-400">Total listings</p>
      <h3 class="mt-2 md:mt-3 text-xl md:text-3xl font-black text-slate-900">${totalProducts}</h3>
    </div>
    <div class="rounded-2xl md:rounded-3xl bg-white p-3 md:p-5 shadow-sm">
      <p class="text-[10px] md:text-xs uppercase tracking-[0.3em] text-slate-400">In stock</p>
      <h3 class="mt-2 md:mt-3 text-xl md:text-3xl font-black text-slate-900">${activeProducts}</h3>
    </div>
    <div class="rounded-2xl md:rounded-3xl bg-white p-3 md:p-5 shadow-sm">
      <p class="text-[10px] md:text-xs uppercase tracking-[0.3em] text-slate-400">Total sales</p>
      <h3 class="mt-2 md:mt-3 text-xl md:text-3xl font-black text-slate-900">${totalOrders}</h3>
    </div>
    <div class="rounded-2xl md:rounded-3xl bg-white p-3 md:p-5 shadow-sm">
      <p class="text-[10px] md:text-xs uppercase tracking-[0.3em] text-slate-400">Catalog value</p>
      <h3 class="mt-2 md:mt-3 text-xl md:text-3xl font-black text-slate-900">${money(totalRevenue)}</h3>
    </div>
    <div class="rounded-2xl md:rounded-3xl border border-orange-100 bg-orange-50 p-3 md:p-5 shadow-sm">
      <p class="text-[10px] md:text-xs uppercase tracking-[0.3em] text-orange-600">Open inquiries</p>
      <h3 class="mt-2 md:mt-3 text-xl md:text-3xl font-black text-slate-900">${openQuotes}</h3>
    </div>
    <div class="rounded-2xl md:rounded-3xl border border-emerald-100 bg-emerald-50 p-3 md:p-5 shadow-sm">
      <p class="text-[10px] md:text-xs uppercase tracking-[0.3em] text-emerald-600">Accepted deals</p>
      <h3 class="mt-2 md:mt-3 text-xl md:text-3xl font-black text-slate-900">${acceptedQuotes}</h3>
    </div>
  `;

  // Update active listing count in store health
  const activeListingElement = document.getElementById('storeActiveListing');
  if (activeListingElement) activeListingElement.textContent = activeProducts;

  // Render recent products
  const recentProducts = products.slice(0, 5);
  document.getElementById("dashboardProducts").innerHTML = recentProducts.length ? recentProducts.map(product => `
    <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:bg-orange-50">
      <img src="${fallbackProductImage(product)}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85'" alt="${product.name}" class="h-14 w-14 rounded-xl object-cover" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-black text-slate-900">${product.name}</p>
        <p class="text-xs text-slate-500">${categoryName(product.category)} · ${money(product.price)}</p>
      </div>
      <div class="text-right">
        <span class="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700">${Number(product.stock || 0)}</span>
        <p class="text-xs text-slate-500 mt-1">in stock</p>
      </div>
    </div>
  `).join("") : '<p class="text-sm text-slate-500 text-center py-6">No products yet. <a href="#" onclick="navigate(\'sell\')" class="text-orange-500 font-bold">Add your first product</a></p>';

  // Render top products
  renderDashboardTopProducts();

  // Render sales activity
  renderDashboardSalesActivity();

  // Render customer reviews
  renderDashboardReviews();

  // Render buyer quote requests
  renderDashboardQuotes();

  renderVerificationSummary();

  // Render analytics
  renderDashboardAnalytics();

  refreshIcons();
}

function renderDashboardTopProducts() {
  const container = document.getElementById("dashboardTopProducts");
  if (!container) return;

  // Get products sorted by review count (popularity proxy)
  const topProducts = products.slice().sort((a, b) => (b.reviews || 0) - (a.reviews || 0)).slice(0, 5);

  container.innerHTML = topProducts.length ? topProducts.map(product => {
    const rating = product.rating || 5;
    const reviews = product.reviews || 0;
    return `
      <div class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:bg-orange-50">
        <img src="${fallbackProductImage(product)}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85'" alt="${product.name}" class="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-black text-slate-900">${product.name}</p>
          <div class="mt-1 flex items-center gap-2">
            <span class="text-xs font-bold text-yellow-600">★ ${rating}</span>
            <span class="text-xs text-slate-500">${reviews} reviews</span>
          </div>
        </div>
        <div class="text-right flex-shrink-0">
          <p class="text-sm font-black text-orange-600">${money(product.price)}</p>
        </div>
      </div>
    `;
  }).join("") : '<p class="text-sm text-slate-500 text-center py-6">Publish products to track performance</p>';
}

function renderDashboardSalesActivity() {
  const container = document.getElementById("dashboardSalesActivity");
  if (!container) return;

  const recentOrders = orders.slice(-5).reverse();

  container.innerHTML = recentOrders.length ? recentOrders.map(order => {
    const items = order.items || [];
    const itemsSummary = items.length === 1 ? items[0].name : `${items.length} items`;
    const statusColor = order.status === 'delivered' ? 'emerald' : order.status === 'pending' ? 'orange' : 'blue';
    return `
      <div class="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div>
          <p class="text-sm font-black text-slate-900">${itemsSummary}</p>
          <p class="text-xs text-slate-500">Order ${order.id ? order.id.toString().slice(-6) : 'N/A'}</p>
        </div>
        <div class="text-right">
          <p class="text-sm font-black text-slate-900">${money(order.total || 0)}</p>
          <span class="inline-block rounded-full bg-${statusColor}-100 px-2 py-0.5 text-[10px] font-bold text-${statusColor}-700 mt-1">${order.status || 'pending'}</span>
        </div>
      </div>
    `;
  }).join("") : '<p class="text-sm text-slate-500 text-center py-6">No sales yet. Keep marketing your products!</p>';
}

function renderDashboardReviews() {
  const container = document.getElementById("dashboardReviews");
  if (!container) return;

  // Get all reviews across products
  const allReviews = [];
  Object.entries(reviewsStore).forEach(([productId, reviews]) => {
    (reviews || []).forEach(review => allReviews.push({ ...review, productId }));
  });

  const recentReviews = allReviews.sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  container.innerHTML = recentReviews.length ? recentReviews.map(review => {
    const product = products.find(item => String(item.id) === String(review.productId));
    const productName = product?.name || 'Product';
    const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
    return `
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-sm font-black text-slate-900">${review.author || 'Anonymous'}</p>
            <p class="mt-1 text-xs text-slate-500">${productName}</p>
          </div>
          <span class="text-xs text-amber-500">${stars}</span>
        </div>
        <p class="mt-2 text-sm text-slate-600">${review.text || 'No comment'}</p>
      </div>
    `;
  }).join('') : '<p class="py-6 text-center text-sm text-slate-500">No reviews yet</p>';
  refreshIcons();
}

function renderDashboardQuotes() {
  const container = document.getElementById('dashboardQuotes');
  if (!container) return;
  const requests = JSON.parse(localStorage.getItem('zomax_rfqs') || '[]').slice(0, 4);
  container.innerHTML = requests.length ? requests.map(request => {
    const product = products.find(item => item.id === request.productId);
    const statusClass = request.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : request.status === 'quoted' ? 'bg-blue-100 text-blue-700' : request.status === 'declined' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700';
    return `
      <div class="rounded-2xl border border-orange-100 bg-white p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-black text-slate-900">${product?.name || 'Product inquiry'}</p>
            <p class="mt-1 text-xs text-slate-500">${request.name} · ${request.country}</p>
          </div>
          <span class="shrink-0 rounded-full ${statusClass} px-2 py-1 text-[10px] font-black">${request.status}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"><span><strong>${request.quantity}</strong> units</span><span>${request.contact}</span></div>
        ${request.message ? `<p class="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">${request.message}</p>` : ''}
        ${request.response ? `<div class="mt-3 rounded-xl bg-emerald-50 p-2.5 text-xs text-emerald-800"><strong>Quote sent:</strong> ${money(request.response.unitPrice)}/unit · ${request.response.leadTime}</div>` : `<button type="button" onclick="openQuoteResponse('${request.id}')" class="mt-3 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600"><i data-lucide="reply" class="h-3.5 w-3.5"></i> Respond to buyer</button>`}
      </div>
    `;
  }).join('') : '<p class="rounded-2xl border border-dashed border-orange-200 bg-white/70 p-4 text-sm text-slate-500">No buyer inquiries yet. Your quote requests will appear here.</p>';
  refreshIcons();
}

function renderVerificationSummary() {
  const container = document.getElementById('verificationSummary');
  if (!container) return;
  const verification = account.verification || {};
  const status = verification.status || 'not_started';
  const statusLabel = status === 'submitted' ? 'Under review' : status === 'approved' ? 'Verified supplier' : status === 'needs_action' ? 'Action required' : 'Not started';
  const levelLabel = verification.level === 'trusted' ? 'Trusted supplier review' : verification.level === 'business' ? 'Registered business' : 'Location verified vendor';
  const statusClass = status === 'approved' ? 'bg-emerald-100 text-emerald-700' : status === 'submitted' ? 'bg-blue-100 text-blue-700' : status === 'needs_action' ? 'bg-red-100 text-red-700' : 'bg-white text-slate-600';
  container.innerHTML = `
    <div class="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3"><span class="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><i data-lucide="shield-check" class="h-5 w-5"></i></span><div><p class="text-sm font-black text-slate-900">${statusLabel}</p><p class="mt-1 text-xs text-slate-500">${status === 'submitted' ? `${levelLabel} · Our team will review your application.` : 'Choose the level that matches your business.'}</p></div></div>
      ${status === 'approved' ? '<span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">Approved</span>' : `<button type="button" onclick="openVerificationModal()" class="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700"><i data-lucide="file-check-2" class="h-3.5 w-3.5"></i> ${status === 'submitted' ? 'View application' : 'Apply for verification'}</button>`}
    </div>
  `;
  refreshIcons();
}

function computeSMA(values, windowSize) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const windowValues = values.slice(start, index + 1);
    return windowValues.reduce((sum, value) => sum + value, 0) / windowValues.length;
  });
}

function renderDashboardAnalytics() {
  const analyticsArea = document.getElementById('dashboardAnalytics');
  if (!analyticsArea) return;

  // Build last-7-days labels
  const days = 7;
  const labels = [];
  const revenue = [];
  const ordersSeries = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toISOString().slice(0, 10);
    labels.push(label);
    revenue.push(0);
    ordersSeries.push(0);
  }

  orders.forEach(o => {
    const od = new Date(o.date);
    if (isNaN(od)) return;
    const key = od.toISOString().slice(0, 10);
    const idx = labels.indexOf(key);
    if (idx >= 0) {
      revenue[idx] += Number(o.total || 0);
      ordersSeries[idx] += 1;
    }
  });

  const revenueSMA7 = computeSMA(revenue, 7);
  const ordersSMA7 = computeSMA(ordersSeries, 7);

  // Render simple analytics summary in dashboard
  const revSMAVal = revenueSMA7[revenueSMA7.length - 1] || 0;
  const ordSMAVal = ordersSMA7[ordersSMA7.length - 1] || 0;

  analyticsArea.innerHTML = `
    <div class="rounded-2xl md:rounded-3xl bg-white p-3 md:p-5 shadow-sm">
      <p class="text-[10px] md:text-xs uppercase tracking-[0.3em] text-slate-400">7-day revenue</p>
      <h3 class="mt-2 md:mt-3 text-xl md:text-2xl font-black text-slate-900">${money(revSMAVal)}</h3>
    </div>
    <div class="rounded-2xl md:rounded-3xl bg-white p-3 md:p-5 shadow-sm">
      <p class="text-[10px] md:text-xs uppercase tracking-[0.3em] text-slate-400">7-day orders</p>
      <h3 class="mt-2 md:mt-3 text-xl md:text-2xl font-black text-slate-900">${ordSMAVal}</h3>
    </div>
  `;
}

// Admin dashboard removed


function filterByCategory(category) {
  document.getElementById("categoryFilter").value = category;
  currentSearch = "";
  document.getElementById("desktopSearch").value = "";
  document.getElementById("mobileSearch").value = "";
  navigate("shop");
}

function applyFilters() {
  renderShop();
}

function handleSearch(value) {
  currentSearch = value;
  if (!document.getElementById("page-shop").classList.contains("active")) navigate("shop");
  renderShop();
}

function setProductModalTab(tab) {
  if (!currentProductModalId) return;
  currentProductModalTab = tab;
  renderProductModal(currentProductModalId, tab);
  refreshIcons();
}

function selectProductModalImage(index) {
  const product = products.find(item => item.id === currentProductModalId);
  const images = product?.images?.length ? product.images : [fallbackProductImage(product)];
  currentProductModalImageIndex = Math.max(0, Math.min(index, images.length - 1));
  renderProductModal(currentProductModalId, currentProductModalTab);
  refreshIcons();
}

function moveProductModalImage(direction) {
  const product = products.find(item => item.id === currentProductModalId);
  const images = product?.images?.length ? product.images : [fallbackProductImage(product)];
  if (images.length < 2) return;
  currentProductModalImageIndex = (currentProductModalImageIndex + direction + images.length) % images.length;
  renderProductModal(currentProductModalId, currentProductModalTab);
  refreshIcons();
}

function openProduct(id) {
  currentProductModalId = id;
  currentProductModalTab = "overview";
  currentProductModalImageIndex = 0;
  renderProductModal(id, currentProductModalTab);
  openModal("productModal");
  refreshIcons();
}

function openQuoteModal(productId) {
  const product = products.find(item => item.id === productId);
  if (!product) return;

  const container = document.getElementById('quoteModalContent');
  if (!container) return;
  closeModal('productModal');
  container.innerHTML = `
    <div class="space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-orange-500">Direct sourcing</p>
          <h2 class="mt-2 text-2xl font-black text-slate-900">Request a supplier quote</h2>
          <p class="mt-2 text-sm leading-6 text-slate-500">Tell ${product.seller} what you need and receive a tailored bulk price.</p>
        </div>
        <button type="button" onclick="closeModal('quoteModal')" aria-label="Close quote form" class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50"><i data-lucide="x" class="h-4 w-4"></i></button>
      </div>
      <div class="flex items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50 p-3">
        <img src="${fallbackProductImage(product)}" alt="${product.name}" class="h-14 w-14 rounded-xl object-cover" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-black text-slate-900">${product.name}</p>
          <p class="mt-1 text-xs text-slate-600">MOQ ${productMinimumOrder(product)} · ${productLeadTime(product)}</p>
        </div>
        <span class="hidden rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-orange-700 sm:inline-flex">Wholesale ready</span>
      </div>
      <form onsubmit="submitQuote(event, ${product.id})" class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-bold text-slate-700">Your name
            <input id="quoteName" required value="${currentUser ? (account.name || '') : ''}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Business contact name" />
          </label>
          <label class="text-sm font-bold text-slate-700">Email or WhatsApp
            <input id="quoteContact" required value="${currentUser ? (account.email || '') : ''}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="you@business.com" />
          </label>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-bold text-slate-700">Quantity needed
            <input id="quoteQuantity" required type="number" min="${productMinimumOrder(product)}" value="${productMinimumOrder(product)}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </label>
          <label class="text-sm font-bold text-slate-700">Delivery country
            <input id="quoteCountry" required value="Nigeria" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Nigeria, Ghana, UK..." />
          </label>
        </div>
        <label class="text-sm font-bold text-slate-700">Message to supplier
          <textarea id="quoteMessage" rows="4" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Share your target price, customization, delivery timeline, or other requirements."></textarea>
        </label>
        <div class="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500"><i data-lucide="shield-check" class="h-4 w-4 text-emerald-500"></i> Your request is saved securely and shared with the supplier.</div>
        <button type="submit" class="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-orange-200 hover:bg-orange-600"><i data-lucide="send" class="h-4 w-4"></i> Send quote request</button>
      </form>
    </div>
  `;
  openModal('quoteModal');
  refreshIcons();
}

function submitQuote(event, productId) {
  event.preventDefault();
  const request = {
    id: `RFQ-${Date.now()}`,
    productId,
    name: document.getElementById('quoteName').value.trim(),
    contact: document.getElementById('quoteContact').value.trim(),
    quantity: Number(document.getElementById('quoteQuantity').value),
    country: document.getElementById('quoteCountry').value.trim(),
    message: document.getElementById('quoteMessage').value.trim(),
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  const requests = JSON.parse(localStorage.getItem('zomax_rfqs') || '[]');
  requests.unshift(request);
  localStorage.setItem('zomax_rfqs', JSON.stringify(requests));
  closeModal('quoteModal');
  showToast('Quote request sent to the supplier');
}

function openQuoteResponse(requestId) {
  const requests = JSON.parse(localStorage.getItem('zomax_rfqs') || '[]');
  const request = requests.find(item => item.id === requestId);
  if (!request) return;
  const product = products.find(item => item.id === request.productId);
  const container = document.getElementById('quoteResponseModalContent');
  if (!container) return;

  container.innerHTML = `
    <div class="space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-orange-500">Supplier response</p>
          <h2 class="mt-2 text-2xl font-black text-slate-900">Reply to ${request.name}</h2>
          <p class="mt-2 text-sm text-slate-500">${product?.name || 'Product inquiry'} · ${request.quantity} units to ${request.country}</p>
        </div>
        <button type="button" onclick="closeModal('quoteResponseModal')" aria-label="Close response form" class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50"><i data-lucide="x" class="h-4 w-4"></i></button>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Buyer request</p>
        <p class="mt-2 text-sm leading-6 text-slate-700">${request.message || 'No additional message provided.'}</p>
        <p class="mt-2 text-xs text-slate-500">Reply to: ${request.contact}</p>
      </div>
      <form onsubmit="submitQuoteResponse(event, '${request.id}')" class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-bold text-slate-700">Your unit price
            <input id="responseUnitPrice" required type="number" min="1" value="${productWholesalePrice(product)}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="e.g. 18000" />
          </label>
          <label class="text-sm font-bold text-slate-700">Lead time
            <input id="responseLeadTime" required value="${productLeadTime(product)}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="e.g. 7-10 business days" />
          </label>
        </div>
        <label class="text-sm font-bold text-slate-700">Message to buyer
          <textarea id="responseMessage" required rows="4" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Explain shipping, payment terms, customization, or next steps."></textarea>
        </label>
        <button type="submit" class="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-orange-200 hover:bg-orange-600"><i data-lucide="send" class="h-4 w-4"></i> Send quote response</button>
      </form>
    </div>
  `;
  openModal('quoteResponseModal');
  refreshIcons();
}

function submitQuoteResponse(event, requestId) {
  event.preventDefault();
  const requests = JSON.parse(localStorage.getItem('zomax_rfqs') || '[]');
  const request = requests.find(item => item.id === requestId);
  if (!request) return;
  request.status = 'quoted';
  request.response = {
    unitPrice: Number(document.getElementById('responseUnitPrice').value),
    leadTime: document.getElementById('responseLeadTime').value.trim(),
    message: document.getElementById('responseMessage').value.trim(),
    createdAt: new Date().toISOString()
  };
  localStorage.setItem('zomax_rfqs', JSON.stringify(requests));
  closeModal('quoteResponseModal');
  renderDashboardQuotes();
  showToast('Quote response sent to the buyer');
}

function acceptQuote(requestId) {
  const requests = JSON.parse(localStorage.getItem('zomax_rfqs') || '[]');
  const request = requests.find(item => item.id === requestId);
  if (!request?.response) return;
  request.status = 'accepted';
  request.acceptedAt = new Date().toISOString();
  localStorage.setItem('zomax_rfqs', JSON.stringify(requests));
  renderProfilePage();
  showToast('Quote accepted. The supplier can now arrange fulfillment.');
}

function openVerificationModal() {
  const verification = account.verification || {};
  const documents = verification.documents || {};
  const container = document.getElementById('verificationModalContent');
  if (!container) return;
  container.innerHTML = `
    <div class="space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-600">Trust centre</p>
          <h2 class="mt-2 text-2xl font-black text-slate-900">Become a verified supplier</h2>
          <p class="mt-2 max-w-xl text-sm leading-6 text-slate-500">Zomax verification is based on identity, business legitimacy, address, capability, and transparent trade information.</p>
        </div>
        <button type="button" onclick="closeModal('verificationModal')" aria-label="Close verification form" class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50"><i data-lucide="x" class="h-4 w-4"></i></button>
      </div>

      <div class="grid gap-2 sm:grid-cols-4">
        ${[['user-check','Identity'],['building-2','Business'],['map-pin','Address'],['factory','Capability']].map(([icon,label]) => `<div class="rounded-2xl bg-slate-50 p-3 text-center"><i data-lucide="${icon}" class="mx-auto h-5 w-5 text-emerald-600"></i><p class="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">${label}</p></div>`).join('')}
      </div>

      <form onsubmit="submitVerification(event)" novalidate class="space-y-4">
        <div class="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <label class="block text-sm font-bold text-slate-700">Verification level
            <select id="verificationLevel" onchange="updateVerificationRequirements()" class="mt-2 w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm">
              <option value="location">Location verified vendor</option>
              <option value="business">Registered business</option>
              <option value="trusted">Trusted supplier review</option>
            </select>
          </label>
          <p id="verificationLevelHelp" class="mt-2 text-xs leading-5 text-emerald-800">For small vendors: verify who you are and where you trade. No company registration required.</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-bold text-slate-700">Legal business name
            <input id="verificationBusinessName" required value="${verification.businessName || account.storeInfo?.storeName || account.name || ''}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Registered company name" />
          </label>
          <label class="text-sm font-bold text-slate-700">Registration country
            <input id="verificationCountry" required value="${verification.country || 'Nigeria'}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Nigeria, Ghana, UK..." />
          </label>
        </div>
        <label class="text-sm font-bold text-slate-700">Business registration number
          <input id="verificationRegistration" value="${verification.registrationNumber || ''}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="CAC, company, or equivalent registration number" />
        </label>
        <div class="grid gap-3 sm:grid-cols-2">
          ${[['identity','Government ID / passport'],['registration','Business registration certificate'],['address','Proof of business address'],['capability','Product or facility evidence']].map(([key,label]) => `<label data-verification-field="${key}" class="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3 transition hover:border-emerald-400 hover:bg-emerald-50"><span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-slate-500"><i data-lucide="file-up" class="h-4 w-4"></i></span><span class="min-w-0 flex-1"><span class="block truncate text-xs font-bold text-slate-700">${label}</span><span class="mt-1 block truncate text-[10px] text-slate-400" data-verification-file="${key}">${documents[key] || 'Choose a file'}</span></span><input id="verificationDocument${key.charAt(0).toUpperCase() + key.slice(1)}" type="file" accept="image/*,.pdf" class="hidden" onchange="updateVerificationFile('${key}', this)" /></label>`).join('')}
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-sm font-bold text-slate-700">Tax ID <span class="font-normal text-slate-400">(optional)</span>
            <input id="verificationTaxId" value="${verification.taxId || account.storeInfo?.taxId || ''}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="Tax identification number" />
          </label>
          <label class="text-sm font-bold text-slate-700">Settlement account last 4 digits
            <input id="verificationBankLast4" maxlength="4" inputmode="numeric" value="${verification.bankLast4 || account.storeInfo?.bankAccount || ''}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" placeholder="1234" />
          </label>
        </div>
        <label class="flex items-start gap-3 rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><input id="verificationDeclaration" type="checkbox" required class="mt-1 accent-emerald-600" /> <span>I confirm these details are accurate and authorize Zomax to review them for supplier verification.</span></label>
        <button type="submit" class="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700"><i data-lucide="send" class="h-4 w-4"></i> Submit for review</button>
      </form>
    </div>
  `;
  openModal('verificationModal');
  refreshIcons();
  updateVerificationRequirements();
}

function updateVerificationRequirements() {
  const level = document.getElementById('verificationLevel')?.value || 'location';
  const help = document.getElementById('verificationLevelHelp');
  const requirements = {
    location: 'For small vendors: verify who you are and where you trade. No company registration required.',
    business: 'For registered businesses: include your company registration certificate and business address proof.',
    trusted: 'For high-trust suppliers: include registration, address proof, and product or facility evidence for a deeper review.'
  };
  if (help) help.textContent = requirements[level];
  const requiredByLevel = {
    location: ['address'],
    business: ['identity', 'registration', 'address'],
    trusted: ['identity', 'registration', 'address', 'capability']
  }[level];
  document.querySelectorAll('[data-verification-field]').forEach(field => {
    const key = field.dataset.verificationField;
    const input = field.querySelector('input[type="file"]');
    const required = requiredByLevel.includes(key);
    field.classList.toggle('border-emerald-300', required);
    field.classList.toggle('bg-emerald-50', required);
    if (input) input.required = required;
  });
  const registration = document.getElementById('verificationRegistration');
  const bank = document.getElementById('verificationBankLast4');
  if (registration) registration.required = level !== 'location';
  if (bank) bank.required = level === 'trusted';
}

function updateVerificationFile(key, input) {
  const file = input.files?.[0];
  const target = document.querySelector(`[data-verification-file="${key}"]`);
  if (target) target.textContent = file ? file.name : 'Choose a file';
}

function submitVerification(event) {
  event.preventDefault();
  const level = document.getElementById('verificationLevel').value;
  const requiredDocuments = {
    location: ['address'],
    business: ['identity', 'registration', 'address'],
    trusted: ['identity', 'registration', 'address', 'capability']
  }[level];
  const missingDocuments = requiredDocuments.filter(key => {
    const input = document.getElementById(`verificationDocument${key.charAt(0).toUpperCase() + key.slice(1)}`);
    return !input?.files?.length && !account.verification?.documents?.[key];
  });
  const declaration = document.getElementById('verificationDeclaration');
  const businessName = document.getElementById('verificationBusinessName');
  const country = document.getElementById('verificationCountry');
  if (!businessName.value.trim() || !country.value.trim()) {
    showToast('Add your business or trading name and country.');
    return;
  }
  if (missingDocuments.length) {
    const labels = { identity: 'ID', registration: 'business registration', address: 'address proof', capability: 'product or facility evidence' };
    showToast(`Upload: ${missingDocuments.map(key => labels[key]).join(', ')}.`);
    return;
  }
  if (!declaration.checked) {
    showToast('Confirm the declaration before submitting.');
    return;
  }
  const documents = {};
  ['identity', 'registration', 'address', 'capability'].forEach(key => {
    const input = document.getElementById(`verificationDocument${key.charAt(0).toUpperCase() + key.slice(1)}`);
    documents[key] = input?.files?.[0]?.name || account.verification?.documents?.[key] || '';
  });
  account.verification = {
    status: 'submitted',
    level,
    submittedAt: new Date().toISOString(),
    businessName: document.getElementById('verificationBusinessName').value.trim(),
    country: document.getElementById('verificationCountry').value.trim(),
    registrationNumber: document.getElementById('verificationRegistration').value.trim(),
    taxId: document.getElementById('verificationTaxId').value.trim(),
    bankLast4: document.getElementById('verificationBankLast4').value.trim(),
    documents
  };
  saveState();
  closeModal('verificationModal');
  renderDashboard();
  showToast('Verification application submitted for review');
}

function renderProductModal(id, activeTab) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  const saved = wishlist.includes(id);
  const images = product.images?.length ? product.images : [fallbackProductImage(product)];
  const activeImage = images[currentProductModalImageIndex] || images[0];
  const carouselDots = images.map((src, index) => `
    <button type="button" onclick="selectProductModalImage(${index})" aria-label="Show image ${index + 1} of ${images.length}" class="h-2 rounded-full transition-all ${currentProductModalImageIndex === index ? 'w-8 bg-orange-500' : 'w-2 bg-white/60 hover:bg-white'}"></button>
  `).join("");
  const relatedProducts = products.filter(item => item.category === product.category && item.id !== product.id).slice(0, 4);
  const relatedMarkup = relatedProducts.length
    ? relatedProducts.map(item => `
        <button onclick="openProduct(${item.id})" class="group min-w-[220px] overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm">
          <img src="${fallbackProductImage(item)}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85'" alt="${item.name}" class="h-28 w-full rounded-2xl object-cover" />
          <div class="mt-3">
            <p class="text-xs font-bold uppercase tracking-wide text-slate-400">${categoryName(item.category)}</p>
            <h3 class="mt-2 line-clamp-2 text-sm font-black text-slate-900">${item.name}</h3>
            <p class="mt-2 text-sm font-black text-orange-500">${money(item.price)}</p>
          </div>
        </button>
      `).join("")
    : `<p class="text-sm text-slate-500">No related products found yet.</p>`;

  const tabButton = (tab, label, icon) => `
    <button onclick="setProductModalTab('${tab}')" class="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold ${activeTab === tab ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'}">
      <i data-lucide="${icon}" class="h-4 w-4"></i>
      ${label}
    </button>
  `;

  let tabContent = "";
  if (activeTab === "overview") {
    tabContent = `
      <div class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div class="space-y-4">
          <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <h3 class="text-lg font-black">Product details</h3>
            <p class="mt-3 text-sm leading-6 text-slate-600">${product.description}</p>
          </div>
          <div class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <h3 class="text-lg font-black">Highlights</h3>
            <div class="mt-3 space-y-2 text-sm text-slate-600">
              <p><strong class="text-slate-900">Seller:</strong> ${product.seller}</p>
              <p><strong class="text-slate-900">Location:</strong> ${product.location}</p>
              <p><strong class="text-slate-900">Category:</strong> ${categoryName(product.category)}</p>
              <p><strong class="text-slate-900">Minimum order:</strong> ${productMinimumOrder(product)} units</p>
              <p><strong class="text-slate-900">Lead time:</strong> ${productLeadTime(product)}</p>
            </div>
          </div>
        </div>
        <div class="space-y-4">
          <div class="rounded-3xl border border-slate-200 bg-white p-5">
            <p class="text-xs uppercase tracking-wide text-slate-500">Price</p>
            <p class="mt-2 text-2xl font-black text-orange-500">${money(product.price)}</p>
            <p class="mt-1 text-xs font-bold text-orange-600">Wholesale from ${money(productWholesalePrice(product))} · MOQ ${productMinimumOrder(product)}</p>
            ${product.oldPrice ? `<span class="block text-xs text-slate-400 line-through">${money(product.oldPrice)}</span>` : ""}
            <button onclick="addToCart(${product.id}); closeModal('productModal')" class="mt-5 w-full rounded-xl bg-orange-500 py-3.5 text-sm font-black text-white hover:bg-orange-600">
              Add to cart
            </button>
            <button onclick="openQuoteModal(${product.id})" class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-3.5 text-sm font-black text-slate-700 hover:border-orange-300 hover:bg-orange-50">
              <i data-lucide="messages-square" class="h-4 w-4"></i> Request a quote
            </button>
          </div>
        </div>
      </div>
    `;
  } else if (activeTab === "reviews") {
    const productReviews = getReviewsForProduct(product.id);
    const reviewsList = productReviews.length ? productReviews.map((r, i) => `
        <div class="rounded-2xl border border-slate-100 bg-white p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <b class="font-semibold text-slate-900">${r.author}</b>
              <div class="mt-1 text-sm text-slate-500">${new Date(r.createdAt).toLocaleString()}</div>
              <div class="mt-2 text-sm font-black text-amber-400">${'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="inline h-4 w-4 fill-amber-400 stroke-amber-400"><path d="M12 .587l3.668 7.431L23.4 9.748l-5.7 5.557L18.834 24 12 20.202 5.166 24l1.134-8.695L.6 9.748l7.732-1.73L12 .587z"/></svg>'}${' '.repeat(0)} ${r.rating}</div>
            </div>
            <div class="flex gap-2">
              <button onclick="editReview(${product.id}, ${i})" class="rounded-xl p-2 text-slate-500 hover:bg-slate-50" title="Edit review">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
              <button onclick="deleteReview(${product.id}, ${i})" class="rounded-xl p-2 text-slate-500 hover:bg-slate-50" title="Delete review">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24"><path d="M9 3v1H4v2h16V4h-5V3H9zM6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6z"/></svg>
              </button>
            </div>
          </div>
          <p class="mt-3 text-sm text-slate-700">${r.text}</p>
        </div>
      `).join('') : `
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
          <h3 class="text-lg font-black text-slate-900">Customer reviews</h3>
          <p class="mt-3">No reviews yet. Be the first to review this product.</p>
        </div>
      `;

    tabContent = `
      <div class="space-y-4">
        <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <h3 class="text-lg font-black text-slate-900">Customer reviews</h3>
          <div class="mt-4 space-y-3">${reviewsList}</div>
        </div>

        <div class="rounded-3xl border border-slate-200 bg-white p-5">
          <h3 class="text-lg font-black text-slate-900">Leave a review</h3>
          <form onsubmit="submitReview(event, ${product.id})" class="mt-3 space-y-3">
            <div>
              <label class="text-sm font-semibold">Name</label>
              <input id="reviewAuthor" class="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Your name (optional)" />
            </div>
            <div>
              <label class="text-sm font-semibold">Rating</label>
              <input type="hidden" id="reviewRating" value="5" />
              <div class="mt-2 flex gap-1" id="reviewStars">
                <button type="button" class="review-star text-slate-300" data-value="1" onclick="setReviewStars(1)">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5"><path d="M12 .587l3.668 7.431L23.4 9.748l-5.7 5.557L18.834 24 12 20.202 5.166 24l1.134-8.695L.6 9.748l7.732-1.73L12 .587z"/></svg>
                </button>
                <button type="button" class="review-star text-slate-300" data-value="2" onclick="setReviewStars(2)">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5"><path d="M12 .587l3.668 7.431L23.4 9.748l-5.7 5.557L18.834 24 12 20.202 5.166 24l1.134-8.695L.6 9.748l7.732-1.73L12 .587z"/></svg>
                </button>
                <button type="button" class="review-star text-slate-300" data-value="3" onclick="setReviewStars(3)">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5"><path d="M12 .587l3.668 7.431L23.4 9.748l-5.7 5.557L18.834 24 12 20.202 5.166 24l1.134-8.695L.6 9.748l7.732-1.73L12 .587z"/></svg>
                </button>
                <button type="button" class="review-star text-slate-300" data-value="4" onclick="setReviewStars(4)">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5"><path d="M12 .587l3.668 7.431L23.4 9.748l-5.7 5.557L18.834 24 12 20.202 5.166 24l1.134-8.695L.6 9.748l7.732-1.73L12 .587z"/></svg>
                </button>
                <button type="button" class="review-star text-slate-300" data-value="5" onclick="setReviewStars(5)">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5"><path d="M12 .587l3.668 7.431L23.4 9.748l-5.7 5.557L18.834 24 12 20.202 5.166 24l1.134-8.695L.6 9.748l7.732-1.73L12 .587z"/></svg>
                </button>
              </div>
            </div>
            <div>
              <label class="text-sm font-semibold">Review</label>
              <textarea id="reviewText" rows="3" class="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" placeholder="Share your experience"></textarea>
            </div>
            <div>
              <button type="submit" class="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-black text-white">Submit review</button>
            </div>
          </form>
        </div>
      </div>
    `;
  } else if (activeTab === "faq") {
    tabContent = `
      <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
        <h3 class="text-lg font-black text-slate-900">Frequently asked questions</h3>
        <p class="mt-3">No FAQ entries available yet. This section will be populated after backend integration.</p>
      </div>
    `;
  } else if (activeTab === "related") {
    tabContent = `
      <div class="mt-3 flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible">
        ${relatedMarkup}
      </div>
    `;
  }

  document.getElementById("productModalContent").innerHTML = `
    <div class="space-y-4">
      <div class="product-carousel relative overflow-hidden bg-slate-100">
        <img src="${activeImage}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85'" alt="${product.name} image ${currentProductModalImageIndex + 1}" class="h-72 w-full object-cover sm:h-[28rem]" />
        ${images.length > 1 ? `
          <button type="button" onclick="moveProductModalImage(-1)" aria-label="Previous product image" class="carousel-control left-4">
            <i data-lucide="chevron-left" class="h-5 w-5"></i>
          </button>
          <button type="button" onclick="moveProductModalImage(1)" aria-label="Next product image" class="carousel-control right-4">
            <i data-lucide="chevron-right" class="h-5 w-5"></i>
          </button>
          <div class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950/45 px-3 py-2 backdrop-blur-sm">${carouselDots}</div>
          <span class="absolute bottom-4 right-4 rounded-full bg-slate-950/55 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm">${currentProductModalImageIndex + 1} / ${images.length}</span>
        ` : ''}
        <button onclick="closeModal('productModal')" class="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/90">
          <i data-lucide="x"></i>
        </button>
      </div>
    </div>

    <div class="p-5 sm:p-7 space-y-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p class="text-xs font-bold uppercase tracking-widest text-orange-500">${categoryName(product.category)}</p>
          <h2 class="mt-2 text-2xl font-black">${product.name}</h2>
          <p class="mt-2 text-sm text-slate-500">Sold by ${product.seller} · ${product.location}</p>
        </div>
        <button onclick="toggleWishlist(${product.id}); openProduct(${product.id})" class="rounded-xl border border-slate-200 p-3 ${saved ? "text-red-500" : "text-slate-500"}">
          <i data-lucide="heart" class="h-5 w-5 ${saved ? "fill-red-500" : ""}"></i>
        </button>
      </div>

      ${product.video ? `<div class="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950"><video src="${product.video}" controls playsinline preload="metadata" class="max-h-[26rem] w-full object-contain"></video></div>` : ''}

      <div class="rounded-3xl bg-white p-4 shadow-sm">
        <div class="flex flex-wrap gap-2">
          ${tabButton("overview", "Overview", "layers")}
          ${tabButton("reviews", "Reviews", "message-circle")}
          ${tabButton("faq", "FAQ", "help-circle")}
          ${tabButton("related", "Related", "package")}
        </div>
        <div class="mt-4">${tabContent}</div>
      </div>
    </div>
  `;
  // initialize icons and optional review-star UI
  refreshIcons();
  const ratingInput = document.getElementById('reviewRating');
  if (ratingInput) setReviewStars(Number(ratingInput.value) || 5);
}

function addToCart(id) {
  const existing = cart.find(item => item.id === id);
  if (existing) existing.qty += 1;
  else cart.push({ id, qty: 1 });

  saveState();
  showToast("Product added to cart");
}

function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  saveState();
  renderCart();
}

function changeQuantity(id, amount) {
  const item = cart.find(item => item.id === id);
  if (!item) return;

  item.qty += amount;
  if (item.qty <= 0) removeFromCart(id);
  else {
    saveState();
    renderCart();
  }
}

function clearCart() {
  if (!cart.length) return;
  cart = [];
  saveState();
  renderCart();
  showToast("Cart cleared");
}

function cartDetails() {
  return cart.map(item => {
    const product = products.find(product => product.id === item.id);
    return product ? { ...product, qty: item.qty } : null;
  }).filter(Boolean);
}

function cartTotal() {
  return cartDetails().reduce((total, item) => total + item.price * item.qty, 0);
}

function renderCart() {
  const items = cartDetails();

  if (!items.length) {
    document.getElementById("cartContent").innerHTML = emptyState("shopping-cart", "Your cart is empty", "Add products to start your order.");
    return;
  }

  document.getElementById("cartContent").innerHTML = `
    <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-3">
        ${items.map(item => `
          <div class="flex gap-3 rounded-2xl bg-white p-3 shadow-sm sm:gap-5 sm:p-4">
            <img src="${item.image}" alt="${item.name}" class="h-24 w-24 rounded-xl object-cover sm:h-28 sm:w-28" />
            <div class="min-w-0 flex-1">
              <div class="flex justify-between gap-3">
                <div>
                  <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400">${categoryName(item.category)}</p>
                  <h3 class="mt-1 truncate text-sm font-black">${item.name}</h3>
                </div>
                <button onclick="removeFromCart(${item.id})" class="text-slate-400 hover:text-red-500">
                  <i data-lucide="trash-2" class="h-4 w-4"></i>
                </button>
              </div>
              <p class="mt-2 font-black">${money(item.price)}</p>
              <div class="mt-3 flex items-center justify-between">
                <div class="flex items-center rounded-xl border border-slate-200">
                  <button onclick="changeQuantity(${item.id}, -1)" class="px-3 py-1.5 text-lg">−</button>
                  <span class="px-2 text-sm font-bold">${item.qty}</span>
                  <button onclick="changeQuantity(${item.id}, 1)" class="px-3 py-1.5 text-lg">+</button>
                </div>
                <b class="text-sm">${money(item.price * item.qty)}</b>
              </div>
            </div>
          </div>
        `).join("")}
      </div>

      <aside class="h-fit rounded-2xl bg-white p-5 shadow-sm">
        <h2 class="text-lg font-black">Order summary</h2>
        <div class="mt-5 space-y-3 text-sm">
          <div class="flex justify-between"><span class="text-slate-500">Subtotal</span><b>${money(cartTotal())}</b></div>
          <div class="flex justify-between"><span class="text-slate-500">Delivery</span><b class="text-emerald-600">Free</b></div>
          <div class="border-t border-slate-100 pt-3 text-base"><div class="flex justify-between"><b>Total</b><b>${money(cartTotal())}</b></div></div>
        </div>
        <button onclick="openCheckout()" class="mt-5 w-full btn-primary py-3.5 text-sm font-black">
          Proceed to checkout
        </button>
      </aside>
    </div>
  `;

  refreshIcons();
}

function toggleWishlist(id) {
  if (wishlist.includes(id)) {
    wishlist = wishlist.filter(item => item !== id);
    showToast("Removed from wishlist");
  } else {
    wishlist.push(id);
    showToast("Saved to wishlist");
  }

  saveState();
  renderHome();
  renderShop();
  if (document.getElementById("page-wishlist").classList.contains("active")) renderWishlist();
}

function renderWishlist() {
  const savedProducts = wishlist.map(id => products.find(product => product.id === id)).filter(Boolean);

  document.getElementById("wishlistContent").innerHTML = savedProducts.length
    ? `<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">${savedProducts.map(productCard).join("")}</div>`
    : emptyState("heart-off", "Your wishlist is empty", "Save products you love and find them here later.");

  refreshIcons();
}

function renderOrders() {
  if (!orders.length) {
    document.getElementById("ordersContent").innerHTML = emptyState("package-open", "No orders yet", "Your completed purchases will appear here.");
    return;
  }
  
  document.getElementById("ordersContent").innerHTML = `
    <div class="space-y-4">
      ${orders.map(order => `
        <article class="rounded-2xl bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-xs font-bold uppercase tracking-widest text-slate-400">${order.id}</p>
              <h3 class="mt-1 font-black">${order.items.length} item${order.items.length === 1 ? "" : "s"} · ${money(order.total)}</h3>
            </div>
            <span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">${order.status}</span>
          </div>
          <p class="mt-3 text-xs text-slate-500">${order.date}</p>
          <div class="mt-4 flex gap-2 overflow-x-auto">
            ${order.items.map(item => `
              <img src="${item.image}" alt="${item.name}" title="${item.name}" class="h-14 w-14 rounded-xl object-cover" />
            `).join("")}
          </div>
        </article>
      `).join("")}
    </div>
  `;

  // make order items clickable to open details
  document.querySelectorAll('#ordersContent article').forEach((el, idx) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => openOrderDetail(orders[idx].id));
  });

  refreshIcons();
}

function renderOrderConfirmation() {
  const order = lastOrder || orders[0];
  const container = document.getElementById("confirmationContent");
  if (!container) return;

  if (!order) {
    container.innerHTML = `
      <div class="rounded-3xl bg-slate-50 p-8 text-center">
        <p class="text-sm text-slate-500">No recent order details are available yet.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="rounded-3xl border border-slate-200 bg-slate-50 p-6">
      <p class="text-xs uppercase tracking-[0.35em] text-slate-400">Order ID</p>
      <h2 class="mt-2 text-2xl font-black text-slate-900">${order.id}</h2>
      <p class="mt-2 text-sm text-slate-500">Placed on ${order.date}</p>
      <div class="mt-6 space-y-3 text-sm text-slate-600">
        <div class="flex justify-between"><span>Status</span><strong>${order.status}</strong></div>
        <div class="flex justify-between"><span>Items</span><strong>${order.items.length}</strong></div>
        <div class="flex justify-between"><span>Total paid</span><strong>${money(order.total)}</strong></div>
      </div>
    </div>
    <aside class="rounded-3xl border border-slate-200 bg-white p-6">
      <h3 class="text-lg font-black text-slate-900">Order summary</h3>
      <div class="mt-4 space-y-4">
        ${order.items.map(item => `
          <div class="flex items-center gap-3">
            <img src="${item.image}" alt="${item.name}" class="h-16 w-16 rounded-2xl object-cover" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-black text-slate-900">${item.name}</p>
              <p class="text-xs text-slate-500">${item.qty} × ${money(item.price)}</p>
            </div>
            <p class="text-sm font-black text-slate-900">${money(item.price * item.qty)}</p>
          </div>
        `).join("")}
      </div>
    </aside>
  `;
}

function openOrderDetail(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  const content = document.getElementById('orderDetailContent');
  content.innerHTML = `
    <div class="space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <p class="text-xs uppercase tracking-[0.35em] text-slate-400">Order ID</p>
        <h2 class="mt-2 text-2xl font-black text-slate-900">${order.id}</h2>
        <p class="mt-2 text-sm text-slate-500">Placed on ${order.date}</p>
        <div class="mt-6 space-y-3 text-sm text-slate-600">
          <div class="flex justify-between"><span>Status</span><strong>${order.status}</strong></div>
          <div class="flex justify-between"><span>Items</span><strong>${order.items.length}</strong></div>
          <div class="flex justify-between"><span>Total paid</span><strong>${money(order.total)}</strong></div>
        </div>
      </div>
      <div class="rounded-2xl bg-white p-5 shadow-sm">
        <h3 class="text-lg font-black text-slate-900">Items</h3>
        <div class="mt-4 space-y-3">
          ${order.items.map(item => `
            <div class="flex items-center gap-3">
              <img src="${item.image}" alt="${item.name}" class="h-16 w-16 rounded-2xl object-cover" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-black text-slate-900">${item.name}</p>
                <p class="text-xs text-slate-500">${item.qty} × ${money(item.price)}</p>
              </div>
              <p class="text-sm font-black text-slate-900">${money(item.price * item.qty)}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  openModal('orderDetailModal');
}

function openCheckout() {
  if (!cart.length) {
    showToast("Your cart is empty");
    return;
  }

  if (document.getElementById("checkoutName")) {
    document.getElementById("checkoutName").value = account.name || "";
    document.getElementById("checkoutPhone").value = account.phone || "";
    document.getElementById("checkoutAddress").value = account.address || "";
    document.getElementById("checkoutPaymentMethod").value = account.paymentMethod || "";
  }

  document.getElementById("checkoutTotal").innerHTML = `
    <div class="flex justify-between">
      <span class="text-slate-500">Total to pay</span>
      <b class="text-lg text-orange-600">${money(cartTotal())}</b>
    </div>
  `;

  openModal("checkoutModal");
}

function placeOrder(event) {
  event.preventDefault();

  const name = document.getElementById("checkoutName")?.value.trim();
  const phone = document.getElementById("checkoutPhone")?.value.trim();
  const address = document.getElementById("checkoutAddress")?.value.trim();
  const paymentMethod = document.getElementById("checkoutPaymentMethod")?.value;

  if (!name || !phone || !address || !paymentMethod) {
    showToast("Please complete the checkout details.");
    return;
  }

  account.name = name;
  account.phone = phone;
  account.address = address;
  account.paymentMethod = paymentMethod;
  account.memberSince = account.memberSince || new Date().getFullYear().toString();
  saveState();
  renderProfilePage();

  const newOrder = {
    id: `ZMX-${Date.now().toString().slice(-6)}`,
    items: cartDetails(),
    total: cartTotal(),
    status: "Processing",
    date: new Date().toLocaleDateString("en-NG", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }),
    customer: {
      name,
      phone,
      address,
      paymentMethod
    }
  };

  orders.unshift(newOrder);
      lastOrder = newOrder;
      cart = [];
      saveState();
      backend.syncOrders(orders).catch(() => {});
      closeModal("checkoutModal");
      renderCart();
      navigate("confirmation");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
    reader.readAsDataURL(file);
  });
}

function previewProductMedia(event) {
  const preview = document.getElementById('sellerMediaPreview');
  if (!preview) return;
  const imageFiles = Array.from(document.getElementById('sellerImages')?.files || []);
  const videoFile = document.getElementById('sellerVideo')?.files?.[0];
  preview.innerHTML = '';

  imageFiles.forEach(file => {
    const url = URL.createObjectURL(file);
    preview.insertAdjacentHTML('beforeend', `<div class="relative aspect-square overflow-hidden rounded-xl bg-slate-100"><img src="${url}" alt="Selected product photo" class="h-full w-full object-cover" /><span class="absolute bottom-1 left-1 rounded-md bg-slate-950/70 px-1.5 py-0.5 text-[9px] font-bold text-white">PHOTO</span></div>`);
  });
  if (videoFile) {
    const url = URL.createObjectURL(videoFile);
    preview.insertAdjacentHTML('beforeend', `<div class="relative aspect-square overflow-hidden rounded-xl bg-slate-900"><video src="${url}" muted playsinline class="h-full w-full object-cover"></video><span class="absolute bottom-1 left-1 rounded-md bg-blue-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white">VIDEO</span></div>`);
  }
}

async function submitProduct(event) {
  event.preventDefault();

  // Check if user is logged in
  if (!currentUser) {
    window.pendingSellerRedirect = 'storeSettings';
    showToast("Please login or create an account to publish a product");
    navigate('login');
    return;
  }

  const name = document.getElementById("sellerName").value.trim();
  const category = document.getElementById("sellerCategory").value;
  const price = Number(document.getElementById("sellerPrice").value);
  const wholesalePrice = Number(document.getElementById("sellerWholesalePrice")?.value || price);
  const minimumOrder = Number(document.getElementById("sellerMinimumOrder")?.value || 1);
  const leadTime = document.getElementById("sellerLeadTime")?.value.trim() || 'Ships in 2-5 days';
  const shipsInternationally = document.getElementById("sellerInternational")?.checked || false;
  const fallbackImage = "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85";
  const imageFiles = Array.from(document.getElementById('sellerImages')?.files || []);
  const videoFile = document.getElementById('sellerVideo')?.files?.[0];
  if (!imageFiles.length) {
    showToast('Choose at least one product photo');
    return;
  }
  if (imageFiles.some(file => file.size > 8 * 1024 * 1024)) {
    showToast('Each product photo must be 8MB or smaller');
    return;
  }
  if (videoFile && videoFile.size > 30 * 1024 * 1024) {
    showToast('Product video must be 30MB or smaller');
    return;
  }
  let images;
  let video = '';
  try {
    images = await Promise.all(imageFiles.map(readFileAsDataUrl));
    video = videoFile ? await readFileAsDataUrl(videoFile) : '';
  } catch (error) {
    showToast('Unable to read the selected media files');
    return;
  }
  const image = images[0] || fallbackImage;
  const description = document.getElementById("sellerDescription").value.trim() || "Seller-listed product on Zomax.";
  const store = account.storeInfo || {};
  const sellerName = store.storeName || account.name || "Zomax Seller";
  const sellerLocation = store.storeLocation || (account.address ? account.address.split(",").slice(-1)[0].trim() : "Location not set");

  const newProduct = {
    id: Date.now(),
    name,
    category,
    price,
    wholesalePrice: Math.min(wholesalePrice, price),
    minimumOrder: Math.max(1, minimumOrder),
    leadTime,
    verifiedSupplier: false,
    shipsInternationally,
    oldPrice: null,
    rating: 5,
    reviews: 0,
    seller: sellerName,
    location: sellerLocation,
    storeLocation: sellerLocation,
    image,
    images: images.length ? images : [fallbackImage],
    video,
    description
  };

  products.unshift(newProduct);
  event.target.reset();
  renderHome();
  renderShop();
  backend.saveProductListing(newProduct).catch(() => {});
  showToast("Product published successfully");
  navigate("shop");
}

function emptyState(icon, title, description) {
  return `
    <div class="rounded-3xl bg-white px-6 py-14 text-center shadow-sm">
      <span class="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-orange-100 text-orange-600">
        <i data-lucide="${icon}" class="h-7 w-7"></i>
      </span>
      <h2 class="mt-5 text-xl font-black">${title}</h2>
      <p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">${description}</p>
      <button onclick="navigate('shop')" class="mt-5 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white">
        Browse products
      </button>
    </div>
  `;
}

function updateBadges() {
  const cartCount = cart.reduce((total, item) => total + item.qty, 0);
  const wishlistCount = wishlist.length;

  ["desktopCartCount", "mobileCartCount"].forEach(id => {
    const element = document.getElementById(id);
    element.textContent = cartCount;
    element.classList.toggle("hidden", cartCount === 0);
  });

  ["desktopWishlistCount", "mobileWishlistCount"].forEach(id => {
    const element = document.getElementById(id);
    element.textContent = wishlistCount;
    element.classList.toggle("hidden", wishlistCount === 0);
  });
}

function openModal(id) {
  document.getElementById(id).classList.add("open");
  document.body.classList.add("overflow-hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  document.body.classList.remove("overflow-hidden");
}

function renderProfilePage() {
  // First-letter avatar
  const initials = currentUser ? ((account.name && account.name.trim().length) ? account.name.trim().charAt(0).toUpperCase() : (account.username || '?').charAt(0).toUpperCase()) : '?';
  const profileEl = document.getElementById('profileInitials');
  const topbarEl = document.getElementById('topbarProfileInitials');

  if (currentUser) {
    if (account.avatar) {
      profileEl.innerHTML = `<img src="${account.avatar}" alt="${account.name || 'Profile'} photo" class="h-full w-full rounded-[26px] object-cover" />`;
      topbarEl.innerHTML = `<img src="${account.avatar}" alt="${account.name || 'Profile'} photo" class="h-full w-full rounded-full object-cover" />`;
    } else {
      profileEl.textContent = initials;
      topbarEl.textContent = initials;
    }
    profileEl.className = 'grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-[26px] bg-orange-500 text-3xl font-black shadow-xl shadow-orange-950/30 ring-4 ring-white/10';
    topbarEl.className = 'grid h-9 w-9 overflow-hidden place-items-center rounded-full bg-orange-500 font-bold';
  } else {
    profileEl.textContent = '?';
    profileEl.className = 'grid h-20 w-20 place-items-center rounded-3xl bg-white/10 text-3xl font-black ring-1 ring-white/15';
    topbarEl.textContent = '?';
    topbarEl.className = 'grid h-9 w-9 place-items-center rounded-full bg-orange-100 font-bold text-orange-600';
  }

  document.getElementById('profileDisplayName').textContent = currentUser ? (account.name || 'Your name') : 'Guest shopper';
  document.getElementById('profileContactLine').textContent = currentUser ? (account.email ? `${account.email} • ${account.phone || 'No phone'}` : 'Update your contact details') : 'Login to unlock saved account details and faster checkout.';
  document.getElementById('profileOrdersCount').textContent = currentUser ? orders.length : 0;
  document.getElementById('profileWishlistCount').textContent = currentUser ? wishlist.length : 0;
  document.getElementById('profileSince').textContent = currentUser ? account.memberSince || '—' : '—';
  document.getElementById('profileSettingsSection').classList.toggle('hidden', !currentUser);

  // Render inline primary address & payment selection
  const primaryContainer = document.getElementById('profilePrimaryInfo');
  if (primaryContainer) {
    if (!currentUser) {
      primaryContainer.innerHTML = '';
    } else {
      // Primary address
      const addrList = account.addresses || [];
      const primaryAddr = addrList.length ? addrList[0].address : (account.address || 'No address set');
      const addrOptions = addrList.length ? addrList.map((a,i)=>`<option value="${i}">${a.label||`Address ${i+1}`} — ${a.address.slice(0,40)}${a.address.length>40?'...':''}</option>`).join('') : '';

      // Primary payment
      const payList = account.paymentMethods || [];
      const primaryPay = payList.length ? `${payList[0].type} • **** ${payList[0].last4}` : (account.cardLast4 ? `**** ${account.cardLast4}` : 'No payment method');
      const payOptions = payList.length ? payList.map((p,i)=>`<option value="${i}">${p.label||p.type} • **** ${p.last4}</option>`).join('') : '';

      primaryContainer.innerHTML = `
        <div class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
          <div class="min-w-0 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <div class="flex items-center gap-2 text-slate-400"><i data-lucide="map-pin" class="h-4 w-4"></i><p class="text-[10px] font-bold uppercase tracking-[0.18em]">Primary delivery</p></div>
            <p class="mt-2 break-words text-sm font-semibold leading-5 text-white">${primaryAddr}</p>
            <div class="mt-3 flex min-w-0 w-full flex-wrap items-center gap-2">
              ${addrOptions ? `<select id="profileAddrSelect" class="min-w-0 max-w-full flex-1 rounded-xl border-0 bg-white/10 px-2 py-2 text-xs text-white">${addrOptions}</select>
              <button type="button" onclick="setPrimaryAddress(Number(document.getElementById('profileAddrSelect').value))" class="shrink-0 rounded-xl bg-white/10 px-2.5 py-2 text-xs font-semibold text-white">Set primary</button>
              <button type="button" onclick="openAccountSettings('address')" aria-label="Manage addresses" class="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/10 text-slate-300"><i data-lucide="settings-2" class="h-3.5 w-3.5"></i></button>` : `<button type="button" onclick="openAccountSettings('address')" class="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-2.5 py-2 text-xs font-semibold text-white"><i data-lucide="plus" class="h-3.5 w-3.5"></i> Add address</button>`}
            </div>
          </div>
          <div class="min-w-0 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10">
            <div class="flex items-center gap-2 text-slate-400"><i data-lucide="credit-card" class="h-4 w-4"></i><p class="text-[10px] font-bold uppercase tracking-[0.18em]">Primary payment</p></div>
            <p class="mt-2 break-words text-sm font-semibold leading-5 text-white">${primaryPay}</p>
            <div class="mt-3 flex min-w-0 w-full flex-wrap items-center gap-2">
              ${payOptions ? `<select id="profilePaySelect" class="min-w-0 max-w-full flex-1 rounded-xl border-0 bg-white/10 px-2 py-2 text-xs text-white">${payOptions}</select>
              <button type="button" onclick="setPrimaryPayment(Number(document.getElementById('profilePaySelect').value))" class="shrink-0 rounded-xl bg-white/10 px-2.5 py-2 text-xs font-semibold text-white">Set primary</button>
              <button type="button" onclick="openAccountSettings('payment')" aria-label="Manage payment methods" class="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/10 text-slate-300"><i data-lucide="settings-2" class="h-3.5 w-3.5"></i></button>` : `<button type="button" onclick="openAccountSettings('payment')" class="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-2.5 py-2 text-xs font-semibold text-white"><i data-lucide="plus" class="h-3.5 w-3.5"></i> Add payment</button>`}
            </div>
          </div>
        </div>
      `;
    }
  }

  if (!currentUser) {
    document.getElementById('profileActionCards').innerHTML = `
      <div class="rounded-[32px] border border-dashed border-slate-200 bg-white p-8 text-center shadow-sm">
        <p class="text-sm font-semibold text-slate-500">You're browsing as a guest</p>
        <h2 class="mt-4 text-2xl font-black text-slate-900">Login for a personalized account</h2>
        <p class="mt-3 text-sm leading-6 text-slate-500">Sign in to save your profile, address, wishlist and orders across sessions.</p>
        <button onclick="navigate('login')" class="mt-6 inline-flex rounded-3xl bg-orange-500 px-6 py-3 text-sm font-black text-white hover:bg-orange-600">Login now</button>
      </div>
    `;
  } else {
    const paymentMethod = account.cardLast4 ? `**** **** **** ${account.cardLast4}` : 'No card saved';
    const newsletterOn = account.preferences?.newsletter ? 'checked' : '';
    const buyerQuotes = JSON.parse(localStorage.getItem('zomax_rfqs') || '[]').filter(request => request.contact === account.email || request.name === account.name).slice(0, 3);
    document.getElementById('profileActionCards').innerHTML = `
      <div class="grid gap-4 sm:grid-cols-2">
        <button onclick="navigate('orders')" class="group rounded-[32px] border border-slate-200 bg-white p-5 text-left shadow-lg shadow-slate-200/30 transition hover:-translate-y-0.5 hover:shadow-xl">
          <div class="flex h-14 w-14 items-center justify-center rounded-3xl bg-orange-100 text-orange-600 transition group-hover:bg-orange-200">
            <i data-lucide="package" class="h-5 w-5"></i>
          </div>
          <div class="mt-4">
            <p class="text-sm font-semibold text-slate-700">My orders</p>
            <p class="mt-1 text-sm text-slate-400">${orders.length} orders • Track deliveries</p>
          </div>
        </button>

        <div class="group rounded-[32px] border border-slate-200 bg-white p-5 text-left shadow-lg shadow-slate-200/30">
          <div class="flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-700">
            <i data-lucide="credit-card" class="h-5 w-5"></i>
          </div>
          <div class="mt-4">
            <p class="text-sm font-semibold text-slate-700">Payment</p>
            <p class="mt-1 text-sm text-slate-400">${paymentMethod}</p>
          </div>
        </div>

        <div class="rounded-[32px] border border-slate-200 bg-white p-5 text-left shadow-lg">
          <div class="flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-700">
            <i data-lucide="activity" class="h-5 w-5"></i>
          </div>
          <div class="mt-4">
            <p class="text-sm font-semibold text-slate-700">Recent activity</p>
            <p class="mt-1 text-sm text-slate-400">See your latest orders and reviews</p>
          </div>
        </div>

        <div class="rounded-[32px] border border-slate-200 bg-white p-5 text-left shadow-lg">
          <div class="flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-700">
            <i data-lucide="download" class="h-5 w-5"></i>
          </div>
          <div class="mt-4 flex items-start gap-3">
            <div class="flex-1">
              <p class="text-sm font-semibold text-slate-700">Account export</p>
              <p class="mt-1 text-sm text-slate-400">Download a copy of your account data</p>
            </div>
            <div class="flex flex-col gap-2">
              <button type="button" onclick="exportAccount()" class="rounded-3xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">Export</button>
              <button type="button" onclick="document.getElementById('accountImportInput').click()" class="rounded-3xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">Import</button>
            </div>
          </div>
        </div>

        <div class="rounded-[32px] border border-orange-100 bg-orange-50/60 p-5 text-left shadow-lg sm:col-span-2">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-slate-700">My quote requests</p>
              <p class="mt-1 text-sm text-slate-400">Track supplier responses and wholesale offers.</p>
            </div>
            <i data-lucide="messages-square" class="h-5 w-5 text-orange-500"></i>
          </div>
          <div class="mt-4 space-y-2">
            ${buyerQuotes.length ? buyerQuotes.map(request => `
              <div class="rounded-2xl border border-orange-100 bg-white p-3">
                <div class="flex items-center justify-between gap-3"><p class="truncate text-xs font-black text-slate-800">${products.find(item => item.id === request.productId)?.name || 'Product inquiry'}</p><span class="rounded-full ${request.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : request.response ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'} px-2 py-1 text-[10px] font-black">${request.status}</span></div>
                ${request.response ? `<p class="mt-2 text-xs text-slate-600">${money(request.response.unitPrice)}/unit · ${request.response.leadTime}</p><p class="mt-1 text-xs leading-5 text-slate-500">${request.response.message}</p>${request.status === 'quoted' ? `<button type="button" onclick="acceptQuote('${request.id}')" class="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700"><i data-lucide="check" class="h-3.5 w-3.5"></i> Accept quote</button>` : ''}` : '<p class="mt-2 text-xs text-slate-500">Waiting for supplier response.</p>'}
              </div>
            `).join('') : '<p class="rounded-2xl border border-dashed border-orange-200 bg-white/70 p-3 text-xs text-slate-500">Your supplier quote requests will appear here.</p>'}
          </div>
        </div>
      </div>

      <div class="mt-6 rounded-[32px] bg-white p-5 shadow-lg">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-slate-700">Newsletter</p>
          <label class="flex items-center gap-3">
            <input id="newsletterToggle" type="checkbox" ${newsletterOn} onchange="toggleNewsletter(this.checked)" />
            <span class="text-sm text-slate-500">Subscribe</span>
          </label>
        </div>
        <p class="mt-3 text-sm text-slate-500">Receive exclusive offers and product updates.</p>
      </div>

      <div id="recentActivity" class="mt-6 rounded-[32px] bg-white p-5 shadow-lg">
        <h3 class="text-lg font-black text-slate-900">Recent activity</h3>
        <div class="mt-4" id="recentActivityList"></div>
      </div>
    `;
    renderRecentActivity();
  }

  // Show or hide the Deactivate button on the profile overview (explicit add/remove avoids toggle edge-cases)
  const deactivateBtn = document.getElementById('profileDeactivateBtn');
  if (deactivateBtn) {
    if (!currentUser) deactivateBtn.classList.add('hidden');
    else deactivateBtn.classList.remove('hidden');
  }
}

function openAccountSettings(tab = "profile") {
  if (!currentUser) {
    openLoginModal();
    return;
  }
  renderAccountModal(tab);
  openModal("accountModal");
  refreshIcons();
}

function openStoreSettings() {
  if (!currentUser) {
    window.pendingSellerRedirect = 'storeSettings';
    openStoreAuthModal();
    return;
  }
  window.pendingSellerRedirect = null;
  renderStoreSettings();
  openModal("storeSettingsModal");
  refreshIcons();
}

function openStoreAuthModal() {
  const container = document.getElementById('storeAuthContent');
  if (!container) return;

  container.innerHTML = `
    <div class="space-y-5">
      <div class="rounded-[28px] border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-4 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="grid h-12 w-12 place-items-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-200">
            <i data-lucide="shield-check" class="h-5 w-5"></i>
          </div>
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.22em] text-orange-600">Seller access</p>
            <p class="mt-1 text-sm text-slate-600">Securely manage your store, prices, shipping and policies.</p>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] font-bold text-slate-600">
          <div class="rounded-2xl bg-white/80 px-2 py-2 shadow-sm ring-1 ring-slate-100">
            <div class="text-slate-900">100%</div>
            <div class="mt-1 text-[9px] uppercase tracking-[0.18em] text-slate-500">Secure</div>
          </div>
          <div class="rounded-2xl bg-white/80 px-2 py-2 shadow-sm ring-1 ring-slate-100">
            <div class="text-slate-900">24/7</div>
            <div class="mt-1 text-[9px] uppercase tracking-[0.18em] text-slate-500">Access</div>
          </div>
          <div class="rounded-2xl bg-white/80 px-2 py-2 shadow-sm ring-1 ring-slate-100">
            <div class="text-slate-900">Live</div>
            <div class="mt-1 text-[9px] uppercase tracking-[0.18em] text-slate-500">Sync</div>
          </div>
        </div>
      </div>

      <form onsubmit="loginToStoreSettings(event)" class="space-y-4">
        <div class="space-y-2">
          <label class="block text-sm font-semibold text-slate-700">Email address</label>
          <div class="relative">
            <span class="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400">
              <i data-lucide="mail" class="h-4 w-4"></i>
            </span>
            <input id="storeAuthEmail" type="email" required class="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100" value="${currentUser?.email || ''}" placeholder="you@example.com" />
          </div>
        </div>

        <div class="space-y-2">
          <label class="block text-sm font-semibold text-slate-700">Password</label>
          <div class="relative">
            <span class="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400">
              <i data-lucide="lock" class="h-4 w-4"></i>
            </span>
            <input id="storeAuthPassword" type="password" required class="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100" placeholder="Enter your password" />
          </div>
        </div>

        <button type="submit" class="w-full rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:brightness-105">Continue to store settings</button>
      </form>

      <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs text-slate-500">
        Need an account? <a href="#" onclick="navigate('signup'); closeModal('storeAuthModal'); return false;" class="font-black text-orange-600">Create one</a>
      </div>
    </div>
  `;

  openModal('storeAuthModal');
  refreshIcons();
}

async function loginToStoreSettings(event) {
  event.preventDefault();

  const email = document.getElementById('storeAuthEmail')?.value.trim();
  const password = document.getElementById('storeAuthPassword')?.value || '';

  if (!email || !password) {
    showToast('Enter your email and password to continue.');
    return;
  }

  try {
    currentUser = await backend.login({ email, password });
    account.username = currentUser.username;
    account.name = currentUser.name;
    account.email = currentUser.email;
    account.memberSince = account.memberSince || currentUser.memberSince;
    saveState();
    renderProfilePage();
    renderAuthState();

    const shouldOpenStoreSetup = window.pendingSellerRedirect === 'storeSettings';
    window.pendingSellerRedirect = null;
    closeModal('storeAuthModal');

    if (shouldOpenStoreSetup) {
      closeModal('loginModal');
      renderStoreSettings();
      openModal('storeSettingsModal');
      showToast('Store access granted');
      return;
    }

    renderStoreSettings();
    openModal('storeSettingsModal');
    showToast('Store access granted');
  } catch (error) {
    showToast(error.message || 'Unable to sign in. Please try again.');
  }
}

function renderStoreSettings() {
  const container = document.getElementById('storeSettingsContent');
  if (!container) return;

  // Initialize storeInfo if not exists
  if (!account.storeInfo) {
    account.storeInfo = {
      storeName: account.name || '',
      storeEmail: account.email || '',
      storePhone: account.phone || '',
      storeLocation: account.address || '',
      storeDescription: '',
      storeLogo: '',
      storeHours: '9:00 AM - 6:00 PM',
      shippingInfo: 'Free shipping on orders over ₦5,000',
      returnPolicy: '30 days return policy',
      businessType: 'Individual',
      taxId: '',
      bankAccount: ''
    };
  }

  const store = account.storeInfo;

  container.innerHTML = `
    <form onsubmit="saveStoreSettings(event)" class="space-y-4">
      <!-- Basic Info Section -->
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 class="font-black text-slate-900">Basic Information</h3>
        
        <label class="mt-4 block text-sm font-semibold text-slate-700">
          Store name
          <input type="text" id="storeNameInput" value="${store.storeName}" required class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="Your store name" />
        </label>

        <label class="mt-3 block text-sm font-semibold text-slate-700">
          Store email
          <input type="email" id="storeEmailInput" value="${store.storeEmail}" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="store@example.com" />
        </label>

        <label class="mt-3 block text-sm font-semibold text-slate-700">
          Store phone
          <input type="tel" id="storePhoneInput" value="${store.storePhone}" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="+234 (0) 123 456 7890" />
        </label>

        <label class="mt-3 block text-sm font-semibold text-slate-700">
          Store location
          <input type="text" id="storeLocationInput" value="${store.storeLocation}" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="City, State" />
        </label>
      </div>

      <!-- Store Description Section -->
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 class="font-black text-slate-900">Store Profile</h3>
        
        <label class="mt-4 block text-sm font-semibold text-slate-700">
          Store description
          <textarea id="storeDescriptionInput" rows="3" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="Tell customers about your store...">${store.storeDescription}</textarea>
        </label>

        <label class="mt-3 block text-sm font-semibold text-slate-700">
          Store logo URL
          <input type="url" id="storeLogoInput" value="${store.storeLogo}" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="https://example.com/logo.jpg" />
        </label>

        <label class="mt-3 block text-sm font-semibold text-slate-700">
          Business type
          <select id="businessTypeInput" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm">
            <option value="Individual" ${store.businessType === 'Individual' ? 'selected' : ''}>Individual seller</option>
            <option value="Business" ${store.businessType === 'Business' ? 'selected' : ''}>Registered business</option>
            <option value="Enterprise" ${store.businessType === 'Enterprise' ? 'selected' : ''}>Enterprise</option>
          </select>
        </label>
      </div>

      <!-- Operating Hours Section -->
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 class="font-black text-slate-900">Operating Hours</h3>
        
        <label class="mt-4 block text-sm font-semibold text-slate-700">
          Store hours
          <input type="text" id="storeHoursInput" value="${store.storeHours}" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="9:00 AM - 6:00 PM" />
        </label>
      </div>

      <!-- Policies Section -->
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 class="font-black text-slate-900">Policies & Shipping</h3>
        
        <label class="mt-4 block text-sm font-semibold text-slate-700">
          Shipping information
          <input type="text" id="shippingInfoInput" value="${store.shippingInfo}" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="Free shipping on orders over ₦5,000" />
        </label>

        <label class="mt-3 block text-sm font-semibold text-slate-700">
          Return policy
          <input type="text" id="returnPolicyInput" value="${store.returnPolicy}" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="30 days return policy" />
        </label>
      </div>

      <!-- Tax & Banking Section -->
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 class="font-black text-slate-900">Tax & Banking</h3>
        
        <label class="mt-4 block text-sm font-semibold text-slate-700">
          Tax ID (optional)
          <input type="text" id="taxIdInput" value="${store.taxId}" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="Your tax identification number" />
        </label>

        <label class="mt-3 block text-sm font-semibold text-slate-700">
          Bank account (last 4 digits)
          <input type="text" id="bankAccountInput" value="${store.bankAccount}" maxlength="4" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm" placeholder="Last 4 digits" />
        </label>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-2 pt-4">
        <button type="submit" class="flex-1 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white hover:bg-orange-600">
          Save changes
        </button>
        <button type="button" onclick="closeModal('storeSettingsModal')" class="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  `;
}

function saveStoreSettings(event) {
  event.preventDefault();

  const previousStoreName = account.storeInfo?.storeName || account.name || '';
  const previousAccountName = account.name || '';
  account.storeInfo = {
    storeName: document.getElementById('storeNameInput').value.trim(),
    storeEmail: document.getElementById('storeEmailInput').value.trim(),
    storePhone: document.getElementById('storePhoneInput').value.trim(),
    storeLocation: document.getElementById('storeLocationInput').value.trim(),
    storeDescription: document.getElementById('storeDescriptionInput').value.trim(),
    storeLogo: document.getElementById('storeLogoInput').value.trim(),
    businessType: document.getElementById('businessTypeInput').value,
    storeHours: document.getElementById('storeHoursInput').value.trim(),
    shippingInfo: document.getElementById('shippingInfoInput').value.trim(),
    returnPolicy: document.getElementById('returnPolicyInput').value.trim(),
    taxId: document.getElementById('taxIdInput').value.trim(),
    bankAccount: document.getElementById('bankAccountInput').value.trim()
  };

  products.forEach(product => {
    if (product.seller === previousStoreName || product.seller === previousAccountName) {
      product.seller = account.storeInfo.storeName || account.name || product.seller;
      product.location = account.storeInfo.storeLocation || product.location;
      product.storeLocation = product.location;
    }
  });

  saveState();
  showToast('Store settings saved successfully');
  closeModal('storeSettingsModal');
  renderDashboard();
  renderHome();
  renderShop();
}

function toggleNewsletter(enabled) {
  account.preferences = account.preferences || {};
  account.preferences.newsletter = !!enabled;
  saveState();
  showToast(enabled ? 'Subscribed to newsletter' : 'Unsubscribed from newsletter');
}

function renderRecentActivity() {
  const container = document.getElementById('recentActivityList');
  if (!container) return;
  const items = [];
  // recent orders (up to 3)
  const recentOrders = orders.slice().reverse().slice(0, 3);
  recentOrders.forEach(o => items.push({type: 'order', text: `Order #${o.id} — ${o.items?.length || 0} items • ${o.status || 'Placed'}`}));
  // recent wishlist additions (best-effort)
  if (wishlist.length) items.push({type: 'wishlist', text: `Added ${wishlist.length} item(s) to wishlist`});
  // recent reviews
  const reviewKeys = Object.keys(reviewsStore||{}).slice(-3).reverse();
  reviewKeys.forEach(k => items.push({type: 'review', text: `Left a review for ${reviewsStore[k].productName || 'a product'}`}));

  if (!items.length) {
    container.innerHTML = `<p class="text-sm text-slate-500">No recent activity.</p>`;
    return;
  }

  container.innerHTML = items.map(it => `
    <div class="flex items-start gap-3 py-3 border-b border-slate-100">
      <div class="h-9 w-9 shrink-0 rounded-xl bg-slate-50 grid place-items-center text-slate-700">
        <i data-lucide="${it.type === 'order' ? 'package' : it.type === 'review' ? 'message-circle' : 'heart'}" class="h-4 w-4"></i>
      </div>
      <div>
        <p class="text-sm font-semibold text-slate-800">${it.text}</p>
      </div>
    </div>
  `).join('');
  refreshIcons();
}

function paymentBrandClass(type = '') {
  const value = type.toLowerCase();
  if (value.includes('visa') || value === 'card payment') return 'bg-blue-50';
  if (value.includes('master')) return 'bg-red-50';
  if (value.includes('paypal')) return 'bg-sky-50';
  if (value.includes('flutter') || value === 'mobile wallet') return 'bg-amber-50';
  if (value.includes('paystack')) return 'bg-cyan-50';
  return 'bg-emerald-50';
}

function paymentBrandLogo(type = '') {
  const value = type.toLowerCase();
  if (value === 'card payment') type = 'Visa card';
  if (value === 'mobile wallet') type = 'Flutterwave';
  const normalizedValue = type.toLowerCase();
  const logos = {
    visa: ['https://cdn.simpleicons.org/visa/1A1F71', 'Visa logo'],
    mastercard: ['https://cdn.simpleicons.org/mastercard/EB001B', 'Mastercard logo'],
    paypal: ['https://cdn.simpleicons.org/paypal/003087', 'PayPal logo'],
    flutterwave: ['https://cdn.simpleicons.org/flutterwave/F5A623', 'Flutterwave logo'],
    paystack: ['https://cdn.simpleicons.org/paystack/00C3F7', 'Paystack logo']
  };
  const key = Object.keys(logos).find(name => normalizedValue.includes(name));
  return key ? `<img src="${logos[key][0]}" alt="${logos[key][1]}" class="h-6 w-auto max-w-12 object-contain" />` : '<i data-lucide="landmark" class="h-5 w-5 text-emerald-600"></i>';
}

function paymentOptionCard(type, logoUrl, colorClass) {
  const logo = logoUrl
    ? `<img src="${logoUrl}" alt="${type} logo" class="h-6 w-auto max-w-12 object-contain" />`
    : '<i data-lucide="landmark" class="h-5 w-5 text-emerald-600"></i>';
  return `
    <button type="button" data-payment-option="${type}" onclick="selectPaymentType('${type}')" class="payment-option group flex min-h-20 flex-col items-start justify-between rounded-2xl border ${colorClass} p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm">
      <span class="grid h-8 w-12 place-items-center rounded-lg bg-white shadow-sm">${logo}</span>
      <span class="mt-2 text-[11px] font-bold leading-4 text-slate-700">${type}</span>
    </button>
  `;
}

function selectPaymentType(type) {
  const select = document.getElementById('paymentType');
  if (!select) return;
  if (type === 'Card payment') type = 'Visa card';
  if (type === 'Mobile wallet') type = 'Flutterwave';
  select.value = type;
  document.querySelectorAll('[data-payment-option]').forEach(option => {
    const selected = option.dataset.paymentOption === type;
    option.classList.toggle('ring-2', selected);
    option.classList.toggle('ring-orange-400', selected);
    option.classList.toggle('shadow-md', selected);
  });
}

function renderAccountModal(activeTab) {
  const tabButton = (tab, label, icon) => `
    <button onclick="renderAccountModal('${tab}')" class="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold ${activeTab === tab ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'}">
      <i data-lucide="${icon}" class="h-4 w-4"></i>
      ${label}
    </button>
  `;

  const profileContent = `
    <form onsubmit="saveAccountSettings(event)" class="space-y-5">
      <div class="flex items-center gap-4 rounded-[28px] border border-slate-200 bg-slate-50 p-4">
        <div class="relative shrink-0">
          <div id="profilePhotoPreview" class="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-orange-100 text-2xl font-black text-orange-600 ring-4 ring-white shadow-md">
            ${account.avatar ? `<img src="${account.avatar}" alt="Profile photo preview" class="h-full w-full object-cover" />` : (account.name || account.username || '?').charAt(0).toUpperCase()}
          </div>
          <label for="profileImageInput" aria-label="Upload profile photo" class="absolute -bottom-1 -right-1 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-orange-500 text-white shadow-lg ring-4 ring-slate-50 transition hover:bg-orange-600">
            <i data-lucide="camera" class="h-4 w-4"></i>
          </label>
          <input id="profileImageInput" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" onchange="handleProfileImageUpload(event)" />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-black text-slate-900">Profile photo</p>
          <p class="mt-1 text-xs leading-5 text-slate-500">Use a clear square image. It will appear across your account.</p>
          <button type="button" onclick="removeProfileImage()" class="mt-2 text-xs font-bold text-slate-500 transition hover:text-red-500 ${account.avatar ? '' : 'hidden'}">Remove photo</button>
        </div>
      </div>
      <div class="rounded-[28px] border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-5">
        <div class="flex items-start gap-3">
          <div class="grid h-11 w-11 place-items-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-200"><i data-lucide="user-round-pen" class="h-5 w-5"></i></div>
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-orange-600">Personal details</p>
            <h4 class="mt-1 text-xl font-black text-slate-900">Keep your profile current</h4>
            <p class="mt-1 text-xs leading-5 text-slate-500">These details help us personalize checkout and delivery updates.</p>
          </div>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block text-sm font-bold text-slate-700">Full name
          <span class="relative mt-2 block"><i data-lucide="user" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"></i><input id="accountName" type="text" class="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100" value="${account.name}" placeholder="Enter your name" required /></span>
        </label>
        <label class="block text-sm font-bold text-slate-700">Phone number <span class="font-normal text-slate-400">(optional)</span>
          <span class="relative mt-2 block"><i data-lucide="phone" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"></i><input id="accountPhone" type="tel" class="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100" value="${account.phone}" placeholder="+234 800 000 0000" /></span>
        </label>
      </div>
      <label class="block text-sm font-bold text-slate-700">Email address
        <span class="relative mt-2 block"><i data-lucide="mail" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"></i><input id="accountEmail" type="email" class="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100" value="${account.email}" placeholder="user@example.com" required /></span>
      </label>

      <div class="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex gap-2">
          <button type="button" onclick="exportAccount()" class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 transition hover:border-orange-200 hover:bg-orange-50"><i data-lucide="download" class="h-4 w-4"></i> Export</button>
          <button type="button" onclick="document.getElementById('accountImportInput').click()" class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 transition hover:border-orange-200 hover:bg-orange-50"><i data-lucide="upload" class="h-4 w-4"></i> Import</button>
        </div>
        <button type="submit" class="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600"><i data-lucide="check" class="h-4 w-4"></i> Save profile</button>
      </div>
      <button type="button" onclick="deactivateAccount()" class="inline-flex items-center gap-2 text-xs font-bold text-red-500 transition hover:text-red-700"><i data-lucide="user-round-x" class="h-4 w-4"></i> Deactivate account</button>
    </form>
  `;

  const addressContent = `
    <div class="space-y-4">
      <p class="text-sm text-slate-500">Manage your saved delivery addresses. Use the add button to create a new address.</p>
      <div id="addressesList" class="space-y-3">
        ${account.addresses && account.addresses.length ? account.addresses.map((a, i) => `
          <div class="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 p-3">
            <div>
              <p class="text-sm font-semibold text-slate-800">${a.label || `Address ${i+1}`}</p>
              <p class="mt-1 text-sm text-slate-500">${a.address}</p>
            </div>
            <div class="flex gap-2">
              <button type="button" onclick="editAddress(${i})" class="rounded-2xl border border-slate-200 px-3 py-2 text-sm">Edit</button>
              <button type="button" onclick="deleteAddress(${i})" class="rounded-2xl border border-red-200 px-3 py-2 text-sm text-red-600">Delete</button>
            </div>
          </div>
        `).join('') : '<p class="text-sm text-slate-500">No addresses saved yet.</p>'}
      </div>

      <div id="addressFormWrap" class="hidden">
        <form id="addressForm" onsubmit="saveAddressForm(event)">
          <label class="block text-sm font-semibold text-slate-700">
            Label (e.g., Home, Office)
            <input id="addressLabel" type="text" class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
          </label>
          <label class="block text-sm font-semibold text-slate-700">
            Full address
            <textarea id="addressValue" rows="3" required class="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"></textarea>
          </label>
          <div class="flex gap-2">
            <button type="submit" class="mt-2 rounded-3xl bg-orange-500 px-4 py-2 text-sm font-black text-white">Save address</button>
            <button type="button" onclick="hideAddressForm()" class="mt-2 rounded-3xl border border-slate-200 px-4 py-2 text-sm">Cancel</button>
          </div>
        </form>
      </div>

      <button type="button" onclick="showAddressForm()" class="mt-2 rounded-3xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">Add new address</button>
    </div>
  `;

  const paymentContent = `
    <div class="space-y-5">
      <div class="rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-5 text-white shadow-lg shadow-slate-200/50">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-orange-300">Payment wallet</p>
            <h4 class="mt-2 text-xl font-black">Your saved methods</h4>
            <p class="mt-1 max-w-sm text-xs leading-5 text-slate-300">Choose a trusted payment option for faster checkout.</p>
          </div>
          <span class="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-orange-300 ring-1 ring-white/10"><i data-lucide="wallet-cards" class="h-5 w-5"></i></span>
        </div>
        <div class="mt-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400"><i data-lucide="lock-keyhole" class="h-3.5 w-3.5 text-emerald-300"></i> Encrypted and private</div>
      </div>

      <div id="paymentList" class="space-y-3">
        ${account.paymentMethods && account.paymentMethods.length ? account.paymentMethods.map((p, i) => `
          <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div class="grid h-11 w-14 shrink-0 place-items-center rounded-xl ${paymentBrandClass(p.type)}">${paymentBrandLogo(p.type)}</div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold text-slate-800">${p.label || p.type || `Card ${i+1}`}</p>
              <p class="mt-1 text-xs text-slate-500">${p.type} ${p.last4 ? `• **** ${p.last4}` : ''}</p>
            </div>
            <div class="flex shrink-0 gap-1.5">
              <button type="button" onclick="editPayment(${i})" aria-label="Edit payment method" class="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"><i data-lucide="pencil" class="h-4 w-4"></i></button>
              <button type="button" onclick="deletePayment(${i})" aria-label="Delete payment method" class="grid h-9 w-9 place-items-center rounded-xl border border-red-100 text-red-500 transition hover:bg-red-50"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
            </div>
          </div>
        `).join('') : '<p class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">No payment methods saved yet.</p>'}
      </div>

      <div id="paymentFormWrap" class="hidden rounded-[28px] border border-orange-100 bg-orange-50/50 p-4">
        <form id="paymentForm" onsubmit="savePaymentForm(event)" class="space-y-4">
          <div>
            <p class="text-sm font-black text-slate-900">Choose a payment option</p>
            <p class="mt-1 text-xs text-slate-500">Your payment details stay securely on this device.</p>
          </div>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            ${paymentOptionCard('Visa card', 'https://cdn.simpleicons.org/visa/1A1F71', 'bg-blue-50 border-blue-100')}
            ${paymentOptionCard('Mastercard', 'https://cdn.simpleicons.org/mastercard/EB001B', 'bg-red-50 border-red-100')}
            ${paymentOptionCard('PayPal', 'https://cdn.simpleicons.org/paypal/003087', 'bg-sky-50 border-sky-100')}
            ${paymentOptionCard('Flutterwave', 'https://flutterwave.com/images/logo/full.svg', 'bg-amber-50 border-amber-100')}
            ${paymentOptionCard('Paystack', 'Assets/paystack-logo.svg', 'bg-cyan-50 border-cyan-100')}
            ${paymentOptionCard('Bank transfer', '', 'bg-emerald-50 border-emerald-100')}
          </div>
          <select id="paymentType" class="sr-only" aria-label="Payment type">
            <option value="Visa card">Visa card</option>
            <option value="Mastercard">Mastercard</option>
            <option value="PayPal">PayPal</option>
            <option value="Flutterwave">Flutterwave</option>
            <option value="Paystack">Paystack</option>
            <option value="Bank transfer">Bank transfer</option>
          </select>
          <label class="block text-sm font-semibold text-slate-700">Name this method
            <input id="paymentLabel" type="text" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" placeholder="e.g. Personal card" />
          </label>
          <label class="block text-sm font-semibold text-slate-700">Last 4 digits <span class="font-normal text-slate-400">(optional for transfers)</span>
            <input id="paymentLast4" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{0,4}" class="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" placeholder="1234" />
          </label>
          <div class="flex gap-2">
            <button type="submit" class="flex-1 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white transition hover:bg-orange-600">Save payment</button>
            <button type="button" onclick="hidePaymentForm()" class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Cancel</button>
          </div>
        </form>
      </div>

      <button type="button" onclick="showPaymentForm()" class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700"><i data-lucide="plus" class="h-4 w-4"></i> Add payment method</button>
    </div>
  `;

  const content = activeTab === "address" ? addressContent : activeTab === "payment" ? paymentContent : profileContent;

  document.getElementById("accountModalContent").innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-xs uppercase tracking-[0.3em] text-orange-500">Account settings</p>
        <h3 class="mt-3 text-lg font-black text-slate-900">${activeTab === "address" ? "Delivery address" : activeTab === "payment" ? "Payment settings" : "Edit profile"}</h3>
      </div>
      <div class="flex flex-wrap gap-2">
        ${tabButton("profile", "Profile", "user")}
        ${tabButton("address", "Address", "map-pin")}
        ${tabButton("payment", "Payment", "credit-card")}
      </div>
    </div>
    <div class="mt-6">${content}</div>
  `;

  refreshIcons();
  if (activeTab === 'payment' && document.getElementById('paymentType')) {
    selectPaymentType(document.getElementById('paymentType').value);
  }
}

function handleProfileImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith('image/')) {
    showToast('Choose a JPG, PNG, or WebP image.');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const size = 320;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      account.avatar = canvas.toDataURL('image/jpeg', 0.82);
      saveState();
      renderProfilePage();
      renderAccountModal('profile');
      showToast('Profile photo updated');
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function removeProfileImage() {
  account.avatar = '';
  saveState();
  renderProfilePage();
  renderAccountModal('profile');
  showToast('Profile photo removed');
}

function saveAccountSettings(event) {
  event.preventDefault();
  account.name = document.getElementById("accountName").value.trim() || account.name;
  account.email = document.getElementById("accountEmail").value.trim() || account.email;
  account.phone = document.getElementById("accountPhone").value.trim() || account.phone;
  saveState();
  renderProfilePage();
  renderAccountModal("profile");
  showToast("Profile updated successfully");
}

function saveDeliveryAddress(event) {
  event.preventDefault();
  // Deprecated: keep compatibility with single-address field
  const single = document.getElementById("accountAddress");
  if (single) {
    account.address = single.value.trim();
    saveState();
    renderAccountModal("address");
    showToast("Delivery address saved");
  }
}

function savePaymentSettings(event) {
  event.preventDefault();
  // Deprecated: keep compatibility with legacy single-payment form
  const pm = document.getElementById("accountPaymentMethod");
  if (pm) {
    account.paymentMethod = pm.value;
    account.cardName = document.getElementById("accountCardName").value.trim() || account.cardName;
    account.cardLast4 = document.getElementById("accountCardLast4").value.trim().slice(-4) || account.cardLast4;
    saveState();
    renderAccountModal("payment");
    showToast("Payment settings updated");
  }
}

// Address CRUD helpers
function showAddressForm(editIndex = null) {
  document.getElementById('addressFormWrap').classList.remove('hidden');
  if (editIndex !== null) {
    const addr = account.addresses[editIndex];
    document.getElementById('addressLabel').value = addr.label || '';
    document.getElementById('addressValue').value = addr.address || '';
    document.getElementById('addressForm').dataset.editIndex = editIndex;
  } else {
    document.getElementById('addressLabel').value = '';
    document.getElementById('addressValue').value = '';
    delete document.getElementById('addressForm').dataset.editIndex;
  }
}

function hideAddressForm() {
  document.getElementById('addressFormWrap').classList.add('hidden');
  delete document.getElementById('addressForm').dataset.editIndex;
}

function saveAddressForm(event) {
  event.preventDefault();
  const label = document.getElementById('addressLabel').value.trim();
  const addr = document.getElementById('addressValue').value.trim();
  if (!addr) { showToast('Address cannot be empty'); return; }
  account.addresses = account.addresses || [];
  const idx = document.getElementById('addressForm').dataset.editIndex;
  if (idx !== undefined) {
    account.addresses[Number(idx)] = { label, address: addr };
    showToast('Address updated');
  } else {
    account.addresses.push({ label, address: addr });
    showToast('Address added');
  }
  saveState();
  renderProfilePage();
  renderAccountModal('address');
}

function editAddress(i) { showAddressForm(i); }

function deleteAddress(i) {
  if (!confirm('Delete this address?')) return;
  account.addresses = account.addresses || [];
  account.addresses.splice(i,1);
  saveState();
  renderProfilePage();
  renderAccountModal('address');
  showToast('Address deleted');
}

// Payment CRUD helpers
function showPaymentForm(editIndex = null) {
  document.getElementById('paymentFormWrap').classList.remove('hidden');
  if (editIndex !== null) {
    const pm = account.paymentMethods[editIndex];
    document.getElementById('paymentLabel').value = pm.label || '';
    document.getElementById('paymentType').value = pm.type || 'Card payment';
    document.getElementById('paymentLast4').value = pm.last4 || '';
    document.getElementById('paymentForm').dataset.editIndex = editIndex;
    selectPaymentType(document.getElementById('paymentType').value);
  } else {
    document.getElementById('paymentLabel').value = '';
    document.getElementById('paymentType').value = 'Visa card';
    document.getElementById('paymentLast4').value = '';
    delete document.getElementById('paymentForm').dataset.editIndex;
    selectPaymentType('Visa card');
  }
}

function hidePaymentForm() {
  document.getElementById('paymentFormWrap').classList.add('hidden');
  delete document.getElementById('paymentForm').dataset.editIndex;
}

function savePaymentForm(event) {
  event.preventDefault();
  const label = document.getElementById('paymentLabel').value.trim();
  const type = document.getElementById('paymentType').value;
  const last4 = document.getElementById('paymentLast4').value.trim().slice(-4);
  if (!last4) { showToast('Enter last 4 digits'); return; }
  account.paymentMethods = account.paymentMethods || [];
  const idx = document.getElementById('paymentForm').dataset.editIndex;
  if (idx !== undefined) {
    account.paymentMethods[Number(idx)] = { label, type, last4 };
    showToast('Payment updated');
  } else {
    account.paymentMethods.push({ label, type, last4 });
    showToast('Payment method added');
  }
  saveState();
  renderProfilePage();
  renderAccountModal('payment');
}

function editPayment(i) { showPaymentForm(i); }

function deletePayment(i) {
  if (!confirm('Delete this payment method?')) return;
  account.paymentMethods = account.paymentMethods || [];
  account.paymentMethods.splice(i,1);
  saveState();
  renderProfilePage();
  renderAccountModal('payment');
  showToast('Payment method removed');
}

function exportAccount() {
  const payload = {
    account,
    currentUser,
    wishlist,
    cart,
    orders,
    reviewsStore
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zomax-account-${(account.username||'guest')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Account exported');
}

document.getElementById('accountImportInput')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    if (obj.account) account = Object.assign({}, defaultAccount, obj.account);
    if (obj.currentUser) currentUser = obj.currentUser;
    if (Array.isArray(obj.wishlist)) wishlist = obj.wishlist;
    if (Array.isArray(obj.cart)) cart = obj.cart;
    if (Array.isArray(obj.orders)) orders = obj.orders;
    if (obj.reviewsStore) reviewsStore = obj.reviewsStore;
    saveReviewsStore();
    saveState();
    renderProfilePage();
    closeModal('accountModal');
    showToast('Account imported');
  } catch (err) {
    console.error('Failed to import account', err);
    showToast('Invalid account file');
  } finally {
    e.target.value = '';
  }
});

function renderAuthState() {
  const authLabel = currentUser ? "Logout" : "Login";
  const accountLabel = currentUser ? (account.name ? `Hi, ${account.name.split(" ")[0]}` : "Account") : "Guest";
  document.getElementById("topbarAuthButton").textContent = authLabel;
  document.getElementById("mobileAuthButton").textContent = authLabel;
  document.getElementById("topbarAccountLabel").textContent = accountLabel;
}

function finalizeSellerRedirect() {
  const shouldOpenStoreSetup = window.pendingSellerRedirect === 'storeSettings';
  window.pendingSellerRedirect = null;

  ['storeAuthModal', 'loginModal'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) closeModal(id);
  });

  if (shouldOpenStoreSetup) {
    renderStoreSettings();
    openModal('storeSettingsModal');
    return true;
  }

  return false;
}

function openLoginModal() {
  document.getElementById("loginModalContent").innerHTML = `
    <div class="space-y-5">
      <div class="rounded-3xl border border-orange-100 bg-orange-50/60 p-4">
        <div class="flex items-center gap-3">
          <div class="grid h-11 w-11 place-items-center rounded-2xl bg-white text-orange-500 shadow-sm">
            <i data-lucide="user-round" class="h-5 w-5"></i>
          </div>
          <div>
            <p class="text-[10px] font-bold uppercase tracking-[0.24em] text-orange-600">Welcome back</p>
            <p class="mt-1 text-sm text-slate-600">Sign in to continue shopping and managing your account.</p>
          </div>
        </div>
      </div>

      <form onsubmit="login(event)" class="space-y-4">
        <div class="space-y-2">
          <label class="block text-sm font-semibold text-slate-700">Email address</label>
          <div class="relative">
            <span class="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400">
              <i data-lucide="mail" class="h-4 w-4"></i>
            </span>
            <input id="loginEmail" type="email" required class="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100" value="${currentUser?.email || ""}" placeholder="you@example.com" />
          </div>
        </div>

        <div class="space-y-2">
          <label class="block text-sm font-semibold text-slate-700">Password</label>
          <div class="relative">
            <span class="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400">
              <i data-lucide="lock" class="h-4 w-4"></i>
            </span>
            <input id="loginPassword" type="password" required class="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100" placeholder="Enter your password" />
          </div>
        </div>

        <button type="submit" class="w-full rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:brightness-105">Continue</button>
      </form>

      <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs text-slate-500">
        New here? <a href="#" onclick="navigate('signup'); closeModal('loginModal'); return false;" class="font-black text-orange-600">Create an account</a>
      </div>
    </div>
  `;
  openModal("loginModal");
  refreshIcons();
}

async function login(event) {
  event.preventDefault();
  const loginBtn = event.target.querySelector('button[type="submit"]');
  const originalText = loginBtn ? loginBtn.textContent : '';

  try {
    const emailInput = document.getElementById("loginEmail") || document.getElementById('pageLoginEmail');
    const passwordInput = document.getElementById("loginPassword") || document.getElementById('pageLoginPassword');
    const email = emailInput?.value.trim();
    const password = passwordInput?.value || '';
    if (!email || !password) throw new Error("Enter your email and password to continue.");

    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = 'Loading...';
      loginBtn.classList.add('opacity-50');
    }

    currentUser = await backend.login({ email, password });
    account.username = currentUser.username;
    account.name = currentUser.name;
    account.email = currentUser.email;
    account.memberSince = account.memberSince || currentUser.memberSince;
    saveState();
    renderProfilePage();
    renderAuthState();
    closeModal("loginModal");
    showToast(`Welcome back, ${currentUser.name}`);

    const shouldOpenStoreSetup = window.pendingSellerRedirect === 'storeSettings';
    window.pendingSellerRedirect = null;

    if (shouldOpenStoreSetup) {
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = originalText;
        loginBtn.classList.remove('opacity-50');
      }
      renderStoreSettings();
      openModal('storeSettingsModal');
      showToast('Welcome! Let’s set up your store.');
      return;
    }

    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = originalText;
      loginBtn.classList.remove('opacity-50');
    }
    navigate('profile');
  } catch (error) {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = originalText;
      loginBtn.classList.remove('opacity-50');
    }
    showToast(error.message || 'Unable to sign in. Please try again.');
    console.error('Login failed', error);
  }
}

async function signup(event) {
  event.preventDefault();
  const signupBtn = event.target.querySelector('button[type="submit"]');
  const originalText = signupBtn ? signupBtn.textContent : '';

  try {
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    if (!name || !email || !password) { showToast('Complete the signup form'); return; }

    if (signupBtn) {
      signupBtn.disabled = true;
      signupBtn.textContent = 'Creating account...';
      signupBtn.classList.add('opacity-50');
    }

    currentUser = await backend.register({ name, email, password });
    account.username = currentUser.username;
    account.name = currentUser.name;
    account.email = currentUser.email;
    account.memberSince = account.memberSince || currentUser.memberSince;
    saveState();
    renderProfilePage();
    renderAuthState();

    if (window.pendingSellerRedirect === 'storeSettings') {
      window.pendingSellerRedirect = null;
      navigate('profile');
      renderStoreSettings();
      openModal('storeSettingsModal');
      showToast('Welcome! Let’s set up your store.');
      return;
    }

    navigate('profile');
    showToast(`Welcome, ${name}`);
  } catch (error) {
    showToast(error.message || 'Unable to create your account. Please try again.');
    console.error('Signup failed', error);
  } finally {
    if (signupBtn) {
      signupBtn.disabled = false;
      signupBtn.textContent = originalText;
      signupBtn.classList.remove('opacity-50');
    }
  }
}

async function logout() {
  await backend.logout();
  currentUser = null;
  account = { ...defaultAccount };
  saveState();
  renderProfilePage();
  renderAuthState();
  showToast("Logged out successfully");
}

async function deactivateAccount() {
  const ok = await showConfirm('Are you sure you want to deactivate your account? This will remove local profile data.');
  if (!ok) return;

  try { await backend.postJson('/api/account/deactivate', { username: account.username }, null); } catch (e) {}

  // Clear local session and personal data
  currentUser = null;
  account = { ...defaultAccount };
  reviewsStore = {};
  cart = [];
  wishlist = [];
  orders = [];

  localStorage.removeItem('zomax_currentUser');
  localStorage.removeItem('zomax_account');
  localStorage.removeItem('zomax_reviews');
  localStorage.removeItem('zomax_cart');
  localStorage.removeItem('zomax_wishlist');
  localStorage.removeItem('zomax_orders');

  saveReviewsStore();
  saveState();

  try { await backend.syncReviews(reviewsStore); } catch (e) {}
  try { await backend.syncAccount(account); } catch (e) {}

  renderProfilePage();
  renderAuthState();
  closeModal('accountModal');
  // Ensure any Deactivate buttons are hidden immediately
  const headerBtn = document.getElementById('profileDeactivateBtn');
  if (headerBtn) headerBtn.classList.add('hidden');
  const modalBtn = document.querySelector('#accountModal button[onclick="deactivateAccount()"]');
  if (modalBtn) modalBtn.classList.add('hidden');

  showToast('Account deactivated — local data cleared');
}

function showToast(message) {
  const toast = document.getElementById("toast");
  document.getElementById("toastMessage").textContent = message;
  toast.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

function submitReview(event, productId) {
  event.preventDefault();
  const authorEl = document.getElementById('reviewAuthor');
  const ratingEl = document.getElementById('reviewRating');
  const textEl = document.getElementById('reviewText');
  const author = authorEl ? authorEl.value.trim() : 'Anonymous';
  const rating = ratingEl ? ratingEl.value : 5;
  const text = textEl ? textEl.value.trim() : '';
  addReview(productId, { author, rating, text });
  renderProductModal(productId, 'reviews');
  refreshIcons();
  showToast('Thanks — your review has been added');
}

function setReviewStars(rating) {
  const input = document.getElementById('reviewRating');
  if (input) input.value = rating;
  document.querySelectorAll('.review-star').forEach(btn => {
    const val = Number(btn.getAttribute('data-value')) || 0;
    if (val <= rating) {
      btn.classList.add('text-amber-400');
      btn.classList.add('fill-amber-400');
    } else {
      btn.classList.remove('text-amber-400');
      btn.classList.remove('fill-amber-400');
    }
  });
}

async function deleteReview(productId, index) {
  const ok = await showConfirm('Delete this review?');
  if (!ok) return;
  const id = String(productId);
  if (!reviewsStore[id] || !reviewsStore[id][index]) return;
  reviewsStore[id].splice(index, 1);
  saveReviewsStore();
  // update product aggregates
  const product = products.find(p => p.id === productId);
  if (product) {
    const all = getReviewsForProduct(productId);
    const avg = all.length ? all.reduce((s,r) => s + r.rating, 0) / all.length : product.rating;
    product.rating = Number((avg || product.rating).toFixed(1));
    product.reviews = all.length;
  }
  saveState();
  // try to delete on backend, fallback to syncing full store
  backend.deleteReview(productId, index).catch(() => backend.syncReviews(reviewsStore).catch(() => {}));
  renderProductModal(productId, 'reviews');
  showToast('Review deleted');
}

function editReview(productId, index) {
  openEditReviewModal(productId, index);
}

function openEditReviewModal(productId, index) {
  const id = String(productId);
  const existing = reviewsStore[id] && reviewsStore[id][index];
  if (!existing) return;
  editingReviewProductId = productId;
  editingReviewIndex = index;
  const textEl = document.getElementById('editReviewText');
  const ratingEl = document.getElementById('editReviewRating');
  if (textEl) textEl.value = existing.text || '';
  if (ratingEl) ratingEl.value = existing.rating || 5;
  openModal('editReviewModal');
}

function saveEditedReview() {
  const productId = editingReviewProductId;
  const index = editingReviewIndex;
  if (productId == null || index == null) return closeModal('editReviewModal');
  const id = String(productId);
  const existing = reviewsStore[id] && reviewsStore[id][index];
  if (!existing) return closeModal('editReviewModal');
  const newText = document.getElementById('editReviewText').value.trim();
  const newRating = Number(document.getElementById('editReviewRating').value) || existing.rating;
  existing.text = String(newText);
  existing.rating = Math.max(1, Math.min(5, newRating));
  existing.createdAt = Date.now();
  saveReviewsStore();
  // update product aggregates
  const product = products.find(p => p.id === productId);
  if (product) {
    const all = getReviewsForProduct(productId);
    const avg = all.length ? all.reduce((s,r) => s + r.rating, 0) / all.length : product.rating;
    product.rating = Number((avg || product.rating).toFixed(1));
    product.reviews = all.length;
  }
  saveState();
  backend.saveReview(productId, existing).catch(() => backend.syncReviews(reviewsStore).catch(() => {}));
  closeModal('editReviewModal');
  renderProductModal(productId, 'reviews');
  showToast('Review updated');
}

document.getElementById("productModal").addEventListener("click", event => {
  if (event.target.id === "productModal") closeModal("productModal");
});

document.getElementById("checkoutModal").addEventListener("click", event => {
  if (event.target.id === "checkoutModal") closeModal("checkoutModal");
});

document.getElementById("loginModal").addEventListener("click", event => {
  if (event.target.id === "loginModal") closeModal("loginModal");
});

document.getElementById("accountModal").addEventListener("click", event => {
  if (event.target.id === "accountModal") closeModal("accountModal");
});

initializeApp();
