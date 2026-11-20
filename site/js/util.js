// Shared helpers for the family site and the admin portal.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const money = (cents) => {
  const v = (Number(cents) || 0) / 100;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: v % 1 ? 2 : 0 });
};

export const toCents = (dollars) => Math.round(parseFloat(String(dollars).replace(/[^0-9.]/g, "")) * 100) || 0;
export const toDollars = (cents) => ((Number(cents) || 0) / 100).toFixed(2).replace(/\.00$/, "");

export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
export const fmtDate = (d) => {
  if (!d) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date(d);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
export const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

export const pickupText = (o) => {
  const when = [fmtDate(o.pickup_date), o.start_time ? fmtTime(o.start_time) + (o.end_time ? "–" + fmtTime(o.end_time) : "") : ""]
    .filter(Boolean).join(", ");
  return [o.label, when, o.location].filter(Boolean).join(" · ");
};

export const ago = (iso) => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return `${Math.round(hrs / 24)} days ago`;
};

// ISO <-> <input type="datetime-local"> (browser local time)
export const isoToLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const localInputToIso = (v) => (v ? new Date(v).toISOString() : null);

export function saleState(info, now = Date.now()) {
  if (info.sale_opens_at && now < new Date(info.sale_opens_at).getTime()) return "upcoming";
  if (info.sale_closes_at && now >= new Date(info.sale_closes_at).getTime()) return "closed";
  if (info.checkout_paused) return "paused";
  return "open";
}

export function toast(msg, kind = "info") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.classList.add("out"), 3200);
  setTimeout(() => el.remove(), 3700);
}

export function friendlyError(e) {
  const m = String(e?.message ?? e ?? "");
  if (m.includes("NOT_AVAILABLE:")) return `Sorry — “${m.split("NOT_AVAILABLE:")[1].split("\n")[0]}” was just reserved by someone else. It has been removed from your cart.`;
  if (m.includes("SALE_NOT_OPEN")) return "The sale isn't open right now, so orders can't be placed.";
  if (m.includes("MISSING_FIELDS")) return "Please fill in all required fields.";
  if (m.includes("BAD_EMAIL")) return "Please enter a valid email address.";
  if (m.includes("TERMS_REQUIRED")) return "Please agree to the reservation terms.";
  if (m.includes("BAD_PICKUP")) return "Please choose a pickup option.";
  if (m.includes("EMPTY_CART")) return "Your cart is empty.";
  if (m.includes("NOT_SIGNED_IN")) return "Please sign in again.";
  if (m.includes("Invalid login")) return "That password didn't work. Please try again.";
  if (m.includes("row-level security") || m.includes("NOT_ADMIN")) return "Your admin sign-in has expired or been replaced. Please sign out and sign in again.";
  if (m.includes("PASSWORD_TOO_SHORT")) return "Passwords need at least 6 characters.";
  return m || "Something went wrong. Please try again.";
}

// CSV
export function toCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
export function downloadCsv(filename, rows) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

// Resize an image file in the browser before upload / storage.
export function resizeImage(file, maxSize = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("That file doesn't look like an image."));
    img.src = URL.createObjectURL(file);
  });
}

export const blobToDataUrl = (blob) =>
  new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

export const orderTotal = (order) =>
  (order.order_items || []).filter((i) => !i.released).reduce((s, i) => s + i.qty * i.suggested_cents, 0);

// ───── Reservation instructions ─────
// Pickup days as "12/11, 12/14, or 12/15" from the active pickup options that have dates.
export function pickupDaysText(options = []) {
  const days = [...new Set(options.filter((o) => o.pickup_date && o.active !== false).map((o) => o.pickup_date))].sort()
    .map((d) => { const [, m, day] = d.split("-").map(Number); return `${m}/${day}`; });
  if (!days.length) return "the pickup days";
  if (days.length === 1) return days[0];
  if (days.length === 2) return `${days[0]} or ${days[1]}`;
  return `${days.slice(0, -1).join(", ")}, or ${days[days.length - 1]}`;
}
export const DEFAULT_INSTRUCTIONS =
  "Once you have reserved your item, go to this link {link} and donate the suggested amount. Save your receipt — you will need it to pick up your item before or after school on {pickup_days}.";
// Plain text (for emails, copying).
export function instructionsText(template, link, options) {
  return (template || DEFAULT_INSTRUCTIONS).replaceAll("{link}", link || "").replaceAll("{pickup_days}", pickupDaysText(options));
}
// HTML with the link clickable.
export function instructionsHtml(template, link, options) {
  const parts = (template || DEFAULT_INSTRUCTIONS).split("{link}");
  const fill = (t) => esc(t.replaceAll("{pickup_days}", pickupDaysText(options)));
  const a = `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>`;
  return parts.map(fill).join(a);
}
export const DEFAULT_CREDIT = "a Cal High Ceramics 1 student";
export const credit = (artist) => `Handcrafted by ${artist || DEFAULT_CREDIT}`;

// ───── Reservation terms ─────
// One term per line. {pickup_days} and {pickup_place} are filled in from the pickup settings.
export const DEFAULT_TERMS = [
  "A reservation holds your piece — it is not a purchase. To complete it, donate the suggested amount through the FutureFund link shown after you reserve.",
  "Pickup: bring your FutureFund receipt to the {pickup_place} before or after school on {pickup_days}. Pieces are released only when a receipt is shown.",
  "Unclaimed reservations may be released back to the sale after the last pickup day.",
  "You can cancel your reservation any time before pickup using the cancel link on your reservation page or in your confirmation email. If you already donated, refunds are handled under FutureFund's and the school's policies — contact the Cal High Ceramics program with questions.",
  "Handmade by students: each piece is unique and may vary from its photos. Pieces are sold as-is. Pieces are decorative and not food- or microwave-safe unless the listing is marked “Food safe”.",
  "Donations are made to the Cal High Ceramics program through FutureFund. Refunds and tax receipts are handled under FutureFund's and the school's policies.",
  "Your information: we use your name, email, and phone only to manage your reservation and pickup. We don't share it, and we delete it after the sale.",
  "The school may change or cancel the sale or a reservation if needed. Questions? Contact the Cal High Ceramics program.",
].join("\n");
export function termsLines(template, options = []) {
  const place = [...new Set(options.filter((o) => o.active !== false).map((o) => o.location).filter(Boolean))].join(" / ") || "the pickup location";
  return (template || DEFAULT_TERMS).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replaceAll("{pickup_days}", pickupDaysText(options)).replaceAll("{pickup_place}", place));
}
export const termsHtml = (template, options) =>
  `<ol class="terms-list">${termsLines(template, options).map((l) => `<li>${esc(l)}</li>`).join("")}</ol>`;
