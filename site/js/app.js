// Family-facing gallery: browse → cart → checkout. Payment happens later via a FutureFund invoice.
import { getApi } from "./api.js";
import { esc, money, fmtDateTime, pickupText, toast, friendlyError } from "./util.js";

const app = document.getElementById("app");
const CART_KEY = "ceramics-cart";
const LAST_ORDER_KEY = "ceramics-last-order";

let api, info, gallery = null, filter = "all";
let draft = {}; // what the family has typed into the checkout form (survives re-renders)

// ───── Cart (saved on this device) ─────
const cart = {
  get() { try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch { return []; } },
  set(items) { try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch {} renderCartCount(); },
  add(piece_id, qty) {
    const items = cart.get();
    const ex = items.find((i) => i.piece_id === piece_id);
    if (ex) ex.qty += qty; else items.push({ piece_id, qty });
    cart.set(items);
  },
  count() { return cart.get().reduce((s, i) => s + i.qty, 0); },
};

const pieceById = (id) => gallery?.pieces.find((p) => p.id === id);
const canCheckout = () => info.sale_state === "open";

// Keep the cart honest against current availability.
function reconcileCart() {
  if (!gallery) return [];
  const removed = [];
  const items = [];
  for (const it of cart.get()) {
    const p = pieceById(it.piece_id);
    if (!p || p.available <= 0) { removed.push(p?.title ?? "A piece"); continue; }
    items.push({ ...it, qty: Math.min(it.qty, p.available) });
  }
  cart.set(items);
  return removed;
}

// ───── Layout ─────
function shell(inner) {
  const demo = api.mode === "demo"
    ? `<div class="banner banner-demo">Demo mode — sample data stored only in your browser. <a href="admin.html">Open the admin portal</a> · <button class="linkish" data-act="reset-demo">Reset demo</button></div>` : "";
  const closed = info.sale_state === "closed"
    ? `<div class="banner banner-closed">The sale has ended — thank you for supporting our student artists!</div>`
    : info.sale_state === "paused" ? `<div class="banner banner-closed">Ordering is paused for the moment. Please check back soon.</div>` : "";
  return `${demo}
  <header class="site-header"><div class="wrap">
    <a class="brand" href="#/"><span class="school">${esc(info.school_name)}</span><span class="name">${esc(info.fundraiser_name)}</span></a>
    <nav class="nav" aria-label="Main">
      <a href="#/" class="hide-sm">Gallery</a>
      <a href="${esc(info.donate_url)}" target="_blank" rel="noopener">Donate</a>
      <a href="#/cart" class="cart-link">Cart <span class="badge-count ${cart.count() ? "" : "hidden"}" id="cart-count">${cart.count()}</span></a>
    </nav>
  </div></header>
  ${closed}
  <main id="main">${inner}</main>
  <footer class="footer"><div class="wrap row">
    <span>${esc(info.school_name)} · ${esc(info.fundraiser_name)}</span><span class="spacer"></span>
    <button class="linkish" data-act="signout">Sign out</button>
  </div></footer>`;
}
function renderCartCount() {
  const el = document.getElementById("cart-count");
  if (el) { el.textContent = cart.count(); el.classList.toggle("hidden", cart.count() === 0); }
}

// ───── Screens ─────
function viewComingSoon() {
  document.title = info.fundraiser_name;
  app.innerHTML = `
  ${api.mode === "demo" ? `<div class="banner banner-demo">Demo mode</div>` : ""}
  <div class="center-card">
    <div class="eyebrow">${esc(info.school_name)}</div>
    <h1>${esc(info.fundraiser_name)}</h1>
    <p class="muted">${esc(info.intro)}</p>
    <div class="panel" style="text-align:center">
      <div class="eyebrow">Coming soon</div>
      <p style="font-family:var(--serif);font-size:1.6rem;margin:.3em 0">The sale opens ${esc(fmtDateTime(info.sale_opens_at))}</p>
      <a class="btn btn-ghost" href="${esc(info.donate_url)}" target="_blank" rel="noopener">Make a donation</a>
    </div>
  </div>`;
}

function viewGate(error = "") {
  document.title = info.fundraiser_name;
  app.innerHTML = `
  ${api.mode === "demo" ? `<div class="banner banner-demo">Demo mode — the family password is <strong>clay</strong></div>` : ""}
  <div class="center-card">
    <div class="eyebrow">${esc(info.school_name)}</div>
    <h1>${esc(info.fundraiser_name)}</h1>
    <p class="muted">${esc(info.intro)}</p>
    <form class="panel" id="gate">
      <div class="field">
        <label for="pw">Family password</label>
        <input id="pw" type="password" autocomplete="current-password" required autofocus>
        <div class="hint">Shared with school families. You'll only need to enter it once on this device.</div>
      </div>
      ${error ? `<p class="note note-bad" role="alert">${esc(error)}</p>` : ""}
      <button class="btn btn-block" type="submit">View the gallery</button>
    </form>
  </div>`;
  document.getElementById("gate").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api.familySignIn(document.getElementById("pw").value);
      await loadGallery();
      route();
    } catch (err) {
      viewGate(friendlyError(err));
    }
  });
}

function statusBadge(p) {
  if (p.available > 0) return p.quantity > 1 ? `<span class="status status-left">${p.available} left</span>` : "";
  if (p.held > 0 && p.sold < p.quantity) return `<span class="status status-held">On hold</span>`;
  return `<span class="status status-sold">${p.quantity > 1 ? "Sold out" : "Sold"}</span>`;
}

function viewGallery() {
  document.title = info.fundraiser_name;
  const cats = [...new Set(gallery.pieces.map((p) => p.category).filter(Boolean))].sort();
  const pct = gallery.goal_cents ? Math.min(100, Math.round((gallery.raised_cents / gallery.goal_cents) * 100)) : 0;
  const shown = gallery.pieces.filter((p) =>
    filter === "all" ? true : filter === "available" ? p.available > 0 : p.category === filter);

  app.innerHTML = shell(`
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <div class="eyebrow">${esc(info.school_name)} presents</div>
      <h1>${esc(info.fundraiser_name)}</h1>
      <p class="lead">${esc(info.intro)}</p>
      ${info.sale_closes_at && info.sale_state === "open" ? `<p class="small muted">Sale closes ${esc(fmtDateTime(info.sale_closes_at))}</p>` : ""}
    </div>
    ${gallery.goal_cents ? `<div class="goal">
      <div class="eyebrow">Raised so far</div>
      <div class="amount">${money(gallery.raised_cents)}</div>
      <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Fundraiser progress"><span style="width:${pct}%"></span></div>
      <div class="row small muted"><span>${pct}% of our ${money(gallery.goal_cents)} goal</span><span class="spacer"></span>
      <a href="${esc(info.donate_url)}" target="_blank" rel="noopener">Make a donation →</a></div>
    </div>` : ""}
  </div></section>
  <div class="wrap">
    <div class="filters" role="group" aria-label="Filter pieces">
      ${[["all", "All pieces"], ["available", "Available"], ...cats.map((c) => [c, c])]
        .map(([k, l]) => `<button class="chip" data-filter="${esc(k)}" aria-pressed="${filter === k}">${esc(l)}</button>`).join("")}
      <span class="spacer"></span><span class="small muted">${shown.length} piece${shown.length === 1 ? "" : "s"}</span>
    </div>
    ${shown.length ? `<div class="gallery">${shown.map((p) => `
      <a class="card ${p.available <= 0 ? "is-sold" : ""}" href="#/piece/${esc(p.id)}">
        <div class="ph">${p.photos?.[0] ? `<img src="${esc(p.photos[0])}" alt="${esc(p.title)} by ${esc(p.artist)}" loading="lazy">` : ""}${statusBadge(p)}</div>
        <div class="meta">
          <div class="title">${esc(p.title)}</div>
          <div class="artist">${esc(p.artist)}</div>
          <div class="price">${money(p.suggested_cents)} <span class="muted small">suggested</span></div>
        </div>
      </a>`).join("")}</div>` : `<div class="empty">No pieces match this filter.</div>`}
  </div>`);
}

function viewPiece(id) {
  const p = pieceById(id);
  if (!p) { app.innerHTML = shell(`<div class="wrap empty"><p>That piece wasn't found.</p><a class="btn btn-ghost" href="#/">Back to the gallery</a></div>`); return; }
  document.title = `${p.title} — ${info.fundraiser_name}`;
  const inCart = cart.get().find((i) => i.piece_id === p.id)?.qty ?? 0;
  const maxAdd = Math.max(0, p.available - inCart);
  const photos = p.photos?.length ? p.photos : [];

  let action;
  if (p.available <= 0) action = `<p class="note">${p.held > 0 && p.sold < p.quantity ? "This piece is on hold for another family. If it becomes available again, it will reappear here." : "This piece has found a home."}</p>`;
  else if (!canCheckout()) action = `<p class="note note-warn">Ordering is closed right now.</p>`;
  else if (maxAdd <= 0) action = `<p class="note note-ok">${inCart > 1 ? `All ${inCart} available are` : "It's"} in your cart.</p><a class="btn" href="#/cart">View cart</a>`;
  else action = `
    ${p.quantity > 1 ? `<div class="field"><label for="qty">Quantity <span class="muted small">(${p.available} available)</span></label>
      <div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><input id="qty" type="number" min="1" max="${maxAdd}" value="1" inputmode="numeric"><button type="button" data-q="1" aria-label="More">+</button></div></div>` : ""}
    <button class="btn btn-block" data-act="add" data-id="${esc(p.id)}">Add to cart</button>
    ${inCart ? `<p class="small muted" style="margin-top:10px">${inCart} already in your cart · <a href="#/cart">View cart</a></p>` : ""}`;

  app.innerHTML = shell(`<div class="wrap">
    <a class="back" href="#/">← All pieces</a>
    <div class="detail">
      <div>
        <button class="main-ph" data-act="zoom" aria-label="Enlarge photo">${photos[0] ? `<img id="main-img" src="${esc(photos[0])}" alt="${esc(p.title)} by ${esc(p.artist)}">` : ""}</button>
        ${photos.length > 1 ? `<div class="thumbs">${photos.map((u, i) => `<button data-thumb="${i}" aria-current="${i === 0}" aria-label="Photo ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div class="info">
        ${p.category ? `<div class="eyebrow">${esc(p.category)}</div>` : ""}
        <h1 style="font-size:clamp(2rem,4vw,2.8rem)">${esc(p.title)}</h1>
        <div class="muted">by ${esc(p.artist)}</div>
        <div class="price-lg">${money(p.suggested_cents)} <span class="small muted">suggested donation</span></div>
        ${p.description ? `<p style="margin-top:18px">${esc(p.description)}</p>` : ""}
        <div style="margin-top:24px">${action}</div>
        <p class="small muted" style="margin-top:24px">After you check out, your pieces are reserved and you'll get an invoice from FutureFund to pay.</p>
      </div>
    </div></div>`);
}

function viewCart(error = "") {
  document.title = `Cart — ${info.fundraiser_name}`;
  const items = cart.get().map((i) => ({ ...i, p: pieceById(i.piece_id) })).filter((i) => i.p);
  const total = items.reduce((s, i) => s + i.qty * i.p.suggested_cents, 0);
  const saved = { ...(() => { try { return JSON.parse(localStorage.getItem("ceramics-contact") || "{}"); } catch { return {}; } })(), ...draft };

  if (!items.length) {
    app.innerHTML = shell(`<div class="wrap page"><div class="empty">${error ? `<p class="note note-warn" role="alert" style="max-width:520px;margin:0 auto 24px">${esc(error)}</p>` : ""}<h2>Your cart is empty</h2><p>Browse the gallery and add the pieces you love.</p><a class="btn" href="#/">Browse the gallery</a></div></div>`);
    return;
  }
  const opts = gallery.pickup_options;
  app.innerHTML = shell(`<div class="wrap page">
    <h1>Your cart</h1>
    <div class="cart-grid">
      <div>
        ${items.map((i) => `
        <div class="line-item">
          ${i.p.photos?.[0] ? `<img src="${esc(i.p.photos[0])}" alt="">` : `<div></div>`}
          <div>
            <div class="t">${esc(i.p.title)}</div>
            <div class="small muted">by ${esc(i.p.artist)} · ${money(i.p.suggested_cents)} suggested</div>
            <div class="row" style="margin-top:8px">
              ${i.p.quantity > 1 ? `<div class="qty"><button type="button" data-cq="-1" data-id="${esc(i.p.id)}" aria-label="Fewer">−</button><input value="${i.qty}" readonly aria-label="Quantity"><button type="button" data-cq="1" data-id="${esc(i.p.id)}" aria-label="More" ${i.qty >= i.p.available ? "disabled" : ""}>+</button></div>` : ""}
              <button class="linkish small" data-act="remove" data-id="${esc(i.p.id)}">Remove</button>
            </div>
          </div>
          <div>${money(i.qty * i.p.suggested_cents)}</div>
        </div>`).join("")}
        <div class="totals"><span>Suggested total</span><strong>${money(total)}</strong></div>
        <p class="note">You won't pay on this site. After you check out, your pieces are reserved for you and we'll send you an <strong>invoice from FutureFund</strong>. Want to give extra? <a href="${esc(info.donate_url)}" target="_blank" rel="noopener">Make a separate donation</a>.</p>
      </div>
      <form class="panel" id="checkout" novalidate>
        <h2 style="font-size:1.5rem">Check out</h2>
        <div class="grid-2">
          <div class="field"><label for="first_name">First name <span class="req">*</span></label><input id="first_name" type="text" autocomplete="given-name" required value="${esc(saved.first_name)}"></div>
          <div class="field"><label for="last_name">Last name <span class="req">*</span></label><input id="last_name" type="text" autocomplete="family-name" required value="${esc(saved.last_name)}"></div>
        </div>
        <div class="field"><label for="email">Email <span class="req">*</span></label><input id="email" type="email" autocomplete="email" required value="${esc(saved.email)}"><div class="hint">Your FutureFund invoice will be sent here.</div></div>
        <div class="field"><label for="phone">Phone <span class="req">*</span></label><input id="phone" type="tel" autocomplete="tel" inputmode="tel" required value="${esc(saved.phone)}"></div>
        <div class="grid-2">
          <div class="field"><label for="student_name">Student name <span class="req">*</span></label><input id="student_name" type="text" required value="${esc(saved.student_name)}"></div>
          <div class="field"><label for="student_class">Teacher / class <span class="req">*</span></label><input id="student_class" type="text" required value="${esc(saved.student_class)}"></div>
        </div>
        <div class="field"><label for="pickup">Pickup <span class="req">*</span></label>
          <select id="pickup" required>
            <option value="">Choose a pickup option…</option>
            ${opts.map((o) => `<option value="${esc(o.id)}" ${saved.pickup === o.id ? "selected" : ""}>${esc(pickupText(o))}</option>`).join("")}
          </select>
          <div class="hint" id="pickup-note"></div>
        </div>
        <div class="field"><label for="notes">Notes <span class="muted small">(optional)</span></label><textarea id="notes" rows="3">${esc(saved.notes)}</textarea></div>
        <p class="note note-bad ${error ? "" : "hidden"}" role="alert" id="form-error">${esc(error)}</p>
        ${canCheckout()
          ? `<button class="btn btn-accent btn-block" type="submit">Place order · ${money(total)}</button>`
          : `<p class="note note-warn">Ordering is closed right now.</p>`}
      </form>
    </div></div>`);

  const sel = document.getElementById("pickup");
  const showNote = () => { const o = opts.find((x) => x.id === sel.value); document.getElementById("pickup-note").textContent = o?.note ?? ""; };
  sel.addEventListener("change", showNote); showNote();

  // Remember everything typed, so nothing is lost if the cart re-renders.
  const form = document.getElementById("checkout");
  const remember = (e) => {
    const el = e.target;
    if (!el.id) return;
    draft[el.id] = el.value;
    if (el.value.trim()) el.removeAttribute("aria-invalid");
  };
  form.addEventListener("input", remember);
  form.addEventListener("change", remember);

  document.getElementById("checkout").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = (id) => document.getElementById(id).value.trim();
    const order = {
      first_name: f("first_name"), last_name: f("last_name"),
      parent_name: `${f("first_name")} ${f("last_name")}`.trim(), email: f("email"), phone: f("phone"),
      student_name: f("student_name"), student_class: f("student_class"),
      pickup_option_id: f("pickup"), notes: f("notes"),
      items: cart.get().map(({ piece_id, qty }) => ({ piece_id, qty })),
    };
    const missing = ["first_name", "last_name", "email", "phone", "student_name", "student_class", "pickup"].filter((k) => !f(k));
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    const errBox = document.getElementById("form-error");
    if (missing.length) {
      missing.forEach((k) => document.getElementById(k).setAttribute("aria-invalid", "true"));
      errBox.textContent = "Please fill in the fields marked in red.";
      errBox.classList.remove("hidden");
      document.getElementById(missing[0]).focus();
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(order.email)) {
      document.getElementById("email").setAttribute("aria-invalid", "true");
      errBox.textContent = "Please check the email address.";
      errBox.classList.remove("hidden");
      document.getElementById("email").focus();
      return;
    }
    if (order.phone.replace(/\D/g, "").length < 7) {
      document.getElementById("phone").setAttribute("aria-invalid", "true");
      errBox.textContent = "Please check the phone number.";
      errBox.classList.remove("hidden");
      document.getElementById("phone").focus();
      return;
    }
    errBox.classList.add("hidden");
    try { localStorage.setItem("ceramics-contact", JSON.stringify({ ...order, pickup: order.pickup_option_id, items: undefined, notes: undefined })); } catch {}

    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Placing order…";
    try {
      const { first_name, last_name, ...payload } = order;
      const res = await api.placeOrder(payload);
      const summary = {
        ...res, email: order.email,
        items: items.map((i) => ({ title: i.p.title, artist: i.p.artist, qty: i.qty, cents: i.qty * i.p.suggested_cents, photo: i.p.photos?.[0] })),
        total, pickup: pickupText(opts.find((o) => o.id === order.pickup_option_id) ?? {}),
      };
      try { sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(summary)); } catch {}
      cart.set([]);
      draft = {};
      await loadGallery();
      location.hash = `#/thanks/${encodeURIComponent(res.order_no)}`;
    } catch (err) {
      const msg = friendlyError(err);
      await loadGallery().catch(() => {});
      reconcileCart();
      viewCart(msg);
    }
  });
}

function viewThanks(orderNo) {
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(LAST_ORDER_KEY) || "null"); } catch {}
  if (!s || s.order_no !== orderNo) s = { order_no: orderNo, items: [] };
  document.title = `Thank you — ${info.fundraiser_name}`;
  app.innerHTML = shell(`<div class="wrap page" style="max-width:720px">
    <div class="eyebrow">Order ${esc(s.order_no)}</div>
    <h1>Thank you!</h1>
    <p class="lead muted" style="font-size:1.1rem">Your pieces are reserved for you.${s.email ? ` Your FutureFund invoice will be sent to <strong>${esc(s.email)}</strong>.` : ""} Please keep your order number for your records.</p>
    <div class="panel" style="margin:26px 0">
      <h3>What happens next</h3>
      <ol style="padding-left:20px;margin:0">
        <li>We'll send you an <strong>invoice from FutureFund</strong> shortly. Look for order number <strong>${esc(s.order_no)}</strong> in the memo.</li>
        <li>Pay the invoice in FutureFund.</li>
        <li>Pick up your pieces${s.pickup ? `: <strong>${esc(s.pickup)}</strong>` : "."}</li>
      </ol>
    </div>
    ${s.items.length ? `<div>${s.items.map((i) => `
      <div class="line-item">${i.photo ? `<img src="${esc(i.photo)}" alt="">` : "<div></div>"}
        <div><div class="t">${esc(i.title)}${i.qty > 1 ? ` × ${i.qty}` : ""}</div><div class="small muted">by ${esc(i.artist)}</div></div>
        <div>${money(i.cents)}</div></div>`).join("")}
      <div class="totals"><span>Suggested total</span><strong>${money(s.total)}</strong></div></div>` : ""}
    <div class="row" style="margin-top:20px">
      <a class="btn btn-ghost" href="#/">Back to the gallery</a>
      <a class="btn btn-accent" href="${esc(info.donate_url)}" target="_blank" rel="noopener">Make an extra donation</a>
    </div></div>`);
}

// ───── Router & events ─────
async function loadGallery() { gallery = await api.getGallery(); }

function route() {
  window.scrollTo(0, 0);
  const [, page, arg] = (location.hash || "#/").split("/");
  if (page === "piece") return viewPiece(decodeURIComponent(arg));
  if (page === "cart") { const removed = reconcileCart(); viewCart(removed.length ? `${removed.join(", ")} ${removed.length === 1 ? "is" : "are"} no longer available and ${removed.length === 1 ? "was" : "were"} removed from your cart.` : ""); return; }
  if (page === "thanks") return viewThanks(decodeURIComponent(arg));
  return viewGallery();
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act],[data-filter],[data-thumb],[data-q],[data-cq]");
  if (!t) return;
  if (t.dataset.filter) { filter = t.dataset.filter; viewGallery(); return; }
  if (t.dataset.thumb) {
    const p = pieceById(location.hash.split("/")[2]);
    document.getElementById("main-img").src = p.photos[+t.dataset.thumb];
    document.querySelectorAll(".thumbs button").forEach((b) => b.setAttribute("aria-current", b === t));
    return;
  }
  if (t.dataset.q) {
    const inp = document.getElementById("qty");
    inp.value = Math.max(1, Math.min(+inp.max, (+inp.value || 1) + +t.dataset.q));
    return;
  }
  if (t.dataset.cq) {
    const items = cart.get();
    const it = items.find((i) => i.piece_id === t.dataset.id);
    const p = pieceById(t.dataset.id);
    it.qty = Math.max(1, Math.min(p.available, it.qty + +t.dataset.cq));
    cart.set(items); viewCart(); return;
  }
  switch (t.dataset.act) {
    case "add": {
      const qty = Math.max(1, +(document.getElementById("qty")?.value || 1));
      cart.add(t.dataset.id, qty);
      toast("Added to your cart", "ok");
      viewPiece(t.dataset.id);
      break;
    }
    case "remove": cart.set(cart.get().filter((i) => i.piece_id !== t.dataset.id)); viewCart(); break;
    case "zoom": {
      const src = document.getElementById("main-img")?.src;
      if (!src) return;
      const lb = document.createElement("div");
      lb.className = "lightbox"; lb.innerHTML = `<img src="${esc(src)}" alt="">`;
      lb.addEventListener("click", () => lb.remove());
      document.addEventListener("keydown", function k(ev) { if (ev.key === "Escape") { lb.remove(); document.removeEventListener("keydown", k); } });
      document.body.appendChild(lb);
      break;
    }
    case "signout": await api.familySignOut(); viewGate(); break;
    case "reset-demo": api.resetDemo(); cart.set([]); location.hash = "#/"; location.reload(); break;
  }
});

window.addEventListener("hashchange", () => { if (gallery) route(); });

// ───── Boot ─────
(async function boot() {
  try {
    api = await getApi();
    info = await api.getPublicInfo();
    const signedIn = await api.familySession();
    if (info.sale_state === "upcoming") {
      // Admins signed in on this device can still preview the gallery.
      try { if (signedIn) { await loadGallery(); renderCartCount(); return route(); } } catch {}
      return viewComingSoon();
    }
    if (!signedIn) return viewGate();
    await loadGallery();
    route();
  } catch (err) {
    console.error(err);
    if (String(err?.message).includes("NOT_SIGNED_IN") && info) return viewGate();
    app.innerHTML = `<div class="center-card"><h2>Something went wrong</h2><p class="muted">${esc(friendlyError(err))}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
  }
})();
