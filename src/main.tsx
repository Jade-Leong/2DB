import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Account = { id: string; name: string; role: string; shop: string | null };
type Product = {
  id: string;
  title: string;
  description: string;
  category: string;
  price_cents: number;
  photo_url: string | null;
  seller_name: string;
  shop: string;
  eligible: number;
};
type CartItem = { productId: string; quantity: number };
type Quote = {
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  code_valid: boolean;
};
type Order = {
  id: string;
  status: string;
  created_at: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  items: { title: string; quantity: number; unit_cents: number }[];
  payment: { id: string; amount_cents: number; status: string };
};
const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
const initialAccount = localStorage.getItem("loop-account") || "buyer-maya";
function readCart(id: string): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem(`loop-cart-${id}`) || "[]");
  } catch {
    return [];
  }
}
function App() {
  const [accountId, setAccountId] = useState(initialAccount),
    [accounts, setAccounts] = useState<Account[]>([]),
    [products, setProducts] = useState<Product[]>([]);
  const [route, setRoute] = useState(location.hash.slice(1) || "/"),
    [cart, setCart] = useState<CartItem[]>(() => readCart(initialAccount));
  const [category, setCategory] = useState("All finds"),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [code, setCode] = useState(""),
    [quote, setQuote] = useState<Quote | null>(null),
    [busy, setBusy] = useState(false),
    [orders, setOrders] = useState<Order[]>([]),
    [order, setOrder] = useState<Order | null>(null),
    [listings, setListings] = useState<Product[]>([]),
    [editing, setEditing] = useState<Product | null>(null);
  const account = accounts.find((a) => a.id === accountId);
  const buyer = account?.role === "buyer";
  async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { "X-Demo-Account": accountId };
    if (options.body && !(options.body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const response = await fetch(`/api${url}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  const body = (data: unknown) => ({
    method: "POST",
    body: JSON.stringify(data),
  });
  function go(path: string) {
    location.hash = path;
  }
  async function loadProducts() {
    setProducts(await api<Product[]>("/products"));
  }
  useEffect(() => {
    const handle = () => {
      setRoute(location.hash.slice(1) || "/");
      setError("");
      setNotice("");
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", handle);
    Promise.all([
      api<Account[]>("/accounts").then(setAccounts),
      loadProducts(),
    ]).catch((e) => setError(e.message));
    return () => removeEventListener("hashchange", handle);
  }, []);
  useEffect(() => {
    localStorage.setItem(`loop-cart-${accountId}`, JSON.stringify(cart));
  }, [cart, accountId]);
  useEffect(() => {
    let active = true;
    setOrder(null);
    setOrders([]);
    setEditing(null);
    setError("");
    setQuote(null);
    const run = async () => {
      if (route === "/orders") {
        const data = await api<Order[]>("/orders");
        if (active) setOrders(data);
      } else if (route.startsWith("/orders/")) {
        const data = await api<Order>(route);
        if (active) setOrder(data);
      } else if (route === "/sell") {
        const data = await api<Product[]>("/listings");
        if (active) setListings(data);
      }
    };
    run().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [route, accountId]);
  useEffect(() => {
    let active = true;
    setQuote(null);
    if ((route === "/cart" || route === "/checkout") && cart.length && buyer)
      api<Quote>("/quote", body({ items: cart, code }))
        .then((q) => {
          if (active) setQuote(q);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [route, cart, code, accountId, buyer]);
  function changeAccount(id: string) {
    localStorage.setItem("loop-account", id);
    setAccountId(id);
    setCart(readCart(id));
    setCode("");
    setNotice("");
    go("/");
  }
  function add(p: Product) {
    if (!buyer) {
      setError("Select a demo buyer to shop.");
      return;
    }
    setCart((c) => {
      const exists = c.find((i) => i.productId === p.id);
      return exists
        ? c.map((i) =>
            i.productId === p.id
              ? { ...i, quantity: Math.min(10, i.quantity + 1) }
              : i,
          )
        : [...c, { productId: p.id, quantity: 1 }];
    });
    setNotice(`${p.title} added to your bag.`);
  }
  async function checkout() {
    setBusy(true);
    setError("");
    try {
      const storageKey = `loop-pending-${accountId}`;
      const payload = JSON.stringify({ items: cart, code });
      let pending: { payload: string; key: string } | null = null;
      try {
        pending = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      } catch {}
      if (!pending || pending.payload !== payload) {
        pending = { payload, key: crypto.randomUUID() };
        sessionStorage.setItem(storageKey, JSON.stringify(pending));
      }
      const result = await api<Order>(
        "/checkout",
        body({ items: cart, code, requestKey: pending.key }),
      );
      sessionStorage.removeItem(storageKey);
      setCart([]);
      setCode("");
      go(`/orders/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveListing(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const price = String(data.get("price"));
      if (!/^\d+(\.\d{1,2})?$/.test(price))
        throw new Error("Use a price with up to two decimal places.");
      await api(editing?.id ? `/listings/${editing.id}` : "/listings", {
        method: editing?.id ? "PUT" : "POST",
        body: JSON.stringify({
          title: data.get("title"),
          description: data.get("description"),
          category: data.get("category"),
          price_cents: Math.round(Number(price) * 100),
        }),
      });
      setListings(await api("/listings"));
      await loadProducts();
      setEditing(null);
      setNotice("Your listing is saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadPhoto(p: Product, file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("photo", file);
      const updated = await api<Product>(`/listings/${p.id}/photo`, {
        method: "POST",
        body: data,
      });
      setListings((list) =>
        list.map((x) =>
          x.id === p.id ? { ...x, photo_url: updated.photo_url } : x,
        ),
      );
      setNotice("Photo uploaded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const product = products.find((p) => route === `/products/${p.id}`);
  const visible = products.filter(
    (p) =>
      (category === "All finds" || p.category === category) &&
      `${p.title} ${p.description} ${p.shop}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const photo = (p: Product, cls = "") =>
    p.photo_url ? (
      <img className={cls} src={p.photo_url} alt={p.title} />
    ) : (
      <div className={`placeholder ${cls}`}>
        Your next great find
        <br />
        <span>Photo coming soon</span>
      </div>
    );
  const title = (eyebrow: string, heading: string, sub: string) => (
    <div className="page-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{heading}</h1>
      <p>{sub}</p>
    </div>
  );
  const summary = (
    <div className="summary">
      <h2>A good little haul.</h2>
      <div>
        <span>Subtotal</span>
        <strong>{money(quote?.subtotal_cents ?? 0)}</strong>
      </div>
      <div>
        <span>Discount</span>
        <strong data-testid="discount">
          −{money(quote?.discount_cents ?? 0)}
        </strong>
      </div>
      <div>
        <span>Shipping & taxes</span>
        <span>$0.00</span>
      </div>
      <div className="total">
        <span>Total</span>
        <strong data-testid="checkout-total">
          {money(quote?.total_cents ?? 0)}
        </strong>
      </div>
      <p className="muted small">
        All amounts are simulated. No payment details needed.
      </p>
    </div>
  );
  return (
    <>
      <div className="demo-banner">
        Demo marketplace — all purchases and funds are simulated.
      </div>
      <header>
        <a href="#/" className="brand">
          <span className="brand-icon">∞</span>loop
          <span className="brand-sub">MARKET</span>
        </a>
        <nav>
          <a className={route === "/" ? "active" : ""} href="#/">
            Discover
          </a>
          <a
            className={route.startsWith("/orders") ? "active" : ""}
            href="#/orders"
          >
            My orders
          </a>
          <a className={route === "/sell" ? "active" : ""} href="#/sell">
            Sell with us
          </a>
        </nav>
        <a className="bag-link" href="#/cart">
          Bag <span>{cart.reduce((n, i) => n + i.quantity, 0)}</span>
        </a>
      </header>
      <div className="account-bar">
        <span>
          <i /> A neighborhood of good finds.
        </span>
        <label>
          Local-only demo account{" "}
          <select
            aria-label="Local-only demo account"
            value={accountId}
            onChange={(e) => changeAccount(e.target.value)}
          >
            {accounts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name} · {a.role}
              </option>
            ))}
          </select>
        </label>
      </div>
      <main>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="alert" role="status">
            {notice} {notice.includes("bag") && <a href="#/cart">View bag →</a>}
          </div>
        )}
        {route === "/" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="eyebrow">LESS ORDINARY. MORE YOU.</span>
                <h1>
                  Good things.
                  <br />
                  Another go.
                </h1>
                <p>
                  Discover pre-loved pieces and small-shop treasures.
                  <br className="desktop" /> A little character. A lot to love.
                </p>
                <button
                  onClick={() =>
                    document
                      .getElementById("finds")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Find your next favorite <span>↗</span>
                </button>
                <div className="hero-note">
                  <span>✳</span> Small sellers. Thoughtful finds. Full of
                  possibility.
                </div>
              </div>
              <div className="hero-art">
                <span className="orbit orbit-one" />
                <span className="orbit orbit-two" />
                <img
                  className="hero-vase"
                  src="/images/vase.png"
                  alt="Amber vase with a leafy branch"
                />
                <img
                  className="hero-knit"
                  src="/images/knit.png"
                  alt="Oat cotton sweater"
                />
                <div className="round-stamp">
                  GOOD FINDS
                  <br />
                  <span>✳</span>
                  <br />
                  GO AROUND
                </div>
                <span className="art-caption">
                  Objects with a next chapter.
                </span>
              </div>
            </section>
            <section className="perks">
              <span>↻ &nbsp; Give great things a second life</span>
              <span>♡ &nbsp; Shop from independent sellers</span>
              <span>✧ &nbsp; A little something, just for you</span>
            </section>
            <section id="finds" className="catalog">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">THE GOOD STUFF</span>
                  <h2>Find a little everyday joy.</h2>
                </div>
                <span className="muted">{visible.length} thoughtful finds</span>
              </div>
              <div className="filter-row">
                <div className="filters">
                  {["All finds", "Clothing", "Books", "Home"].map((c) => (
                    <button
                      className={category === c ? "selected" : ""}
                      key={c}
                      onClick={() => setCategory(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <input
                  className="search"
                  aria-label="Search products"
                  placeholder="Search for something lovely…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="product-grid">
                {visible.map((p) => (
                  <article className="product-card" key={p.id}>
                    <a className="product-image" href={`#/products/${p.id}`}>
                      {photo(p)}
                      <span className="category-tag">{p.category}</span>
                      <span className="view-circle">↗</span>
                    </a>
                    <div className="product-info">
                      <a href={`#/products/${p.id}`}>
                        <h3>{p.title}</h3>
                      </a>
                      <strong>{money(p.price_cents)}</strong>
                    </div>
                    <p className="seller-line">
                      {p.shop}{" "}
                      <span>
                        · {p.eligible ? "LOOP20 eligible" : "Special find"}
                      </span>
                    </p>
                  </article>
                ))}
              </div>
              {!visible.length && (
                <p className="empty">No finds yet. Try a different search.</p>
              )}
            </section>
            <section className="promo">
              <span className="promo-icon">✳</span>
              <div>
                <span className="eyebrow">A WARM WELCOME</span>
                <h2>Your first little loop starts here.</h2>
                <p>
                  Use <strong>LOOP20</strong> for 20% off eligible finds. Just a
                  little hello from us.
                </p>
              </div>
              <a href="#/support">Need a hand? →</a>
            </section>
          </>
        )}
        {route.startsWith("/products/") &&
          (product ? (
            <>
              <a className="back" href="#/">
                ← Back to all finds
              </a>
              <section className="product-detail">
                {photo(product, "detail-photo")}
                <div>
                  <span className="eyebrow">
                    {product.category} / PRE-LOVED & READY
                  </span>
                  <h1>{product.title}</h1>
                  <p className="detail-price">{money(product.price_cents)}</p>
                  <p>{product.description}</p>
                  <div className="seller-box">
                    <span className="avatar">{product.seller_name?.[0]}</span>
                    <div>
                      <strong>{product.shop}</strong>
                      <small>Listed by {product.seller_name}</small>
                    </div>
                  </div>
                  <p className="offer">
                    {product.eligible
                      ? "A little treat: 20% off with LOOP20."
                      : "A special find. Not eligible for LOOP20."}
                  </p>
                  <button disabled={!buyer} onClick={() => add(product)}>
                    Add to bag — {money(product.price_cents)}
                  </button>
                  {!buyer && (
                    <p className="muted">Select a buyer account to shop.</p>
                  )}
                  <p className="small muted">
                    Simulated checkout · Free demo shipping · No taxes
                  </p>
                </div>
              </section>
            </>
          ) : (
            <p>Loading your find…</p>
          ))}
        {(route === "/cart" || route === "/checkout") && (
          <>
            {title(
              "YOUR NEXT CHAPTER",
              route === "/cart" ? "The good-things bag." : "Make it yours.",
              "A few favorites, ready for a new home.",
            )}
            {!buyer ? (
              <div className="empty">
                Choose a buyer account to view a bag and check out.
              </div>
            ) : !cart.length ? (
              <div className="empty">
                <h2>Your bag has room for something good.</h2>
                <a className="button" href="#/">
                  Explore the marketplace ↗
                </a>
              </div>
            ) : (
              <div className="checkout-layout">
                <section>
                  <div className="cart-list">
                    {cart.map((item) => {
                      const p = products.find((p) => p.id === item.productId);
                      return p ? (
                        <article className="cart-row" key={p.id}>
                          {photo(p)}
                          <div>
                            <h3>
                              <a href={`#/products/${p.id}`}>{p.title}</a>
                            </h3>
                            <p className="muted">{p.shop}</p>
                            <strong>{money(p.price_cents)}</strong>
                          </div>
                          <div>
                            <label className="small">
                              Quantity{" "}
                              <select
                                aria-label={`Quantity for ${p.title}`}
                                value={item.quantity}
                                onChange={(e) =>
                                  setCart(
                                    cart.map((i) =>
                                      i.productId === p.id
                                        ? {
                                            ...i,
                                            quantity: Number(e.target.value),
                                          }
                                        : i,
                                    ),
                                  )
                                }
                              >
                                {Array.from({ length: 10 }, (_, i) => (
                                  <option key={i}>{i + 1}</option>
                                ))}
                              </select>
                            </label>
                            <button
                              className="text-button"
                              onClick={() =>
                                setCart(
                                  cart.filter((i) => i.productId !== p.id),
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        </article>
                      ) : null;
                    })}
                  </div>
                  {route === "/checkout" && (
                    <div className="panel">
                      <h2>A little extra joy.</h2>
                      <label htmlFor="discount">Discount code</label>
                      <input
                        id="discount"
                        placeholder="Try LOOP20"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                      />
                      {code && quote && (
                        <p
                          className={quote.code_valid ? "valid" : "muted"}
                          role="status"
                        >
                          {quote.code_valid
                            ? "LOOP20 applied to eligible items."
                            : "This code is not valid. No discount applied."}
                        </p>
                      )}
                      <p className="small muted">
                        LOOP20 gives 20% off eligible items. No shipping fees or
                        taxes.
                      </p>
                    </div>
                  )}
                </section>
                <aside>
                  {summary}
                  {route === "/cart" ? (
                    <a className="button full" href="#/checkout">
                      Continue to checkout →
                    </a>
                  ) : (
                    <button
                      className="full"
                      disabled={busy || !quote}
                      onClick={checkout}
                    >
                      {busy ? "Placing your order…" : "Place simulated order"}
                    </button>
                  )}
                  <p className="small muted">Shopping as {account?.name}</p>
                </aside>
              </div>
            )}
          </>
        )}
        {route === "/orders" && (
          <>
            {title(
              "YOUR FINDS, ALL TOGETHER",
              "My orders.",
              "Keep track of the things you’ve made yours.",
            )}
            {buyer && !orders.length && !error && (
              <div className="empty">
                <span className="empty-icon">↻</span>
                <h2>No orders here yet.</h2>
                <p>Your finds will have a home here.</p>
                <a className="button" href="#/">
                  Discover something good ↗
                </a>
              </div>
            )}
            {orders.map((o) => (
              <a className="order-row" key={o.id} href={`#/orders/${o.id}`}>
                <div>
                  <strong>Order {o.id.slice(0, 8)}</strong>
                  <p>{new Date(o.created_at).toLocaleString()}</p>
                </div>
                <span className="pill">{o.status}</span>
                <strong>{money(o.total_cents)} →</strong>
              </a>
            ))}
          </>
        )}
        {route.startsWith("/orders/") && order && (
          <>
            {title(
              "THANK YOU FOR SHOPPING SMALL",
              "A good find, made yours.",
              "Your simulated payment is complete. Keep this receipt for your records.",
            )}
            <div className="checkout-layout">
              <section className="panel">
                <div className="section-heading">
                  <h2>Order details</h2>
                  <span className="pill">{order.status}</span>
                </div>
                <p className="small muted">
                  Order <span data-testid="order-id">{order.id}</span>
                  <br />
                  {new Date(order.created_at).toLocaleString()}
                </p>
                {order.items.map((i, n) => (
                  <div className="receipt-item" key={n}>
                    <span>
                      {i.title} × {i.quantity}
                    </span>
                    <strong>{money(i.unit_cents * i.quantity)}</strong>
                  </div>
                ))}
                <a className="back" href="#/orders">
                  View order history →
                </a>
              </section>
              <aside className="summary">
                <h2>Your receipt</h2>
                <div>
                  <span>Subtotal</span>
                  <strong>{money(order.subtotal_cents)}</strong>
                </div>
                <div>
                  <span>Discount</span>
                  <strong>−{money(order.discount_cents)}</strong>
                </div>
                <div className="total">
                  <span>Order total</span>
                  <strong data-testid="order-total">
                    {money(order.total_cents)}
                  </strong>
                </div>
                <div>
                  <span>Simulated payment</span>
                  <strong data-testid="payment-total">
                    {money(order.payment.amount_cents)}
                  </strong>
                </div>
                <p className="small muted">
                  Payment {order.payment.status}
                  <br />
                  <span className="break">{order.payment.id}</span>
                </p>
                <a href="#/support">Something amiss? Contact support →</a>
              </aside>
            </div>
          </>
        )}
        {route === "/sell" && (
          <>
            {title(
              "GOOD THINGS START WITH YOU",
              "Your little shop.",
              "Make room for the next chapter. List something someone will love.",
            )}
            {account?.role === "seller" && (
              <>
                <div className="section-heading">
                  <h2>{account.shop}</h2>
                  <button
                    onClick={() =>
                      setEditing({
                        id: "",
                        title: "",
                        description: "",
                        category: "Home",
                        price_cents: 100,
                        photo_url: null,
                        seller_name: account.name,
                        shop: account.shop || "",
                        eligible: 1,
                      })
                    }
                  >
                    + Create listing
                  </button>
                </div>
                {editing && (
                  <form
                    className="panel listing-form"
                    key={editing.id}
                    onSubmit={saveListing}
                  >
                    <h2>{editing.id ? "Edit listing" : "A new little find"}</h2>
                    <label>
                      Title
                      <input
                        name="title"
                        required
                        maxLength={100}
                        defaultValue={editing.title}
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        name="description"
                        required
                        maxLength={2000}
                        defaultValue={editing.description}
                      />
                    </label>
                    <div className="form-pair">
                      <label>
                        Category
                        <select name="category" defaultValue={editing.category}>
                          {["Clothing", "Books", "Home"].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Price ($)
                        <input
                          name="price"
                          type="number"
                          min="0.01"
                          max="10000"
                          step="0.01"
                          required
                          defaultValue={(editing.price_cents / 100).toFixed(2)}
                        />
                      </label>
                    </div>
                    <div className="actions">
                      <button disabled={busy}>Save listing</button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                <div className="listing-grid">
                  {listings.map((p) => (
                    <article
                      className="listing-card"
                      key={p.id}
                      data-testid={`listing-${p.id}`}
                    >
                      {photo(p)}
                      <div>
                        <span className="eyebrow">{p.category}</span>
                        <h3>{p.title}</h3>
                        <p>{money(p.price_cents)}</p>
                        <button
                          className="secondary"
                          onClick={() => setEditing(p)}
                        >
                          Edit listing
                        </button>
                        <label className="upload-label">
                          Upload photo
                          <input
                            aria-label={`Upload photo for ${p.title}`}
                            type="file"
                            accept="image/png,image/jpeg"
                            disabled={busy}
                            onChange={(e) => {
                              uploadPhoto(p, e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <small className="muted">
                          PNG or JPEG · up to 2 MB
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {route === "/support" && (
          <>
            {title(
              "WE’RE HERE FOR THE LITTLE THINGS",
              "Let’s sort it out.",
              "Tell us what happened. Your complaint will be saved in this local demo.",
            )}
            <form
              className="panel support-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  data = new FormData(form);
                setBusy(true);
                setError("");
                try {
                  const result = await api<{ id: string }>(
                    "/support",
                    body({
                      subject: data.get("subject"),
                      message: data.get("message"),
                    }),
                  );
                  setNotice(`Support ticket saved. Reference: ${result.id}`);
                  form.reset();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="muted">Submitting as {account?.name}</p>
              <label>
                Subject
                <input
                  name="subject"
                  required
                  maxLength={150}
                  placeholder="What can we help with?"
                />
              </label>
              <label>
                What happened?
                <textarea
                  name="message"
                  required
                  maxLength={5000}
                  rows={6}
                  placeholder="Include your order reference or listing name if you have one."
                />
              </label>
              <p className="small muted">
                Please use fictional information. This demo does not send
                messages to a support team.
              </p>
              <button disabled={busy}>Submit complaint</button>
            </form>
          </>
        )}
      </main>
      <footer>
        <a href="#/" className="brand">
          <span className="brand-icon">∞</span>loop
          <span className="brand-sub">MARKET</span>
        </a>
        <p>Good things deserve another chapter.</p>
        <a href="#/support">Support ↗</a>
        <span className="small">A fictional marketplace · Built for 2DB</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
