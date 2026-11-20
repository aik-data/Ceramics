// Demo backend: sample data saved in this browser only (localStorage).
// Used automatically when config.js has no Supabase settings, so the
// GitHub Page can be previewed before the database is connected.
import { resizeImage, blobToDataUrl, saleState } from "./util.js";
import { seedDemo } from "./demo-seed.js";

const KEY = "ceramics-demo-v4";
const SESSION = "ceramics-demo-session";
export const DEMO_FAMILY_PASSWORD = "clay";
export const DEMO_ADMIN_PASSWORD = "demo";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const clone = (x) => JSON.parse(JSON.stringify(x));
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const db = seedDemo();
  save(db);
  return db;
}
function save(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {
    throw new Error("Demo storage is full — try smaller photos, or reset the demo.");
  }
}
function session() {
  try { return JSON.parse(localStorage.getItem(SESSION) || "{}"); } catch { return {}; }
}
function setSession(s) { try { localStorage.setItem(SESSION, JSON.stringify(s)); } catch {} }

function stock(db) {
  const out = {};
  for (const p of db.pieces) out[p.id] = { held: 0, sold: 0, available: p.quantity };
  for (const o of db.orders) {
    if (o.status === "released") continue;
    for (const i of o.order_items) {
      if (i.released || !out[i.piece_id]) continue;
      if (o.status === "paid") out[i.piece_id].sold += i.qty; else out[i.piece_id].held += i.qty;
      out[i.piece_id].available -= i.qty;
    }
  }
  return out;
}
const raised = (db) =>
  db.orders.filter((o) => o.status === "paid").reduce((s, o) => s + (o.amount_received_cents || 0), 0) +
  db.donations.reduce((s, d) => s + d.amount_cents, 0);

export function createDemoBackend() {
  const isMember = () => { const s = session(); return !!(s.family || s.admin); };

  const api = {
    mode: "demo",
    resetDemo() { localStorage.removeItem(KEY); localStorage.removeItem(SESSION); },

    async getPublicInfo() {
      const s = load().settings;
      return {
        fundraiser_name: s.fundraiser_name, school_name: s.school_name, intro: s.intro,
        sale_opens_at: s.sale_opens_at, sale_closes_at: s.sale_closes_at, sale_state: saleState(s),
        donate_url: s.donate_url, instructions: s.instructions, terms: s.terms || "",
        email_families: !!s.email_families, contact_email: s.reply_to || "",
      };
    },
    async familySession() { return isMember(); },
    async familySignIn(password) {
      await wait();
      if (password !== DEMO_FAMILY_PASSWORD && password !== load().familyPassword) throw new Error("Invalid login credentials");
      setSession({ ...session(), family: true });
    },
    async familySignOut() { setSession({ ...session(), family: false }); },
    async getGallery() {
      if (!isMember()) throw new Error("NOT_SIGNED_IN");
      const db = load();
      if (saleState(db.settings) === "upcoming" && !session().admin) throw new Error("SALE_NOT_OPEN");
      const st = stock(db);
      return {
        goal_cents: db.settings.goal_cents,
        raised_cents: raised(db),
        pieces: db.pieces.filter((p) => !p.hidden).sort((a, b) => a.sort - b.sort)
          .map((p) => ({ ...clone(p), ...st[p.id], available: Math.max(0, st[p.id].available) })),
        pickup_options: db.pickupOptions.filter((o) => o.active).sort((a, b) => a.sort - b.sort),
      };
    },
    async placeOrder(o) {
      await wait(300);
      const db = load();
      if (!isMember()) throw new Error("NOT_SIGNED_IN");
      if (saleState(db.settings) !== "open") throw new Error("SALE_NOT_OPEN");
      if (![o.parent_name, o.email, o.phone].every((v) => String(v ?? "").trim())) throw new Error("MISSING_FIELDS");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new Error("BAD_EMAIL");
      if (o.agreed_terms !== true) throw new Error("TERMS_REQUIRED");
      if (!o.items?.length) throw new Error("EMPTY_CART");
      const st = stock(db);
      const items = [];
      for (const it of o.items) {
        const p = db.pieces.find((x) => x.id === it.piece_id && !x.hidden);
        if (!p || it.qty > st[p.id].available) throw new Error("NOT_AVAILABLE:" + (p?.title ?? "a piece"));
        items.push({ id: uid(), piece_id: p.id, qty: it.qty, suggested_cents: p.suggested_cents, title: p.title, artist: p.artist, released: false });
      }
      const order = {
        id: uid(), order_no: "CER-" + db.nextOrderNo++, created_at: new Date().toISOString(), cancel_token: uid(),
        parent_name: o.parent_name.trim(), email: o.email.trim().toLowerCase(), phone: (o.phone || "").trim(),
        student_name: "", student_class: "", pickup_option_id: null, pickup_label: "",
        notes: (o.notes || "").trim(), picked_up_at: null, terms_agreed_at: new Date().toISOString(),
        status: "new", seen_at: null, invoice_sent_at: null, paid_at: null, amount_received_cents: null,
        released_at: null, notified_at: new Date().toISOString(), order_items: items,
      };
      db.orders.unshift(order);
      save(db);
      return { order_id: order.id, order_no: order.order_no, cancel_token: order.cancel_token };
    },
    async getReservationByToken(token) {
      const o = load().orders.find((x) => x.cancel_token === token);
      if (!o) return null;
      const items = o.order_items.filter((i) => !i.released);
      return {
        order_no: o.order_no, first_name: o.parent_name.split(" ")[0], created_at: o.created_at,
        state: o.status === "released" ? "cancelled" : o.status === "paid" && o.picked_up_at ? "picked_up" : "reserved",
        cancelled_by_family: !!o.cancelled_by_family_at,
        items: items.map((i) => ({ title: i.title, qty: i.qty, suggested_cents: i.suggested_cents })),
        total_cents: items.reduce((s, i) => s + i.qty * i.suggested_cents, 0),
      };
    },
    async cancelReservation(token) {
      await wait(200);
      const db = load();
      const o = db.orders.find((x) => x.cancel_token === token);
      if (!o) throw new Error("NOT_FOUND");
      if (o.status === "released") throw new Error("ALREADY_CANCELLED");
      if (o.status === "paid" && o.picked_up_at) throw new Error("ALREADY_PICKED_UP");
      o.order_items.forEach((i) => (i.released = true));
      const now = new Date().toISOString();
      Object.assign(o, { status: "released", released_at: now, cancelled_by_family_at: now });
      db.activity.unshift({ id: uid(), at: now, admin_email: null, order_id: o.id, action: "Cancelled by family", detail: "Pieces returned to the sale" });
      save(db);
      return { order_no: o.order_no };
    },

    // ───── Admin ─────
    async adminSession() { const s = session(); return s.admin ? { email: s.admin } : null; },
    async adminSignIn(email, password) {
      await wait();
      if (password !== DEMO_ADMIN_PASSWORD) throw new Error(`Demo mode: use the password “${DEMO_ADMIN_PASSWORD}”.`);
      setSession({ ...session(), admin: email.trim().toLowerCase() || "admin@example.org" });
      return { email };
    },
    async adminSignOut() { setSession({ ...session(), admin: null }); },
    async sendPasswordReset() { throw new Error("Password emails aren't sent in demo mode."); },
    async setOwnPassword() {},

    async adminLoad() {
      await wait(60);
      const db = load();
      const st = stock(db);
      const settings = clone(db.settings);
      settings.sale_state = saleState(settings);
      return {
        settings,
        pieces: db.pieces.slice().sort((a, b) => a.sort - b.sort).map((p) => ({ ...clone(p), ...st[p.id] })),
        orders: clone(db.orders),
        donations: clone(db.donations).sort((a, b) => b.donated_on.localeCompare(a.donated_on)),
        pickupOptions: clone(db.pickupOptions).sort((a, b) => a.sort - b.sort),
        activity: clone(db.activity),
        admins: clone(db.admins),
      };
    },
    async orderAction(order, action, data = {}) {
      const db = load();
      const o = db.orders.find((x) => x.id === order.id);
      const now = new Date().toISOString();
      const log = (a, detail = "") => db.activity.unshift({ id: uid(), at: now, admin_email: session().admin, order_id: o.id, action: a, detail });
      switch (action) {
        case "seen": o.seen_at ||= now; break;
        case "invoice_sent": Object.assign(o, { status: "invoice_sent", invoice_sent_at: now, seen_at: o.seen_at || now }); log("Invoice sent"); break;
        case "paid": Object.assign(o, { status: "paid", paid_at: now, seen_at: o.seen_at || now }); log("Marked paid"); break;
        case "unpaid": Object.assign(o, { status: "new", paid_at: null, amount_received_cents: null, picked_up_at: null }); log("Payment undone"); break;
        case "paid_picked_up": Object.assign(o, { status: "paid", paid_at: now, picked_up_at: now, seen_at: o.seen_at || now }); log("Receipt checked — paid and picked up"); break;
        case "picked_up": Object.assign(o, { picked_up_at: now }); log("Picked up"); break;
        case "unpicked": Object.assign(o, { status: "new", paid_at: null, picked_up_at: null }); log("Pickup undone"); break;
        case "release": o.order_items.forEach((i) => (i.released = true)); Object.assign(o, { status: "released", released_at: now, seen_at: o.seen_at || now }); log("Order released", "All pieces back on sale"); break;
        case "release_item": {
          const it = o.order_items.find((i) => i.id === data.item.id); it.released = true;
          if (o.order_items.every((i) => i.released)) Object.assign(o, { status: "released", released_at: now });
          log("Item released", it.title); break;
        }
        case "set_qty": {
          const it = o.order_items.find((i) => i.id === data.item.id);
          log("Quantity changed", `${it.title}: ${it.qty} → ${data.qty}`); it.qty = data.qty; break;
        }
        default: throw new Error("Unknown action " + action);
      }
      save(db);
    },
    async savePiece(piece) {
      const db = load();
      const row = { ...piece };
      for (const k of ["held", "sold", "available"]) delete row[k];
      if (!row.id) { row.id = uid(); row.created_at = new Date().toISOString(); row.sort ??= db.pieces.length; db.pieces.push(row); }
      else Object.assign(db.pieces.find((p) => p.id === row.id), row);
      save(db);
      return row;
    },
    async eraseContacts(orderIds) {
      const db = load();
      for (const o of db.orders) {
        if (!orderIds.includes(o.id)) continue;
        Object.assign(o, { parent_name: "(erased)", email: "", phone: "", notes: "" });
        db.activity.unshift({ id: uid(), at: new Date().toISOString(), admin_email: session().admin, order_id: o.id, action: "Family details erased", detail: "" });
      }
      save(db);
    },
    async deletePiece(piece) {
      const db = load();
      if (db.orders.some((o) => o.order_items.some((i) => i.piece_id === piece.id))) {
        throw new Error("This piece has reservations, so it can't be deleted. Hide it instead.");
      }
      db.pieces = db.pieces.filter((p) => p.id !== piece.id);
      save(db);
    },
    async uploadPhoto(file) { return blobToDataUrl(await resizeImage(file, 1000, 0.8)); },
    async savePickup(opt) {
      const db = load();
      if (!opt.id) { const row = { ...opt, id: uid() }; db.pickupOptions.push(row); save(db); return row; }
      Object.assign(db.pickupOptions.find((p) => p.id === opt.id), opt); save(db); return opt;
    },
    async deletePickup(id) { const db = load(); db.pickupOptions = db.pickupOptions.filter((p) => p.id !== id); save(db); },
    async saveSettings(patch) { const db = load(); Object.assign(db.settings, patch); save(db); return db.settings; },
    async saveDonation(d) {
      const db = load();
      if (!d.id) { const row = { ...d, id: uid(), created_at: new Date().toISOString() }; db.donations.push(row); save(db); return row; }
      Object.assign(db.donations.find((x) => x.id === d.id), d); save(db); return d;
    },
    async deleteDonation(id) { const db = load(); db.donations = db.donations.filter((d) => d.id !== id); save(db); },
    async setFamilyPassword(pw) {
      if (pw.length < 6) throw new Error("PASSWORD_TOO_SHORT");
      const db = load(); db.familyPassword = pw; save(db);
    },
    async inviteAdmin(email) {
      const db = load(); db.admins.push({ user_id: uid(), email: email.trim().toLowerCase(), created_at: new Date().toISOString() }); save(db);
    },
    async removeAdmin(user_id) { const db = load(); db.admins = db.admins.filter((a) => a.user_id !== user_id); save(db); },
  };
  return api;
}
