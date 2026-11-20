// Family-facing gallery: browse → cart → reserve. Families then donate the suggested
// amount through the FutureFund link, keep the receipt, and bring it to pickup.
import { getApi } from "./api.js";
import {
  esc, money, fmtDateTime, fmtDate, toast, friendlyError,
  pickupDaysText, instructionsHtml, credit,
} from "./util.js";

const app = document.getElementById("app");
const CART_KEY = "ceramics-cart";
const LAST_ORDER_KEY = "ceramics-last-order";

let api, info, gallery = null, filter = "all";
let draft = {};              // what the family has typed into the checkout form (survives re-renders)
let receiptPending = false;  // true until the family prints/saves their reservation page

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
const pickupOptions = () => gallery?.pickup_options ?? [];
const instructions = () => instructionsHtml(info.instructions, info.donate_url, pickupOptions());
const pickupPlace = () => [...new Set(pickupOptions().map((o) => o.location).filter(Boolean))].join(" / ");

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
const schoolBanner = `<div class="school-band no-print"><img src="img/banner.jpg" alt="California High School Grizzlies"></div>`;
const logo = (size = "sm") => `<img class="logo logo-${size}" src="img/logo.jpg" alt="Cal High Ceramics logo">`;

function shell(inner) {
  const demo = api.mode === "demo"
    ? `<div class="banner banner-demo no-print">Demo mode — sample data stored only in your browser. <a href="admin.html">Open the admin portal</a> · <button class="linkish" data-act="reset-demo">Reset demo</button></div>` : "";
  const closed = info.sale_state === "closed"
    ? `<div class="banner banner-closed no-print">The sale has ended — thank you for supporting our student artists!</div>`
    : info.sale_state === "paused" ? `<div class="banner banner-closed no-print">Reservations are paused for the moment. Please check back soon.</div>` : "";
  return `${demo}${schoolBanner}
  <header class="site-header no-print"><div class="wrap">
    <a class="brand brand-logo" href="#/">${logo("sm")}<span class="brand-text"><span class="school">${esc(info.school_name)}</span><span class="name">${esc(info.fundraiser_name)}</span></span></a>
    <nav class="nav" aria-label="Main">
      <a href="#/" class="hide-sm">Gallery</a>
      <a href="${esc(info.donate_url)}" target="_blank" rel="noopener">Donate</a>
      <a href="#/cart" class="cart-link">Cart <span class="badge-count ${cart.count() ? "" : "hidden"}" id="cart-count">${cart.count()}</span></a>
    </nav>
  </div></header>
  ${closed}
  <main id="main">${inner}</main>
  <footer class="footer no-print"><div class="wrap row">
    <span>${esc(info.fundraiser_name)}</span><span class="spacer"></span>
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
  ${api.mode === "demo" ? `<div class="banner banner-demo">Demo mode</div>` : ""}${schoolBanner}
  <div class="center-card">
    ${logo("lg")}
    <h1>${esc(info.fundraiser_name)}</h1>
    <p class="muted">${esc(info.intro)}</p>
    <div class="panel" style="text-align:center">
      <div class="eyebrow">Coming soon</div>
      <p style="font-family:var(--serif);font-size:1.6rem;margin:.3em 0">Reservations open ${esc(fmtDateTime(info.sale_opens_at))}</p>
      <a class="btn btn-ghost" href="${esc(info.donate_url)}" target="_blank" rel="noopener">Make a donation</a>
    </div>
  </div>`;
}

function viewGate(error = "") {
  document.title = info.fundraiser_name;
  app.innerHTML = `
  ${api.mode === "demo" ? `<div class="banner banner-demo">Demo mode — the family password is <strong>clay</strong></div>` : ""}${schoolBanner}
  <div class="center-card">
    ${logo("lg")}
    <h1>${esc(info.fundraiser_name)}</h1>
    <p class="muted">${esc(info.intro)}</p>
    <form class="panel" id="gate">
      <div class="field">
        <label for="pw">Password</label>
        <input id="pw" type="password" autocomplete="current-password" required autofocus>
        <div class="hint">You'll only need to enter it once on this device.</div>
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
  if (p.held > 0 && p.sold < p.quantity) return `<span class="status status-held">Reserved</span>`;
  return `<span class="status status-sold">${p.quantity > 1 ? "Sold out" : "Sold"}</span>`;
}

function viewGallery() {
  document.title = info.fundraiser_name;
  const cats = [...new Set(gallery.pieces.map((p) => p.category).filter(Boolean))].sort();
  const days = [...new Set(pickupOptions().filter((o) => o.pickup_date).map((o) => o.pickup_date))].sort();
  const place = pickupPlace();
  const shown = gallery.pieces.filter((p) =>
    filter === "all" ? true : filter === "available" ? p.available > 0 : p.category === filter);

  app.innerHTML = shell(`
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <div class="eyebrow">${esc(info.school_name)}</div>
      <h1>${esc(info.fundraiser_name)}</h1>
      <p class="lead">${esc(info.intro)}</p>
      <ol class="how">
        <li><b>Reserve</b> the pieces you love</li>
        <li><b>Donate</b> the suggested amount on FutureFund</li>
        <li><b>Pick up</b> with your receipt on ${esc(pickupDaysText(pickupOptions()))}</li>
      </ol>
      ${info.sale_closes_at && info.sale_state === "open" ? `<p class="small muted">Reservations close ${esc(fmtDateTime(info.sale_closes_at))}</p>` : ""}
    </div>
    ${days.length ? `<div class="goal">
      <div class="eyebrow">Pickup at school</div>
      <ul class="pickup-days">${days.map((d) => `<li>${esc(fmtDate(d))}</li>`).join("")}</ul>
      <div class="small muted">Before or after school${place ? ` · ${esc(place)}` : ""}. Bring your FutureFund receipt.</div>
      <div class="row small" style="margin-top:12px"><span class="spacer"></span><a href="${esc(info.donate_url)}" target="_blank" rel="noopener">Make a donation →</a></div>
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
        <div class="ph">${p.photos?.[0] ? `<img src="${esc(p.photos[0])}" alt="${esc(p.title)}" loading="lazy">` : ""}${statusBadge(p)}</div>
        <div class="meta">
          <div class="title">${esc(p.title)}</div>
          <div class="artist">${esc(credit(p.artist))}</div>
          <div class="price">${money(p.suggested_cents)} <span class="muted small">suggested donation</span></div>
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
  if (p.available <= 0) action = `<p class="note">${p.held > 0 && p.sold < p.quantity ? "This piece is reserved by another family. If it becomes available again, it will reappear here." : "This piece has found a home."}</p>`;
  else if (!canCheckout()) action = `<p class="note note-warn">Reservations are closed right now.</p>`;
  else if (maxAdd <= 0) action = `<p class="note note-ok">${inCart > 1 ? `All ${inCart} available are` : "It's"} in your cart.</p><a class="btn" href="#/cart">Go to cart to reserve</a>`;
  else action = `
    ${p.quantity > 1 ? `<div class="field"><label for="qty">Quantity <span class="muted small">(${p.available} available)</span></label>
      <div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><input id="qty" type="number" min="1" max="${maxAdd}" value="1" inputmode="numeric"><button type="button" data-q="1" aria-label="More">+</button></div></div>` : ""}
    <button class="btn btn-block" data-act="add" data-id="${esc(p.id)}">Add to cart</button>
    ${inCart ? `<p class="small muted" style="margin-top:10px">${inCart} already in your cart · <a href="#/cart">Go to cart to reserve</a></p>` : ""}`;

  app.innerHTML = shell(`<div class="wrap">
    <a class="back" href="#/">← All pieces</a>
    <div class="detail">
      <div>
        <button class="main-ph" data-act="zoom" aria-label="Enlarge photo">${photos[0] ? `<img id="main-img" src="${esc(photos[0])}" alt="${esc(p.title)}">` : ""}</button>
        ${photos.length > 1 ? `<div class="thumbs">${photos.map((u, i) => `<button data-thumb="${i}" aria-current="${i === 0}" aria-label="Photo ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div class="info">
        ${p.category ? `<div class="eyebrow">${esc(p.category)}</div>` : ""}
        <h1 style="font-size:clamp(2rem,4vw,2.8rem)">${esc(p.title)}</h1>
        <div class="muted">${esc(credit(p.artist))}</div>
        <div class="price-lg">${money(p.suggested_cents)} <span class="small muted">suggested donation</span></div>
        ${p.description ? `<p style="margin-top:18px">${esc(p.description)}</p>` : ""}
        <div style="margin-top:24px">${action}</div>
        <p class="small muted" style="margin-top:24px">${instructions()}</p>
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
  app.innerHTML = shell(`<div class="wrap page">
    <h1>Your cart</h1>
    <div class="cart-grid">
      <div>
        ${items.map((i) => `
        <div class="line-item">
          ${i.p.photos?.[0] ? `<img src="${esc(i.p.photos[0])}" alt="">` : `<div></div>`}
          <div>
            <div class="t">${esc(i.p.title)}</div>
            <div class="small muted">${esc(credit(i.p.artist))} · ${money(i.p.suggested_cents)} suggested</div>
            <div class="row" style="margin-top:8px">
              ${i.p.quantity > 1 ? `<div class="qty"><button type="button" data-cq="-1" data-id="${esc(i.p.id)}" aria-label="Fewer">−</button><input value="${i.qty}" readonly aria-label="Quantity"><button type="button" data-cq="1" data-id="${esc(i.p.id)}" aria-label="More" ${i.qty >= i.p.available ? "disabled" : ""}>+</button></div>` : ""}
              <button class="linkish small" data-act="remove" data-id="${esc(i.p.id)}">Remove</button>
            </div>
          </div>
          <div>${money(i.qty * i.p.suggested_cents)}</div>
        </div>`).join("")}
        <div class="totals"><span>Suggested donation</span><strong>${money(total)}</strong></div>
        <div class="note"><strong>How it works:</strong> ${instructions()}</div>
      </div>
      <form class="panel" id="checkout" novalidate>
        <h2 style="font-size:1.5rem">Reserve your pieces</h2>
        <div class="grid-2">
          <div class="field"><label for="first_name">First name <span class="req">*</span></label><input id="first_name" type="text" autocomplete="given-name" required value="${esc(saved.first_name)}"></div>
          <div class="field"><label for="last_name">Last name <span class="req">*</span></label><input id="last_name" type="text" autocomplete="family-name" required value="${esc(saved.last_name)}"></div>
        </div>
        <div class="field"><label for="email">Email <span class="req">*</span></label><input id="email" type="email" autocomplete="email" required value="${esc(saved.email)}"><div class="hint">So we can contact you about your reservation.</div></div>
        <div class="field"><label for="phone">Phone <span class="req">*</span></label><input id="phone" type="tel" autocomplete="tel" inputmode="tel" required value="${esc(saved.phone)}"></div>
        <div class="field"><label for="notes">Notes <span class="muted small">(optional)</span></label><textarea id="notes" rows="3">${esc(saved.notes)}</textarea></div>
        <p class="note note-bad ${error ? "" : "hidden"}" role="alert" id="form-error">${esc(error)}</p>
        ${canCheckout()
          ? `<button class="btn btn-accent btn-block" type="submit">Reserve · ${money(total)}</button>
             <p class="small muted" style="margin:10px 0 0;text-align:center">You won't pay on this site. You'll donate on FutureFund next.</p>`
          : `<p class="note note-warn">Reservations are closed right now.</p>`}
      </form>
    </div></div>`);

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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = (id) => document.getElementById(id).value.trim();
    const order = {
      first_name: f("first_name"), last_name: f("last_name"),
      parent_name: `${f("first_name")} ${f("last_name")}`.trim(), email: f("email"), phone: f("phone"),
      notes: f("notes"),
      items: cart.get().map(({ piece_id, qty }) => ({ piece_id, qty })),
    };
    const missing = ["first_name", "last_name", "email", "phone"].filter((k) => !f(k));
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    const errBox = document.getElementById("form-error");
    const fail = (id, msg) => {
      [].concat(id).forEach((k) => document.getElementById(k).setAttribute("aria-invalid", "true"));
      errBox.textContent = msg;
      errBox.classList.remove("hidden");
      document.getElementById([].concat(id)[0]).focus();
    };
    if (missing.length) return fail(missing, "Please fill in the fields marked in red.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(order.email)) return fail("email", "Please check the email address.");
    if (order.phone.replace(/\D/g, "").length < 7) return fail("phone", "Please check the phone number.");
    errBox.classList.add("hidden");
    try { localStorage.setItem("ceramics-contact", JSON.stringify({ first_name: order.first_name, last_name: order.last_name, email: order.email, phone: order.phone })); } catch {}

    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Reserving…";
    try {
      const { first_name, last_name, ...payload } = order;
      const res = await api.placeOrder(payload);
      const summary = {
        ...res, name: order.parent_name, email: order.email, phone: order.phone, notes: order.notes,
        placed_at: new Date().toISOString(),
        items: items.map((i) => ({ title: i.p.title, artist: i.p.artist, qty: i.qty, cents: i.qty * i.p.suggested_cents, photo: i.p.photos?.[0] })),
        total,
      };
      try { sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(summary)); } catch {}
      cart.set([]);
      draft = {};
      await loadGallery();
      receiptPending = true;
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
  document.title = `Reservation ${s.order_no} — ${info.fundraiser_name}`;
  const place = pickupPlace();
  app.innerHTML = shell(`<div class="wrap page receipt" style="max-width:760px">
    <div class="print-only print-head">${logo("sm")}<div><strong>${esc(info.fundraiser_name)}</strong><br><span class="muted">Reservation confirmation</span></div></div>

    <div class="save-alert no-print" role="alert">
      <div>
        <strong>Save this page now.</strong> You will <u>not</u> receive a confirmation email.
        Print it or save it as a PDF to keep your reservation number and instructions.
      </div>
      <button class="btn btn-accent" data-act="print">Print / Save as PDF</button>
    </div>

    <div class="eyebrow">Reservation ${esc(s.order_no)}</div>
    <h1>You're reserved!</h1>
    <p class="lead muted" style="font-size:1.1rem">Your pieces are set aside for you${s.name ? `, ${esc(s.name.split(" ")[0])}` : ""}. Here's what to do next.</p>

    <div class="panel next-steps" style="margin:26px 0">
      <h3>Next steps</h3>
      <p style="margin:0 0 14px">${instructions()}</p>
      <ol style="padding-left:20px;margin:0">
        <li>Donate <strong>${money(s.total)}</strong> on FutureFund. If there's a note field, add your reservation number <strong>${esc(s.order_no)}</strong>.</li>
        <li>Save your FutureFund receipt.</li>
        <li>Bring the receipt to pick up your pieces before or after school on <strong>${esc(pickupDaysText(pickupOptions()))}</strong>${place ? ` in <strong>${esc(place)}</strong>` : ""}.</li>
      </ol>
      <div class="row no-print" style="margin-top:18px">
        <a class="btn btn-accent" href="${esc(info.donate_url)}" target="_blank" rel="noopener">Donate ${money(s.total)} on FutureFund →</a>
      </div>
    </div>

    ${s.items.length ? `<h3>Your reservation</h3>
      <dl class="kv" style="margin:10px 0 16px">
        <dt>Reservation</dt><dd><strong>${esc(s.order_no)}</strong></dd>
        ${s.name ? `<dt>Name</dt><dd>${esc(s.name)}</dd>` : ""}
        ${s.email ? `<dt>Email</dt><dd>${esc(s.email)}</dd>` : ""}
        ${s.phone ? `<dt>Phone</dt><dd>${esc(s.phone)}</dd>` : ""}
        ${s.placed_at ? `<dt>Reserved</dt><dd>${esc(fmtDateTime(s.placed_at))}</dd>` : ""}
        ${s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : ""}
      </dl>
      <div>${s.items.map((i) => `
      <div class="line-item">${i.photo ? `<img src="${esc(i.photo)}" alt="">` : "<div></div>"}
        <div><div class="t">${esc(i.title)}${i.qty > 1 ? ` × ${i.qty}` : ""}</div><div class="small muted">${esc(credit(i.artist))}</div></div>
        <div>${money(i.cents)}</div></div>`).join("")}
      <div class="totals"><span>Suggested donation</span><strong>${money(s.total)}</strong></div></div>` : ""}

    <div class="row no-print" style="margin-top:20px">
      <button class="btn btn-ghost" data-act="print">Print / Save as PDF</button>
      <a class="btn btn-ghost" href="#/">Back to the gallery</a>
    </div></div>`);
}

// ───── "Did you save your reservation?" guard ─────
function leaveGuard(onLeave) {
  const box = document.createElement("div");
  box.className = "lightbox guard";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.innerHTML = `<div class="panel" style="max-width:460px;cursor:auto">
    <h3>Did you save your reservation?</h3>
    <p class="muted">You will <strong>not</strong> receive a confirmation email. Print or save this page as a PDF so you have your reservation number and pickup instructions.</p>
    <div class="row" style="margin-top:16px">
      <button class="btn btn-accent" data-g="print">Print / Save as PDF</button>
      <button class="btn btn-ghost" data-g="stay">Stay on this page</button>
    </div>
    <p style="margin:14px 0 0"><button class="linkish small" data-g="leave">Leave without saving</button></p>
  </div>`;
  box.addEventListener("click", (e) => {
    const g = e.target.closest("[data-g]")?.dataset.g;
    if (!g && e.target !== box) return;
    box.remove();
    if (g === "print") window.print();
    if (g === "leave") { receiptPending = false; onLeave(); }
  });
  document.body.appendChild(box);
  box.querySelector("[data-g=print]").focus();
}
window.addEventListener("beforeunload", (e) => {
  if (receiptPending && location.hash.startsWith("#/thanks")) { e.preventDefault(); e.returnValue = ""; }
});
window.addEventListener("afterprint", () => { receiptPending = false; });
// Catch in-app links away from the reservation page.
document.addEventListener("click", (e) => {
  if (!receiptPending || !location.hash.startsWith("#/thanks")) return;
  const a = e.target.closest("a[href]");
  const so = e.target.closest("[data-act=signout]");
  if (so) { e.preventDefault(); e.stopImmediatePropagation(); leaveGuard(async () => { await api.familySignOut(); viewGate(); }); return; }
  if (!a || a.target === "_blank") return;
  e.preventDefault(); e.stopImmediatePropagation();
  leaveGuard(() => { location.href = a.href; });
}, true);

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
    case "print": window.print(); break;
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
