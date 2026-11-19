// Admin portal: orders, listings, donations, settings, reports.
import { getApi } from "./api.js";
import {
  esc, money, toCents, toDollars, fmtDateTime, fmtDate, pickupText, ago, toast, friendlyError,
  isoToLocalInput, localInputToIso, downloadCsv, parseCsv, orderTotal,
} from "./util.js";

const app = document.getElementById("app");
const dlg = document.getElementById("dlg");
let api, me, D = null, pollTimer = null, knownOrderIds = null;

const STATUS_LABEL = { new: "New", invoice_sent: "Invoice sent", paid: "Paid", released: "Released" };
const SALE_LABEL = { upcoming: "Coming soon", open: "Open", paused: "Checkout paused", closed: "Closed" };

// ───── Data helpers ─────
async function reload() {
  D = await api.adminLoad();
  D.orderById = Object.fromEntries(D.orders.map((o) => [o.id, o]));
  if (knownOrderIds) {
    const fresh = D.orders.filter((o) => !knownOrderIds.has(o.id));
    if (fresh.length) toast(fresh.length === 1 ? `New order ${fresh[0].order_no} from ${fresh[0].parent_name}` : `${fresh.length} new orders`, "ok");
  }
  knownOrderIds = new Set(D.orders.map((o) => o.id));
}
const isOverdue = (o) =>
  o.status === "invoice_sent" && o.invoice_sent_at &&
  Date.now() - new Date(o.invoice_sent_at).getTime() > (D.settings.overdue_hours || 48) * 3600e3;
const unread = () => D.orders.filter((o) => !o.seen_at && o.status === "new");
const pill = (o) => `<span class="pill pill-${o.status}">${STATUS_LABEL[o.status]}</span>${isOverdue(o) ? ` <span class="pill pill-overdue">Overdue</span>` : ""}`;
const activeItems = (o) => o.order_items.filter((i) => !i.released);

function stats() {
  const sales = D.orders.filter((o) => o.status === "paid").reduce((s, o) => s + (o.amount_received_cents || 0), 0);
  const donations = D.donations.reduce((s, d) => s + d.amount_cents, 0);
  const open = D.orders.filter((o) => o.status === "new" || o.status === "invoice_sent");
  const units = D.pieces.filter((p) => !p.hidden).reduce((a, p) => ({ total: a.total + p.quantity, sold: a.sold + p.sold, held: a.held + p.held, avail: a.avail + Math.max(0, p.available) }), { total: 0, sold: 0, held: 0, avail: 0 });
  return { sales, donations, raised: sales + donations, awaiting: open.reduce((s, o) => s + orderTotal(o), 0), openCount: open.length, units };
}

// ───── Dialog helper ─────
function openDialog(html, { onSubmit, wide } = {}) {
  dlg.innerHTML = `<form method="dialog" id="dlg-form">${html}</form>`;
  dlg.style.maxWidth = wide ? "min(720px, 94vw)" : "";
  dlg.showModal();
  const form = dlg.querySelector("form");
  form.querySelector("[data-cancel]")?.addEventListener("click", (e) => { e.preventDefault(); dlg.close(); });
  if (onSubmit) form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try { const keep = await onSubmit(form); if (keep !== true) dlg.close(); }
    catch (err) { toast(friendlyError(err), "error"); if (btn) btn.disabled = false; }
  });
  form.querySelector("input,select,textarea")?.focus();
}
const confirmDialog = (title, body, okLabel = "Confirm", danger = false) => new Promise((resolve) => {
  openDialog(`<div class="dlg-body"><h3>${esc(title)}</h3><p class="muted">${body}</p></div>
    <div class="dlg-foot"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn ${danger ? "btn-danger" : ""}" type="submit">${esc(okLabel)}</button></div>`,
    { onSubmit: () => resolve(true) });
  dlg.addEventListener("close", () => resolve(false), { once: true });
});

// ───── Layout ─────
function shell(active, inner) {
  const n = unread().length;
  const s = D.settings;
  const nav = [
    ["dashboard", "#/", "Dashboard"],
    ["orders", "#/orders/new", `Orders ${n ? `<span class="badge-count">${n}</span>` : ""}`],
    ["listings", "#/listings", "Listings"],
    ["donations", "#/donations", "Donations"],
    ["settings", "#/settings", "Settings"],
    ["reports", "#/reports", "Reports"],
  ];
  return `
  ${api.mode === "demo" ? `<div class="banner banner-demo">Demo mode — changes are saved only in this browser. <button class="linkish" data-act="reset-demo">Reset demo data</button></div>` : ""}
  <div class="admin-shell">
    <aside class="admin-side">
      <a class="brand" href="#/"><span class="school">Admin</span><span class="name">${esc(s.fundraiser_name)}</span></a>
      <nav class="admin-nav" aria-label="Admin">
        ${nav.map(([k, h, l]) => `<a href="${h}" ${k === active ? 'aria-current="page"' : ""}>${l}</a>`).join("")}
      </nav>
      <div class="foot">
        <div style="margin-bottom:6px">Sale: <strong style="color:#fff">${SALE_LABEL[s.sale_state]}</strong></div>
        <a href="index.html" target="_blank" rel="noopener">View family site ↗</a><br>
        <span class="small">${esc(me.email)}</span> · <button class="linkish" data-act="signout">Sign out</button>
      </div>
    </aside>
    <main class="admin-main">${inner}</main>
  </div>`;
}

// ───── Auth screens ─────
function viewLogin(error = "", notice = "") {
  document.title = "Admin sign in";
  app.innerHTML = `
  ${api.mode === "demo" ? `<div class="banner banner-demo">Demo mode — sign in with any email and the password <strong>demo</strong></div>` : ""}
  <div class="center-card">
    <div class="eyebrow">Ceramics fundraiser</div>
    <h1>Admin sign in</h1>
    <form class="panel" id="login">
      <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
      ${error ? `<p class="note note-bad" role="alert">${esc(error)}</p>` : ""}
      ${notice ? `<p class="note note-ok">${esc(notice)}</p>` : ""}
      <button class="btn btn-block" type="submit">Sign in</button>
      <p class="small" style="margin:14px 0 0;text-align:center"><button type="button" class="linkish" data-act="forgot">Forgot or need to set your password?</button></p>
    </form>
    <p class="small muted" style="margin-top:18px"><a href="index.html">← Back to the gallery</a></p>
  </div>`;
  document.getElementById("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      me = await api.adminSignIn(document.getElementById("em").value, document.getElementById("pw").value);
      me = await api.adminSession();
      await start();
    } catch (err) { viewLogin(friendlyError(err)); }
  });
}

function viewSetPassword() {
  app.innerHTML = `<div class="center-card"><h1>Set your password</h1>
    <form class="panel" id="setpw">
      <div class="field"><label for="np">New password</label><input id="np" type="password" minlength="8" autocomplete="new-password" required><div class="hint">At least 8 characters.</div></div>
      <button class="btn btn-block" type="submit">Save password</button>
    </form></div>`;
  document.getElementById("setpw").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.setOwnPassword(document.getElementById("np").value);
      toast("Password saved", "ok");
      location.hash = "#/";
      me = await api.adminSession();
      if (me && !me.notAdmin) await start(); else viewLogin("", "Password saved. Please sign in.");
    } catch (err) { toast(friendlyError(err), "error"); }
  });
}

// ───── Dashboard ─────
function viewDashboard() {
  const st = stats();
  const s = D.settings;
  const pct = s.goal_cents ? Math.min(100, Math.round((st.raised / s.goal_cents) * 100)) : 0;
  const news = unread();
  const overdue = D.orders.filter(isOverdue);
  const net = st.raised - (s.expenses_cents || 0);

  app.innerHTML = shell("dashboard", `
    <div class="admin-top"><h1>Dashboard</h1><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-act="refresh">Refresh</button></div>

    ${news.length ? `<section class="alert-new" aria-live="polite">
      <h2>New orders (${news.length})</h2>
      <div class="table-wrap"><table class="list"><tbody>
      ${news.map((o) => `<tr class="clickable" data-href="#/order/${o.id}">
        <td><span class="unread-dot"></span><strong>${esc(o.order_no)}</strong></td><td>${esc(o.parent_name)}</td>
        <td>${activeItems(o).length} item${activeItems(o).length === 1 ? "" : "s"}</td><td class="num">${money(orderTotal(o))}</td>
        <td class="small muted">${ago(o.created_at)}</td><td><button class="btn btn-sm">Open</button></td></tr>`).join("")}
      </tbody></table></div></section>` : ""}

    <div class="tiles">
      <div class="tile"><div class="k">Total raised</div><div class="v">${money(st.raised)}</div><div class="s">${money(st.sales)} sales + ${money(st.donations)} donations</div></div>
      <div class="tile"><div class="k">Net profit</div><div class="v">${money(net)}</div><div class="s">${s.expenses_cents ? `after ${money(s.expenses_cents)} expenses` : `No expenses entered · <a href="#/settings">add</a>`}</div></div>
      <div class="tile"><div class="k">Awaiting payment</div><div class="v">${money(st.awaiting)}</div><div class="s">${st.openCount} open order${st.openCount === 1 ? "" : "s"}</div></div>
      <div class="tile"><div class="k">Pieces</div><div class="v">${st.units.sold} sold</div><div class="s">${st.units.held} on hold · ${st.units.avail} available of ${st.units.total}</div></div>
    </div>

    <div class="panel" style="margin-bottom:22px">
      <div class="row"><strong>Goal progress</strong><span class="spacer"></span><span class="muted small">${money(st.raised)} of ${money(s.goal_cents)} · ${pct}%</span></div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <div class="small muted">Shown to families on the gallery page. Includes paid orders and recorded donations.</div>
    </div>

    ${overdue.length ? `<div class="panel" style="margin-bottom:22px">
      <h3 class="section-title">Overdue — invoice sent more than ${s.overdue_hours} hours ago</h3>
      <div class="table-wrap"><table class="list"><tbody>${overdue.map((o) => `
        <tr class="clickable" data-href="#/order/${o.id}"><td><strong>${esc(o.order_no)}</strong></td><td>${esc(o.parent_name)}</td>
        <td class="num">${money(orderTotal(o))}</td><td class="small muted">Invoiced ${ago(o.invoice_sent_at)}</td></tr>`).join("")}
      </tbody></table></div></div>` : ""}

    <div class="panel">
      <h3 class="section-title">Recent activity</h3>
      ${D.activity.length ? `<ul class="timeline">${D.activity.slice(0, 8).map((a) => {
        const o = D.orderById[a.order_id];
        return `<li><strong>${esc(a.action)}</strong>${a.detail ? ` — ${esc(a.detail)}` : ""}${o ? ` · <a href="#/order/${o.id}">${esc(o.order_no)}</a>` : ""}
          <div class="muted small">${esc(a.admin_email ?? "")} · ${fmtDateTime(a.at)}</div></li>`;
      }).join("")}</ul>` : `<p class="muted small">Nothing yet.</p>`}
    </div>`);
}

// ───── Orders ─────
function viewOrders(tab = "new") {
  const tabs = [["new", "New"], ["invoice_sent", "Invoice sent"], ["paid", "Paid"], ["released", "Released"], ["all", "All"]];
  const list = D.orders.filter((o) => tab === "all" || o.status === tab);
  app.innerHTML = shell("orders", `
    <div class="admin-top"><h1>Orders</h1><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-act="refresh">Refresh</button></div>
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/orders/${k}" aria-current="${k === tab}">${l}<span class="n">${k === "all" ? D.orders.length : D.orders.filter((o) => o.status === k).length}</span></a>`).join("")}</nav>
    ${list.length ? `<div class="table-wrap"><table class="list">
      <thead><tr><th>Order</th><th>Family</th><th>Student</th><th>Items</th><th class="num">Total</th><th>Status</th><th>Placed</th></tr></thead>
      <tbody>${list.map((o) => `<tr class="clickable" data-href="#/order/${o.id}">
        <td>${!o.seen_at && o.status === "new" ? `<span class="unread-dot" title="Unread"></span>` : ""}<strong>${esc(o.order_no)}</strong></td>
        <td>${esc(o.parent_name)}<div class="small muted">${esc(o.email)}</div></td>
        <td>${esc(o.student_name)}<div class="small muted">${esc(o.student_class)}</div></td>
        <td>${activeItems(o).map((i) => esc(i.title) + (i.qty > 1 ? ` ×${i.qty}` : "")).join(", ") || `<span class="muted">—</span>`}</td>
        <td class="num">${money(o.status === "paid" ? o.amount_received_cents : orderTotal(o))}</td>
        <td>${pill(o)}</td>
        <td class="small muted">${ago(o.created_at)}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="panel empty">No ${tab === "all" ? "" : STATUS_LABEL[tab].toLowerCase() + " "}orders.</div>`}`);
}

function invoiceText(o) {
  const items = activeItems(o);
  return [
    `Bill to: ${o.parent_name} <${o.email}>`,
    `Memo: ${o.order_no}`,
    ``,
    ...items.map((i) => `• ${i.title}${i.qty > 1 ? ` × ${i.qty}` : ""} (by ${i.artist}) — ${money(i.qty * i.suggested_cents)}`),
    ``,
    `Total: ${money(orderTotal(o))}`,
  ].join("\n");
}
function mailto(o, subject, body) {
  return `mailto:${encodeURIComponent(o.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function viewOrder(id) {
  let o = D.orderById[id];
  if (!o) { app.innerHTML = shell("orders", `<div class="panel empty">Order not found. <a href="#/orders/all">All orders</a></div>`); return; }
  if (!o.seen_at) { await api.orderAction(o, "seen"); await reload(); o = D.orderById[id]; }
  const items = o.order_items;
  const log = D.activity.filter((a) => a.order_id === o.id);
  const open = o.status === "new" || o.status === "invoice_sent";

  let actions = "";
  if (o.status === "new") actions = `
    <button class="btn btn-block" data-act="copy-invoice">Copy invoice details</button>
    <p class="small muted" style="margin:0">Paste into a new FutureFund invoice. Put <strong>${esc(o.order_no)}</strong> in the memo.</p>
    <button class="btn btn-accent btn-block" data-act="invoice-sent">Mark invoice sent</button>`;
  if (o.status === "invoice_sent") actions = `
    <button class="btn btn-accent btn-block" data-act="mark-paid">Mark paid…</button>
    <button class="btn btn-ghost btn-block" data-act="copy-invoice">Copy invoice details</button>
    <a class="btn btn-ghost btn-block" href="${esc(mailto(o, `Reminder: ceramics order ${o.order_no}`, `Hi ${o.parent_name.split(" ")[0]},\n\nThis is a friendly reminder that the FutureFund invoice for your ceramics order ${o.order_no} is still open. Your pieces are being held for you.\n\nThank you for supporting our student artists!`))}">Email a reminder</a>`;
  if (o.status === "paid") actions = `
    <p class="note note-ok" style="margin:0">Paid ${money(o.amount_received_cents)} · ${fmtDateTime(o.paid_at)}</p>
    <button class="btn btn-ghost btn-block btn-sm" data-act="unpaid">Undo — mark as not paid</button>`;
  if (o.status === "released") actions = `<p class="note" style="margin:0">Released ${fmtDateTime(o.released_at)}. These pieces are back on sale.</p>`;
  if (open) actions += `<button class="btn btn-danger btn-block" data-act="release">Release order…</button>`;

  app.innerHTML = shell("orders", `
    <a class="back" href="#/orders/${o.status}" style="margin-top:0">← Orders</a>
    <div class="admin-top" style="margin-top:10px"><h1>${esc(o.order_no)}</h1>${pill(o)}<span class="spacer"></span><span class="muted small">Placed ${fmtDateTime(o.created_at)}</span></div>
    <div class="order-grid">
      <div class="stack">
        <div class="panel">
          <h3 class="section-title">Family</h3>
          <dl class="kv">
            <dt>Name</dt><dd>${esc(o.parent_name)}</dd>
            <dt>Email</dt><dd><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></dd>
            ${o.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></dd>` : ""}
            <dt>Student</dt><dd>${esc(o.student_name)}</dd>
            <dt>Teacher / class</dt><dd>${esc(o.student_class)}</dd>
            <dt>Pickup</dt><dd>${esc(D.pickupOptions.find((p) => p.id === o.pickup_option_id) ? pickupText(D.pickupOptions.find((p) => p.id === o.pickup_option_id)) : o.pickup_label)}</dd>
            ${o.notes ? `<dt>Notes</dt><dd>${esc(o.notes)}</dd>` : ""}
            ${o.invoice_sent_at ? `<dt>Invoice sent</dt><dd>${fmtDateTime(o.invoice_sent_at)} (${ago(o.invoice_sent_at)})</dd>` : ""}
          </dl>
        </div>
        <div class="panel">
          <h3 class="section-title">Items</h3>
          ${items.map((i) => {
            const p = D.pieces.find((x) => x.id === i.piece_id);
            return `<div class="line-item" style="${i.released ? "opacity:.5" : ""}">
              ${p?.photos?.[0] ? `<img src="${esc(p.photos[0])}" alt="">` : "<div></div>"}
              <div><div class="t">${esc(i.title)}${i.released ? ` <span class="pill pill-released">Released</span>` : ""}</div>
                <div class="small muted">by ${esc(i.artist)} · ${money(i.suggested_cents)} each</div>
                ${open && !i.released ? `<div class="row" style="margin-top:8px">
                  ${i.qty > 1 ? `<button class="btn btn-ghost btn-sm" data-act="qty-down" data-item="${i.id}">Reduce to ${i.qty - 1}</button>` : ""}
                  ${activeItems(o).length > 1 ? `<button class="btn btn-ghost btn-sm" data-act="release-item" data-item="${i.id}">Remove item</button>` : ""}
                </div>` : ""}
              </div>
              <div style="text-align:right">${i.qty > 1 ? `<div class="small muted">× ${i.qty}</div>` : ""}${money(i.qty * i.suggested_cents)}</div>
            </div>`;
          }).join("")}
          <div class="totals"><span>Invoice total</span><strong>${money(orderTotal(o))}</strong></div>
        </div>
      </div>
      <div class="stack">
        <div class="panel"><div class="actions">${actions}</div></div>
        <div class="panel">
          <h3 class="section-title">History</h3>
          <ul class="timeline">
            ${log.map((a) => `<li><strong>${esc(a.action)}</strong>${a.detail ? ` — ${esc(a.detail)}` : ""}<div class="muted small">${esc(a.admin_email ?? "")} · ${fmtDateTime(a.at)}</div></li>`).join("")}
            <li><strong>Order placed</strong><div class="muted small">${fmtDateTime(o.created_at)}</div></li>
          </ul>
        </div>
      </div>
    </div>`);
  app.dataset.order = o.id;
}

async function orderAct(act, el) {
  const o = D.orderById[app.dataset.order];
  const run = async (action, data, msg) => { await api.orderAction(o, action, data); await reload(); if (msg) toast(msg, "ok"); viewOrder(o.id); };
  switch (act) {
    case "copy-invoice":
      try { await navigator.clipboard.writeText(invoiceText(o)); toast("Invoice details copied", "ok"); }
      catch {
        openDialog(`<div class="dlg-body"><h3>Invoice details</h3><textarea rows="10" readonly>${esc(invoiceText(o))}</textarea></div>
          <div class="dlg-foot"><button class="btn" data-cancel>Done</button></div>`);
      }
      break;
    case "invoice-sent": await run("invoice_sent", {}, "Marked invoice sent"); break;
    case "mark-paid":
      openDialog(`<div class="dlg-body"><h3>Mark ${esc(o.order_no)} paid</h3>
        <div class="field"><label for="amt">Amount received in FutureFund ($)</label>
        <input id="amt" type="text" inputmode="decimal" value="${toDollars(orderTotal(o))}" required>
        <div class="hint">Invoice total: ${money(orderTotal(o))}. Change it if the payment was different.</div></div></div>
        <div class="dlg-foot"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-accent" type="submit">Mark paid</button></div>`,
        { onSubmit: async (f) => {
          const cents = toCents(f.querySelector("#amt").value);
          if (cents <= 0) throw new Error("Enter the amount received.");
          await run("paid", { amount_cents: cents }, "Marked paid — pieces are now sold");
        } });
      break;
    case "unpaid":
      if (await confirmDialog("Undo payment?", "The order goes back to “Invoice sent”. Its pieces stay on hold.", "Undo payment")) await run("unpaid", {}, "Payment undone");
      break;
    case "release":
      openDialog(`<div class="dlg-body"><h3>Release ${esc(o.order_no)}?</h3>
        <p class="muted">All pieces in this order go back on sale and the order is closed. This can't be undone.</p>
        <label class="check"><input type="checkbox" id="mail" checked> Open an email to ${esc(o.parent_name)} afterward</label></div>
        <div class="dlg-foot"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-danger" type="submit">Release order</button></div>`,
        { onSubmit: async (f) => {
          const mail = f.querySelector("#mail").checked;
          await run("release", {}, "Order released — pieces are back on sale");
          if (mail) location.href = mailto(o, `Your ceramics order ${o.order_no}`, `Hi ${o.parent_name.split(" ")[0]},\n\nWe've released the pieces from your ceramics order ${o.order_no}, since we didn't receive payment. If this is a mistake, just reply and we'll help.\n\nThank you!`);
        } });
      break;
    case "release-item": {
      const item = o.order_items.find((i) => i.id === el.dataset.item);
      if (await confirmDialog("Remove item?", `“${esc(item.title)}” goes back on sale and is removed from this order.`, "Remove item", true)) await run("release_item", { item }, "Item removed");
      break;
    }
    case "qty-down": {
      const item = o.order_items.find((i) => i.id === el.dataset.item);
      await run("set_qty", { item, qty: item.qty - 1 }, "Quantity updated");
      break;
    }
  }
}

// ───── Listings ─────
function viewListings() {
  const pieces = D.pieces;
  app.innerHTML = shell("listings", `
    <div class="admin-top"><h1>Listings</h1><span class="spacer"></span>
      <label class="btn btn-ghost btn-sm" style="margin:0">Import CSV<input type="file" accept=".csv,text/csv" id="csv" class="sr-only"></label>
      <a class="btn btn-sm" href="#/listing/new">Add piece</a></div>
    ${pieces.length ? `<div class="table-wrap"><table class="list">
      <thead><tr><th></th><th>Piece</th><th>Category</th><th class="num">Suggested</th><th class="num">Qty</th><th class="num">Available</th><th class="num">On hold</th><th class="num">Sold</th><th></th></tr></thead>
      <tbody>${pieces.map((p) => `<tr class="clickable" data-href="#/listing/${p.id}">
        <td style="width:60px">${p.photos?.[0] ? `<img class="thumb-sm" src="${esc(p.photos[0])}" alt="">` : `<div class="thumb-sm"></div>`}</td>
        <td><strong>${esc(p.title)}</strong><div class="small muted">${esc(p.artist)}</div></td>
        <td>${esc(p.category)}</td>
        <td class="num">${money(p.suggested_cents)}</td><td class="num">${p.quantity}</td>
        <td class="num">${Math.max(0, p.available)}</td><td class="num">${p.held}</td><td class="num">${p.sold}</td>
        <td>${p.hidden ? `<span class="pill pill-hidden">Hidden</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="panel empty"><p>No pieces yet.</p><a class="btn" href="#/listing/new">Add your first piece</a></div>`}
    <p class="small muted" style="margin-top:14px">CSV import columns: <code>title, artist, description, category, suggested, quantity</code> (with a header row). Photos are added afterward.</p>`);

  document.getElementById("csv").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
    const col = (r, k) => (r[header.indexOf(k)] ?? "").trim();
    const parsed = rows.map((r) => ({
      title: col(r, "title"), artist: col(r, "artist"), description: col(r, "description"), category: col(r, "category"),
      suggested_cents: toCents(col(r, "suggested")), quantity: Math.max(1, parseInt(col(r, "quantity")) || 1), photos: [], hidden: false,
    })).filter((p) => p.title);
    if (!header.includes("title")) { toast("The CSV needs a header row with a “title” column.", "error"); return; }
    if (await confirmDialog("Import pieces?", `Add <strong>${parsed.length}</strong> piece${parsed.length === 1 ? "" : "s"} from ${esc(file.name)}?`, "Import")) {
      let sort = D.pieces.length;
      for (const p of parsed) await api.savePiece({ ...p, sort: sort++ });
      await reload(); toast(`Imported ${parsed.length} pieces`, "ok"); viewListings();
    }
  });
}

function viewListing(id) {
  const isNew = id === "new";
  const p = isNew ? { title: "", artist: "", description: "", category: "", suggested_cents: 0, quantity: 1, photos: [], hidden: false, held: 0, sold: 0 } : D.pieces.find((x) => x.id === id);
  if (!p) { app.innerHTML = shell("listings", `<div class="panel empty">Piece not found.</div>`); return; }
  let photos = [...(p.photos || [])];
  const cats = [...new Set(D.pieces.map((x) => x.category).filter(Boolean))];
  const committed = (p.held || 0) + (p.sold || 0);

  const renderPhotos = () => {
    document.getElementById("photos").innerHTML = photos.map((u, i) => `
      <div class="ph"><img src="${esc(u)}" alt="Photo ${i + 1}">
        <div class="ctrl">${i > 0 ? `<button type="button" data-ph="left" data-i="${i}" aria-label="Move left">←</button>` : "<span></span>"}
        <button type="button" data-ph="del" data-i="${i}">Remove</button></div></div>`).join("") +
      (photos.length < 4 ? `<label class="photo-add">+ Add photo${photos.length ? "" : "s"}<input type="file" accept="image/*" multiple class="sr-only" id="ph-in"></label>` : "");
    document.getElementById("ph-in")?.addEventListener("change", async (e) => {
      const files = [...e.target.files].slice(0, 4 - photos.length);
      toast(`Uploading ${files.length} photo${files.length === 1 ? "" : "s"}…`);
      for (const f of files) {
        try { photos.push(await api.uploadPhoto(f)); } catch (err) { toast(friendlyError(err), "error"); }
      }
      renderPhotos();
    });
  };

  app.innerHTML = shell("listings", `
    <a class="back" href="#/listings" style="margin-top:0">← Listings</a>
    <div class="admin-top" style="margin-top:10px"><h1>${isNew ? "Add piece" : esc(p.title)}</h1></div>
    <form class="panel" id="piece" style="max-width:760px">
      <div class="field"><label>Photos <span class="muted small">(up to 4 — the first is the cover)</span></label><div class="photo-edit" id="photos"></div>
        <div class="hint">Photos are resized automatically. Please don't include students in photos.</div></div>
      <div class="grid-2">
        <div class="field"><label for="title">Title <span class="req">*</span></label><input id="title" type="text" required value="${esc(p.title)}"></div>
        <div class="field"><label for="artist">Artist name <span class="req">*</span></label><input id="artist" type="text" required value="${esc(p.artist)}"><div class="hint">Shown exactly as typed.</div></div>
        <div class="field"><label for="category">Category</label><input id="category" type="text" list="cats" value="${esc(p.category)}" placeholder="e.g. Mugs"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
        <div class="field"><label for="suggested">Suggested donation ($) <span class="req">*</span></label><input id="suggested" type="text" inputmode="decimal" required value="${p.suggested_cents ? toDollars(p.suggested_cents) : ""}"></div>
        <div class="field"><label for="quantity">Quantity <span class="req">*</span></label><input id="quantity" type="number" min="${Math.max(1, committed)}" required value="${p.quantity}"><div class="hint">${committed ? `${p.held} on hold and ${p.sold} sold, so the minimum is ${committed}.` : "Use 1 for one-of-a-kind pieces."}</div></div>
      </div>
      <div class="field"><label for="description">Description</label><textarea id="description" rows="4">${esc(p.description)}</textarea></div>
      <label class="check" style="margin-bottom:20px"><input type="checkbox" id="hidden" ${p.hidden ? "checked" : ""}> Hide from the gallery</label>
      <div class="row"><button class="btn" type="submit">${isNew ? "Add piece" : "Save changes"}</button><a class="btn btn-ghost" href="#/listings">Cancel</a></div>
    </form>`);
  renderPhotos();

  document.getElementById("photos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ph]");
    if (!b) return;
    const i = +b.dataset.i;
    if (b.dataset.ph === "del") photos.splice(i, 1);
    if (b.dataset.ph === "left") [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]];
    renderPhotos();
  });

  document.getElementById("piece").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (k) => document.getElementById(k).value.trim();
    const qty = parseInt(v("quantity")) || 0;
    if (!v("title") || !v("artist") || !v("suggested")) return toast("Please fill in the required fields.", "error");
    if (qty < Math.max(1, committed)) return toast(`Quantity can't be less than ${Math.max(1, committed)}.`, "error");
    try {
      await api.savePiece({
        ...(isNew ? { sort: D.pieces.length } : { id: p.id }),
        title: v("title"), artist: v("artist"), category: v("category"), description: v("description"),
        suggested_cents: toCents(v("suggested")), quantity: qty, photos, hidden: document.getElementById("hidden").checked,
      });
      await reload(); toast(isNew ? "Piece added" : "Saved", "ok"); location.hash = "#/listings";
    } catch (err) { toast(friendlyError(err), "error"); }
  });
}

// ───── Donations ─────
function donationDialog(d = {}) {
  openDialog(`<div class="dlg-body"><h3>${d.id ? "Edit donation" : "Record a donation"}</h3>
    <p class="small muted">For money given through the FutureFund donation page, so it counts toward the goal.</p>
    <div class="grid-2">
      <div class="field"><label for="d-amt">Amount ($) <span class="req">*</span></label><input id="d-amt" type="text" inputmode="decimal" required value="${d.amount_cents ? toDollars(d.amount_cents) : ""}"></div>
      <div class="field"><label for="d-date">Date</label><input id="d-date" type="date" value="${esc(d.donated_on ?? new Date().toISOString().slice(0, 10))}"></div>
    </div>
    <div class="field"><label for="d-name">Name <span class="muted small">(optional)</span></label><input id="d-name" type="text" value="${esc(d.name ?? "")}"></div>
    <div class="field"><label for="d-note">Note <span class="muted small">(optional)</span></label><input id="d-note" type="text" value="${esc(d.note ?? "")}"></div></div>
    <div class="dlg-foot"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn" type="submit">Save</button></div>`,
    { onSubmit: async (f) => {
      const cents = toCents(f.querySelector("#d-amt").value);
      if (cents <= 0) throw new Error("Enter an amount.");
      await api.saveDonation({ ...(d.id ? { id: d.id } : {}), amount_cents: cents, donated_on: f.querySelector("#d-date").value || new Date().toISOString().slice(0, 10), name: f.querySelector("#d-name").value.trim(), note: f.querySelector("#d-note").value.trim() });
      await reload(); toast("Donation saved", "ok"); viewDonations();
    } });
}
function viewDonations() {
  const total = D.donations.reduce((s, d) => s + d.amount_cents, 0);
  app.innerHTML = shell("donations", `
    <div class="admin-top"><h1>Donations</h1><span class="spacer"></span><button class="btn btn-sm" data-act="add-donation">Record donation</button></div>
    <div class="tiles"><div class="tile"><div class="k">Donations recorded</div><div class="v">${money(total)}</div><div class="s">${D.donations.length} entr${D.donations.length === 1 ? "y" : "ies"} · counted toward the goal</div></div></div>
    <p class="note" style="margin-bottom:18px">Families donate through the FutureFund page linked from the Donate button. The site can't see those payments, so record them here (each one, or a running total) to update the goal progress.</p>
    ${D.donations.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Name</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${D.donations.map((d) => `<tr><td>${fmtDate(d.donated_on)}</td><td>${esc(d.name) || `<span class="muted">—</span>`}</td><td>${esc(d.note)}</td>
        <td class="num">${money(d.amount_cents)}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-act="edit-donation" data-id="${d.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-act="del-donation" data-id="${d.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="panel empty">No donations recorded yet.</div>`}`);
}

// ───── Settings ─────
function pickupDialog(o = {}) {
  openDialog(`<div class="dlg-body"><h3>${o.id ? "Edit pickup option" : "Add pickup option"}</h3>
    <div class="field"><label for="pu-label">Label <span class="req">*</span></label><input id="pu-label" type="text" required value="${esc(o.label ?? "")}" placeholder="e.g. Spring Concert"></div>
    <div class="grid-2">
      <div class="field"><label for="pu-date">Date</label><input id="pu-date" type="date" value="${esc(o.pickup_date ?? "")}"></div>
      <div class="field"><label for="pu-loc">Location</label><input id="pu-loc" type="text" value="${esc(o.location ?? "")}" placeholder="e.g. School gym"></div>
      <div class="field"><label for="pu-start">Start time</label><input id="pu-start" type="time" value="${esc((o.start_time ?? "").slice(0, 5))}"></div>
      <div class="field"><label for="pu-end">End time</label><input id="pu-end" type="time" value="${esc((o.end_time ?? "").slice(0, 5))}"></div>
    </div>
    <div class="field"><label for="pu-note">Note for families</label><input id="pu-note" type="text" value="${esc(o.note ?? "")}"></div>
    <label class="check"><input type="checkbox" id="pu-active" ${o.active !== false ? "checked" : ""}> Show at checkout</label>
    <p class="small muted" style="margin-top:12px">Leave date and time blank for options like “Send home with my student”.</p></div>
    <div class="dlg-foot"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn" type="submit">Save</button></div>`,
    { onSubmit: async (f) => {
      const g = (k) => f.querySelector(k).value.trim();
      if (!g("#pu-label")) throw new Error("Please add a label.");
      await api.savePickup({ ...(o.id ? { id: o.id } : { sort: D.pickupOptions.length }), label: g("#pu-label"), pickup_date: g("#pu-date") || null, location: g("#pu-loc"),
        start_time: g("#pu-start") || null, end_time: g("#pu-end") || null, note: g("#pu-note"), active: f.querySelector("#pu-active").checked });
      await reload(); toast("Pickup option saved", "ok"); viewSettings();
    } });
}

function viewSettings() {
  const s = D.settings;
  app.innerHTML = shell("settings", `
    <div class="admin-top"><h1>Settings</h1></div>

    <form class="panel settings-section" id="set-sale">
      <h2>Sale</h2>
      <p class="muted small">Currently: <strong>${SALE_LABEL[s.sale_state]}</strong>. The site opens and closes on its own using these dates (in your device's time zone).</p>
      <div class="grid-2">
        <div class="field"><label for="opens">Sale opens</label><input id="opens" type="datetime-local" value="${isoToLocalInput(s.sale_opens_at)}"><div class="hint">Before this, families see a “Coming soon” page.</div></div>
        <div class="field"><label for="closes">Sale closes</label><input id="closes" type="datetime-local" value="${isoToLocalInput(s.sale_closes_at)}"><div class="hint">After this, families can browse but not check out.</div></div>
      </div>
      <label class="check" style="margin-bottom:18px"><input type="checkbox" id="paused" ${s.checkout_paused ? "checked" : ""}> Pause checkout now (overrides the dates)</label>
      <div class="grid-2">
        <div class="field"><label for="fname">Fundraiser name</label><input id="fname" type="text" value="${esc(s.fundraiser_name)}"></div>
        <div class="field"><label for="sname">School name</label><input id="sname" type="text" value="${esc(s.school_name)}"></div>
      </div>
      <div class="field"><label for="intro">Introduction</label><textarea id="intro" rows="3">${esc(s.intro)}</textarea></div>
      <button class="btn" type="submit">Save sale settings</button>
    </form>

    <section class="panel settings-section">
      <div class="row"><h2 style="margin:0">Pickup dates &amp; times</h2><span class="spacer"></span><button class="btn btn-sm" data-act="add-pickup">Add option</button></div>
      <p class="muted small" style="margin-top:8px">Families choose one of the active options at checkout.</p>
      ${D.pickupOptions.length ? D.pickupOptions.map((o, i) => `<div class="pickup-row">
        <div><strong>${esc(o.label)}</strong> ${o.active ? "" : `<span class="pill pill-hidden">Off</span>`}
          <div class="small muted">${esc(pickupText({ ...o, label: "" }).replace(/^ · /, "")) || "No date/time"}${o.note ? ` — ${esc(o.note)}` : ""}</div></div>
        <div class="row" style="gap:6px">
          ${i > 0 ? `<button class="btn btn-ghost btn-sm" data-act="pickup-up" data-id="${o.id}" aria-label="Move up">↑</button>` : ""}
          <button class="btn btn-ghost btn-sm" data-act="edit-pickup" data-id="${o.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-act="del-pickup" data-id="${o.id}">Delete</button>
        </div></div>`).join("") : `<p class="muted">No pickup options yet — add at least one before the sale opens.</p>`}
    </section>

    <form class="panel settings-section" id="set-money">
      <h2>Goal, donations &amp; follow-up</h2>
      <div class="grid-2">
        <div class="field"><label for="goal">Fundraiser goal ($)</label><input id="goal" type="text" inputmode="decimal" value="${toDollars(s.goal_cents)}"></div>
        <div class="field"><label for="expenses">Total expenses ($)</label><input id="expenses" type="text" inputmode="decimal" value="${toDollars(s.expenses_cents)}"><div class="hint">Optional. Used for net profit on the dashboard.</div></div>
        <div class="field"><label for="overdue">Flag unpaid invoices after (hours)</label><input id="overdue" type="number" min="1" value="${s.overdue_hours}"></div>
        <div class="field"><label for="donate">FutureFund donation link</label><input id="donate" type="url" value="${esc(s.donate_url)}"><div class="hint">Where the Donate button goes.</div></div>
      </div>
      <button class="btn" type="submit">Save</button>
    </form>

    <form class="panel settings-section" id="set-notify">
      <h2>New-order emails</h2>
      <div class="field"><label for="emails">Send new-order alerts to</label><textarea id="emails" rows="2" placeholder="one email per line">${esc((s.notify_emails || []).join("\n"))}</textarea></div>
      <button class="btn" type="submit">Save</button>
    </form>

    <form class="panel settings-section" id="set-family">
      <h2>Family password</h2>
      <p class="muted small">The one password shared with school families. Changing it signs nobody out, but new visitors will need the new password.</p>
      <div class="field" style="max-width:360px"><label for="fpw">New family password</label><input id="fpw" type="text" minlength="6" autocomplete="off" required></div>
      <button class="btn" type="submit">Update family password</button>
    </form>

    <form class="panel settings-section" id="set-mypw">
      <h2>My password</h2>
      <p class="muted small">Change the password you use to sign in to this admin portal (${esc(me.email)}).</p>
      <div class="grid-2" style="max-width:620px">
        <div class="field"><label for="mypw">New password</label><input id="mypw" type="password" minlength="8" autocomplete="new-password" required></div>
        <div class="field"><label for="mypw2">Confirm new password</label><input id="mypw2" type="password" minlength="8" autocomplete="new-password" required></div>
      </div>
      <button class="btn" type="submit">Change my password</button>
    </form>

    <section class="panel settings-section">
      <h2>Admins</h2>
      <table class="list" style="margin-bottom:14px"><tbody>
        ${D.admins.map((a) => `<tr><td>${esc(a.email)}${a.email === me.email ? ` <span class="muted small">(you)</span>` : ""}</td>
          <td style="text-align:right">${a.email !== me.email ? `<button class="btn btn-danger btn-sm" data-act="remove-admin" data-id="${a.user_id}" data-email="${esc(a.email)}">Remove</button>` : ""}</td></tr>`).join("")}
      </tbody></table>
      <form class="row" id="invite"><input type="email" id="inv" placeholder="new.admin@example.org" required style="max-width:320px"><button class="btn btn-sm" type="submit">Invite admin</button></form>
      <p class="small muted" style="margin-top:8px">They'll get an email with a link to set their password.</p>
    </section>`);

  const val = (id) => document.getElementById(id).value.trim();
  const saveForm = (id, build, msg = "Saved") => document.getElementById(id).addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api.saveSettings(build()); await reload(); toast(msg, "ok"); viewSettings(); }
    catch (err) { toast(friendlyError(err), "error"); }
  });
  saveForm("set-sale", () => {
    const opens = localInputToIso(val("opens")), closes = localInputToIso(val("closes"));
    if (opens && closes && new Date(closes) <= new Date(opens)) throw new Error("The close date must be after the open date.");
    return { sale_opens_at: opens, sale_closes_at: closes, checkout_paused: document.getElementById("paused").checked,
      fundraiser_name: val("fname") || "Student Ceramics Sale", school_name: val("sname"), intro: val("intro") };
  }, "Sale settings saved");
  saveForm("set-money", () => ({ goal_cents: toCents(val("goal")), expenses_cents: toCents(val("expenses")),
    overdue_hours: Math.max(1, parseInt(val("overdue")) || 48), donate_url: val("donate") || "https://www.futurefund.com/" }));
  saveForm("set-notify", () => ({ notify_emails: val("emails").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean) }), "Notification emails saved");
  document.getElementById("set-family").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api.setFamilyPassword(val("fpw")); toast("Family password updated", "ok"); e.target.reset(); }
    catch (err) { toast(friendlyError(err), "error"); }
  });
  document.getElementById("set-mypw").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (val("mypw").length < 8) return toast("Use at least 8 characters.", "error");
    if (val("mypw") !== val("mypw2")) return toast("The two passwords don't match.", "error");
    try { await api.setOwnPassword(val("mypw")); toast("Your password was changed", "ok"); e.target.reset(); }
    catch (err) { toast(friendlyError(err), "error"); }
  });
  document.getElementById("invite").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api.inviteAdmin(val("inv")); await reload(); toast("Invitation sent", "ok"); viewSettings(); }
    catch (err) { toast(friendlyError(err), "error"); }
  });
}

// ───── Reports ─────
function viewReports() {
  const reports = [
    ["sales", "Sales", "Each paid order with its pieces, family and amount received."],
    ["donations", "Donations", "Every donation recorded on the Donations page."],
    ["pickup", "Pickup list", "Paid and open orders grouped by pickup date/time, then teacher/class — for packing and handing out."],
    ["open", "Open orders", "New and invoice-sent orders, with how long each has been waiting."],
    ["inventory", "Inventory", "Every piece with quantity, on hold, sold and available."],
  ];
  app.innerHTML = shell("reports", `
    <div class="admin-top"><h1>Reports</h1></div>
    <div class="tiles">${reports.map(([k, t, d]) => `<div class="tile"><h3 style="font-size:1.3rem;margin-bottom:6px">${t}</h3><p class="small muted">${d}</p><button class="btn btn-ghost btn-sm" data-act="report" data-k="${k}">Download CSV</button></div>`).join("")}</div>`);
}
function downloadReport(k) {
  const stamp = new Date().toISOString().slice(0, 10);
  const puLabel = (o) => { const p = D.pickupOptions.find((x) => x.id === o.pickup_option_id); return p ? pickupText(p) : o.pickup_label; };
  const puSort = (o) => { const p = D.pickupOptions.find((x) => x.id === o.pickup_option_id); return `${p?.pickup_date ?? "9999"} ${p?.start_time ?? ""} ${o.pickup_label}`; };
  if (k === "sales") {
    const rows = [["Order", "Paid on", "Parent", "Email", "Student", "Class", "Piece", "Artist", "Qty", "Suggested", "Order amount received"]];
    for (const o of D.orders.filter((x) => x.status === "paid"))
      activeItems(o).forEach((i, n) => rows.push([o.order_no, fmtDate(o.paid_at), o.parent_name, o.email, o.student_name, o.student_class, i.title, i.artist, i.qty, toDollars(i.qty * i.suggested_cents), n === 0 ? toDollars(o.amount_received_cents) : ""]));
    downloadCsv(`sales-${stamp}.csv`, rows);
  }
  if (k === "donations") downloadCsv(`donations-${stamp}.csv`, [["Date", "Name", "Note", "Amount"], ...D.donations.map((d) => [d.donated_on, d.name, d.note, toDollars(d.amount_cents)])]);
  if (k === "pickup") {
    const rows = [["Pickup", "Teacher / class", "Student", "Parent", "Phone", "Order", "Status", "Pieces"]];
    D.orders.filter((o) => o.status !== "released").sort((a, b) => puSort(a).localeCompare(puSort(b)) || a.student_class.localeCompare(b.student_class) || a.student_name.localeCompare(b.student_name))
      .forEach((o) => rows.push([puLabel(o), o.student_class, o.student_name, o.parent_name, o.phone, o.order_no, STATUS_LABEL[o.status], activeItems(o).map((i) => i.title + (i.qty > 1 ? ` x${i.qty}` : "")).join("; ")]));
    downloadCsv(`pickup-list-${stamp}.csv`, rows);
  }
  if (k === "open") {
    const rows = [["Order", "Status", "Placed", "Invoice sent", "Hours waiting", "Overdue", "Parent", "Email", "Phone", "Total"]];
    D.orders.filter((o) => o.status === "new" || o.status === "invoice_sent").forEach((o) => rows.push([o.order_no, STATUS_LABEL[o.status], fmtDateTime(o.created_at), fmtDateTime(o.invoice_sent_at),
      Math.round((Date.now() - new Date(o.invoice_sent_at || o.created_at).getTime()) / 3600e3), isOverdue(o) ? "Yes" : "", o.parent_name, o.email, o.phone, toDollars(orderTotal(o))]));
    downloadCsv(`open-orders-${stamp}.csv`, rows);
  }
  if (k === "inventory") downloadCsv(`inventory-${stamp}.csv`, [["Title", "Artist", "Category", "Suggested", "Quantity", "On hold", "Sold", "Available", "Hidden"],
    ...D.pieces.map((p) => [p.title, p.artist, p.category, toDollars(p.suggested_cents), p.quantity, p.held, p.sold, Math.max(0, p.available), p.hidden ? "Yes" : ""])]);
  toast("Report downloaded", "ok");
}

// ───── Router & events ─────
async function route() {
  const [, page, arg] = (location.hash || "#/").split("/");
  document.title = "Ceramics Admin";
  window.scrollTo(0, 0);
  if (page === "orders") return viewOrders(arg || "new");
  if (page === "order") return viewOrder(arg);
  if (page === "listings") return viewListings();
  if (page === "listing") return viewListing(arg);
  if (page === "donations") return viewDonations();
  if (page === "settings") return viewSettings();
  if (page === "reports") return viewReports();
  return viewDashboard();
}

document.addEventListener("click", async (e) => {
  const row = e.target.closest("tr[data-href]");
  if (row && !e.target.closest("a,button:not(.btn-sm)")) { location.hash = row.dataset.href; return; }
  if (row && e.target.closest("button.btn-sm") && row.closest(".alert-new")) { location.hash = row.dataset.href; return; }
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  try {
    switch (act) {
      case "signout": clearInterval(pollTimer); await api.adminSignOut(); viewLogin(); return;
      case "forgot": {
        const em = document.getElementById("em")?.value.trim();
        if (!em) { toast("Type your email first, then click this link.", "error"); return; }
        await api.sendPasswordReset(em); viewLogin("", "Check your email for a link to set your password."); return;
      }
      case "reset-demo": if (await confirmDialog("Reset demo data?", "All demo changes in this browser will be erased.", "Reset", true)) { api.resetDemo(); location.hash = "#/"; location.reload(); } return;
      case "refresh": await reload(); route(); toast("Up to date"); return;
      case "add-donation": donationDialog(); return;
      case "edit-donation": donationDialog(D.donations.find((d) => d.id === t.dataset.id)); return;
      case "del-donation":
        if (await confirmDialog("Delete donation?", "This removes it from the total raised.", "Delete", true)) { await api.deleteDonation(t.dataset.id); await reload(); toast("Donation deleted"); viewDonations(); }
        return;
      case "add-pickup": pickupDialog(); return;
      case "edit-pickup": pickupDialog(D.pickupOptions.find((o) => o.id === t.dataset.id)); return;
      case "del-pickup":
        if (await confirmDialog("Delete pickup option?", "Families won't see it at checkout anymore. Orders that already chose it keep their pickup label.", "Delete", true)) { await api.deletePickup(t.dataset.id); await reload(); toast("Pickup option deleted"); viewSettings(); }
        return;
      case "pickup-up": {
        const list = D.pickupOptions; const i = list.findIndex((o) => o.id === t.dataset.id);
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
        await Promise.all(list.map((o, n) => api.savePickup({ id: o.id, sort: n })));
        await reload(); viewSettings(); return;
      }
      case "remove-admin":
        if (await confirmDialog("Remove admin?", `${esc(t.dataset.email)} will no longer be able to use the admin portal.`, "Remove", true)) { await api.removeAdmin(t.dataset.id); await reload(); toast("Admin removed"); viewSettings(); }
        return;
      case "report": downloadReport(t.dataset.k); return;
      default: await orderAct(act, t);
    }
  } catch (err) { console.error(err); toast(friendlyError(err), "error"); }
});

window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#/set-password")) return viewSetPassword();
  if (D) route();
});

async function start() {
  await reload();
  if (location.hash.startsWith("#/set-password") || location.hash.includes("access_token")) location.hash = "#/";
  route();
  clearInterval(pollTimer);
  // Check for new orders every 30 seconds so they pop up on the dashboard.
  pollTimer = setInterval(async () => {
    if (document.hidden || dlg.open || document.activeElement?.matches("input,textarea,select")) return;
    const before = unread().length;
    try { await reload(); } catch { return; }
    const [, page] = (location.hash || "#/").split("/");
    if (unread().length !== before && (page === "" || page === undefined || page === "orders")) route();
    else document.querySelectorAll('.admin-nav a[href^="#/orders"]').forEach((a) => { a.innerHTML = `Orders ${unread().length ? `<span class="badge-count">${unread().length}</span>` : ""}`; });
  }, 30000);
}

(async function boot() {
  try {
    api = await getApi();
    const rawHash = location.hash;
    me = await api.adminSession();
    if (/type=(invite|recovery)/.test(rawHash) || rawHash.startsWith("#/set-password")) {
      if (me) return viewSetPassword();
    }
    if (!me) return viewLogin();
    if (me.notAdmin) return viewLogin(); // e.g. the shared family login on this device
    await start();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="center-card"><h2>Something went wrong</h2><p class="muted">${esc(friendlyError(err))}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
  }
})();
