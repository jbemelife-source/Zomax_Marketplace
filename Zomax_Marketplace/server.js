const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const app = express();
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");

const files = {
  products: path.join(dataDir, "products.json"),
  cart: path.join(dataDir, "cart.json"),
  wishlist: path.join(dataDir, "wishlist.json"),
  orders: path.join(dataDir, "orders.json"),
  account: path.join(dataDir, "account.json"),
  reviews: path.join(dataDir, "reviews.json"),
  currentUser: path.join(dataDir, "currentUser.json"),
  users: path.join(dataDir, "users.json"),
  sessions: path.join(dataDir, "sessions.json")
};

const defaultAccount = {
  name: "",
  username: "",
  email: "",
  phone: "",
  address: "",
  paymentMethod: "",
  cardName: "",
  cardLast4: "",
  memberSince: ""
};

async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });

  const defaults = {
    products: [],
    cart: [],
    wishlist: [],
    orders: [],
    account: defaultAccount,
    reviews: {},
    currentUser: null,
    users: [],
    sessions: []
  };

  await Promise.all(
    Object.entries(files).map(async ([key, filePath]) => {
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, JSON.stringify(defaults[key], null, 2), "utf8");
      }
    })
  );
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function publicUser(user) {
  return { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role, memberSince: user.memberSince };
}

function requestToken(req) {
  const authorization = req.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const sessions = await readJson(files.sessions, []);
  const now = Date.now();
  const activeSessions = sessions.filter(session => session.expiresAt > now);
  activeSessions.push({ tokenHash: hashSessionToken(token), userId, expiresAt: now + 30 * 24 * 60 * 60 * 1000 });
  await writeJson(files.sessions, activeSessions);
  return token;
}

async function findSessionUser(req) {
  const token = requestToken(req);
  if (!token) return null;
  const sessions = await readJson(files.sessions, []);
  const tokenHash = hashSessionToken(token);
  const session = sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
  if (!session) return null;
  const users = await readJson(files.users, []);
  return users.find(user => user.id === session.userId) || null;
}

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function passwordsMatch(password, salt, expectedHash) {
  const actual = Buffer.from(passwordHash(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    environment: process.env.NODE_ENV || "development",
    time: new Date().toISOString()
  });
});

app.get("/api/products", async (req, res) => {
  const products = await readJson(files.products, []);
  res.json(products);
});

app.post("/api/products", async (req, res) => {
  const body = req.body || {};
  const { name, category, price, image, description, seller, location, stock } = body;
  if (!name || !category || !price) {
    return res.status(400).json({ error: "Missing required product fields" });
  }

  const products = await readJson(files.products, []);
  const newProduct = {
    id: Date.now(),
    name,
    category,
    price: Number(price),
    oldPrice: body.oldPrice ? Number(body.oldPrice) : null,
    rating: Number(body.rating || 5),
    reviews: Number(body.reviews || 0),
    seller: seller || "Marketplace seller",
    location: location || "Unknown",
    image: image || "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85",
    description: description || "Seller-listed product on Zomax.",
    deal: Boolean(body.deal),
    stock: Number(stock || 1),
    createdAt: new Date().toISOString()
  };

  products.unshift(newProduct);
  await writeJson(files.products, products);
  res.status(201).json(newProduct);
});

app.get("/api/products/:id/reviews", async (req, res) => {
  const reviews = await readJson(files.reviews, {});
  res.json(reviews[req.params.id] || []);
});

app.post("/api/products/:id/reviews", async (req, res) => {
  const reviews = await readJson(files.reviews, {});
  const productId = String(req.params.id);
  reviews[productId] = reviews[productId] || [];
  const review = {
    author: req.body.author || "Anonymous",
    rating: Number(req.body.rating || 5),
    text: req.body.text || "",
    createdAt: Date.now()
  };
  reviews[productId].push(review);
  await writeJson(files.reviews, reviews);
  res.status(201).json(review);
});

app.delete("/api/products/:id/reviews/:index", async (req, res) => {
  const reviews = await readJson(files.reviews, {});
  const productId = String(req.params.id);
  const index = Number(req.params.index);
  if (!Array.isArray(reviews[productId]) || index < 0 || index >= reviews[productId].length) {
    return res.status(404).json({ error: "Review not found" });
  }
  const [deleted] = reviews[productId].splice(index, 1);
  await writeJson(files.reviews, reviews);
  res.json(deleted || {});
});

app.post("/api/reviews", async (req, res) => {
  const reviews = await readJson(files.reviews, {});
  await writeJson(files.reviews, req.body || reviews);
  res.json(req.body || reviews);
});

app.get("/api/cart", async (req, res) => {
  const cart = await readJson(files.cart, []);
  res.json(cart);
});

app.post("/api/cart", async (req, res) => {
  const cart = req.body || [];
  await writeJson(files.cart, cart);
  res.json(cart);
});

app.get("/api/wishlist", async (req, res) => {
  const wishlist = await readJson(files.wishlist, []);
  res.json(wishlist);
});

app.post("/api/wishlist", async (req, res) => {
  const wishlist = req.body || [];
  await writeJson(files.wishlist, wishlist);
  res.json(wishlist);
});

app.get("/api/orders", async (req, res) => {
  const orders = await readJson(files.orders, []);
  res.json(orders);
});

app.post("/api/orders", async (req, res) => {
  const orders = req.body || [];
  await writeJson(files.orders, orders);
  res.json(orders);
});

app.get("/api/account", async (req, res) => {
  const account = await readJson(files.account, defaultAccount);
  res.json(account);
});

app.post("/api/account", async (req, res) => {
  const account = req.body || defaultAccount;
  await writeJson(files.account, account);
  res.json(account);
});

app.get("/api/auth/current-user", async (req, res) => {
  const user = await findSessionUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to continue." });
  res.json(publicUser(user));
});

app.post("/api/auth/register", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Enter your name (2 to 100 characters)." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Use a password between 8 and 128 characters." });

  const users = await readJson(files.users, []);
  if (users.some(user => user.email === email)) return res.status(409).json({ error: "An account already exists for this email. Sign in instead." });

  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: crypto.randomUUID(),
    username: email.split("@")[0],
    name,
    email,
    role: "buyer",
    memberSince: new Date().getFullYear().toString(),
    passwordSalt: salt,
    passwordHash: passwordHash(password, salt),
    createdAt: new Date().toISOString()
  };
  users.push(user);
  await writeJson(files.users, users);
  const token = await createSession(user.id);
  res.status(201).json({ user: publicUser(user), token });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const users = await readJson(files.users, []);
  const user = users.find(item => item.email === email);
  if (!user || !passwordsMatch(password, user.passwordSalt, user.passwordHash)) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  const token = await createSession(user.id);
  res.json({ user: publicUser(user), token });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = requestToken(req);
  if (token) {
    const sessions = await readJson(files.sessions, []);
    const tokenHash = hashSessionToken(token);
    await writeJson(files.sessions, sessions.filter(session => session.tokenHash !== tokenHash));
  }
  res.json({ success: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const port = Number(process.env.PORT) || 3000;

async function startServer() {
  await ensureDataFiles();
  app.listen(port, () => {
    console.log(`Zomax backend running on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
