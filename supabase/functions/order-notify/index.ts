// Reservation emails, sent through Resend.
//   { order_id }     → new reservation: full record to the admin(s); confirmation with a
//                      cancel link to the family when settings.email_families is on.
//   { cancel_token } → the family cancelled from their private link: notice to the admin(s).
// Each email goes out once (notified_at / cancel_notified_at are claimed atomically), and only
// for fresh events, so replaying a request does nothing.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY  – from resend.com
//   FROM_EMAIL      – optional, e.g. "Cal High Ceramics <sale@calhighceramics.org>" once the domain
//                     is verified in Resend. Defaults to Resend's shared onboarding@resend.dev,
//                     which can only deliver to the Resend account owner's email.
//   SITE_URL        – optional, defaults to https://calhighceramics.org
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

const DEFAULT_INSTRUCTIONS =
  "Once you have reserved your item, go to this link {link} and donate the suggested amount. Save your receipt — you will need it to pick up your item before or after school on {pickup_days}.";

function pickupDaysText(options: any[]) {
  const days = [...new Set(options.filter((o) => o.pickup_date && o.active).map((o) => o.pickup_date as string))].sort()
    .map((d) => { const [, m, day] = d.split("-").map(Number); return `${m}/${day}`; });
  if (!days.length) return "the pickup days";
  if (days.length === 1) return days[0];
  if (days.length === 2) return `${days[0]} or ${days[1]}`;
  return `${days.slice(0, -1).join(", ")}, or ${days[days.length - 1]}`;
}

async function sendEmail(to: string[], subject: string, html: string, text: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("FROM_EMAIL") ?? "Cal High Ceramics <onboarding@resend.dev>";
  if (!key || to.length === 0) return { skipped: true };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return await res.json();
}

const wrap = (inner: string) =>
  `<div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:auto;color:#1d1c1a;line-height:1.5">${inner}</div>`;
const kv = (k: string, v: string) =>
  `<tr><td style="padding:3px 14px 3px 0;color:#777;vertical-align:top">${k}</td><td style="padding:3px 0">${v}</td></tr>`;
const credit = (a: string) => `Handcrafted by ${a || "a Cal High Ceramics 1 student"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const siteUrl = (Deno.env.get("SITE_URL") ?? "https://calhighceramics.org").replace(/\/$/, "");

    // Claim the event so each email goes out only once, and only for fresh events.
    let order: any = null, kind: "new" | "cancel";
    if (body.order_id) {
      kind = "new";
      ({ data: order } = await admin.from("orders").update({ notified_at: new Date().toISOString() })
        .eq("id", body.order_id).is("notified_at", null).gte("created_at", since)
        .select("*, order_items(*)").maybeSingle());
    } else if (body.cancel_token) {
      kind = "cancel";
      ({ data: order } = await admin.from("orders").update({ cancel_notified_at: new Date().toISOString() })
        .eq("cancel_token", body.cancel_token).is("cancel_notified_at", null).gte("cancelled_by_family_at", since)
        .select("*, order_items(*)").maybeSingle());
    } else {
      return json({ error: "order_id or cancel_token required" }, 400);
    }
    if (!order) return json({ ok: true, already: true });

    const [{ data: settings }, { data: pickups }] = await Promise.all([
      admin.from("settings").select("*").eq("id", 1).single(),
      admin.from("pickup_options").select("*").eq("active", true),
    ]);
    const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", {
      timeZone: settings.timezone || "America/Los_Angeles", dateStyle: "full", timeStyle: "short",
    });
    const items = (order.order_items as any[]).filter((i) => kind === "cancel" || !i.released);
    const total = items.reduce((s: number, i: any) => s + i.qty * i.suggested_cents, 0);
    const placed = fmt(order.created_at);
    const link = settings.donate_url || "";
    const days = pickupDaysText(pickups ?? []);
    const places = [...new Set((pickups ?? []).map((p: any) => p.location).filter(Boolean))].join(" / ");
    const instr = (settings.instructions || DEFAULT_INSTRUCTIONS).replaceAll("{pickup_days}", days);
    const instrText = instr.replaceAll("{link}", link);
    const instrHtml = instr.split("{link}").map(esc).join(`<a href="${esc(link)}">${esc(link)}</a>`);
    const terms = String(settings.terms || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((l) => l.replaceAll("{pickup_days}", days).replaceAll("{pickup_place}", places || "the pickup location"));
    const cancelUrl = `${siteUrl}/#/cancel/${order.cancel_token}`;
    const adminUrl = `${siteUrl}/admin.html#/order/${order.id}`;
    const adminTo: string[] = settings.notify_emails ?? [];
    const replyTo: string = settings.reply_to || adminTo[0] || "";

    const rows = items.map((i: any) =>
      `<tr><td style="padding:6px 0">${esc(i.title)}${i.qty > 1 ? ` × ${i.qty}` : ""}<br><span style="color:#777;font-size:13px">${esc(credit(i.artist))}</span></td>` +
      `<td style="padding:6px 0;text-align:right">${money(i.qty * i.suggested_cents)}</td></tr>`).join("");
    const table = `<table style="width:100%;border-collapse:collapse;font-size:15px">${rows}
      <tr><td style="padding-top:10px;border-top:1px solid #ddd"><strong>Suggested donation</strong></td>
      <td style="padding-top:10px;border-top:1px solid #ddd;text-align:right"><strong>${money(total)}</strong></td></tr></table>`;
    const itemLines = items.map((i: any) => `- ${i.title}${i.qty > 1 ? ` x ${i.qty}` : ""} (${money(i.qty * i.suggested_cents)})`);
    const button = (href: string, label: string) =>
      `<p style="margin-top:22px"><a href="${href}" style="background:#c2410c;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">${label}</a></p>`;

    const results: Record<string, unknown> = {};

    if (kind === "cancel") {
      const html = wrap(`
        <h2 style="font-weight:500;margin-bottom:4px">Reservation ${esc(order.order_no)} cancelled by the family</h2>
        <p style="color:#777;margin-top:0">${esc(settings.fundraiser_name)} · cancelled ${esc(fmt(order.cancelled_by_family_at))}</p>
        <table style="font-size:15px;border-collapse:collapse">
          ${kv("Name", esc(order.parent_name))}
          ${kv("Email", `<a href="mailto:${esc(order.email)}">${esc(order.email)}</a>`)}
          ${kv("Phone", esc(order.phone))}
          ${kv("Reserved", esc(placed))}
        </table>
        <h3 style="margin:22px 0 6px;font-weight:600">Pieces returned to the sale</h3>
        ${table}
        ${button(adminUrl, "Open in admin portal")}
        <p style="color:#777;font-size:13px;margin-top:18px">If they already donated, they may contact you about a refund. Reply to this email to write to ${esc(order.parent_name)}.</p>`);
      const text = [
        `Reservation ${order.order_no} cancelled by the family — ${settings.fundraiser_name}`,
        `Cancelled: ${fmt(order.cancelled_by_family_at)}`, ``,
        `Name: ${order.parent_name}`, `Email: ${order.email}`, `Phone: ${order.phone}`, `Reserved: ${placed}`, ``,
        `Pieces returned to the sale:`, ...itemLines, `Suggested donation: ${money(total)}`, ``,
        `Admin portal: ${adminUrl}`,
      ].join("\n");
      results.admin = await sendEmail(adminTo, `Cancelled: reservation ${order.order_no} — ${order.parent_name}`, html, text, order.email)
        .catch((e) => ({ error: String(e) }));
      return json({ ok: true, results });
    }

    // ── New reservation: admin record ──
    const adminHtml = wrap(`
      <h2 style="font-weight:500;margin-bottom:4px">New reservation ${esc(order.order_no)}</h2>
      <p style="color:#777;margin-top:0">${esc(settings.fundraiser_name)} · ${esc(placed)}</p>
      <table style="font-size:15px;border-collapse:collapse">
        ${kv("Reservation", `<strong>${esc(order.order_no)}</strong>`)}
        ${kv("Name", esc(order.parent_name))}
        ${kv("Email", `<a href="mailto:${esc(order.email)}">${esc(order.email)}</a>`)}
        ${kv("Phone", esc(order.phone))}
        ${order.notes ? kv("Notes", esc(order.notes)) : ""}
        ${kv("Terms", order.terms_agreed_at ? `Agreed ${esc(fmt(order.terms_agreed_at))}` : "—")}
        ${kv("Family emailed", settings.email_families ? "Yes — confirmation with cancel link" : "No (family emails are off)")}
      </table>
      <h3 style="margin:22px 0 6px;font-weight:600">Items</h3>
      ${table}
      ${button(adminUrl, "Open in admin portal")}
      <div style="margin-top:26px;padding:16px 18px;border:1px solid #e5d9cf;border-radius:6px;background:#fff8f2">
        <p style="margin:0 0 8px;font-size:13px;color:#777;text-transform:uppercase;letter-spacing:1px">Instructions shown to the family (forward this if they lose their copy)</p>
        <p style="margin:0 0 8px">${instrHtml}</p>
        <p style="margin:0">Suggested donation: <strong>${money(total)}</strong> · Reservation number: <strong>${esc(order.order_no)}</strong>${places ? ` · Pickup: ${esc(places)}` : ""}</p>
        <p style="margin:8px 0 0;font-size:13px">Family's cancel link: <a href="${esc(cancelUrl)}">${esc(cancelUrl)}</a></p>
      </div>
      <p style="color:#777;font-size:13px;margin-top:18px">Reply to this email to write to ${esc(order.parent_name)} directly.</p>`);
    const adminText = [
      `New reservation ${order.order_no} — ${settings.fundraiser_name}`, `Reserved: ${placed}`, ``,
      `Name: ${order.parent_name}`, `Email: ${order.email}`, `Phone: ${order.phone}`,
      ...(order.notes ? [`Notes: ${order.notes}`] : []),
      ...(order.terms_agreed_at ? [`Agreed to reservation terms: ${fmt(order.terms_agreed_at)}`] : []),
      ``, `Items:`, ...itemLines, `Suggested donation: ${money(total)}`, ``,
      `Instructions shown to the family:`, instrText,
      `Reservation number: ${order.order_no}${places ? ` · Pickup: ${places}` : ""}`,
      `Family's cancel link: ${cancelUrl}`, ``,
      `Admin portal: ${adminUrl}`,
    ].join("\n");
    results.admin = await sendEmail(adminTo, `New reservation ${order.order_no} — ${order.parent_name} (${money(total)})`, adminHtml, adminText, order.email)
      .catch((e) => ({ error: String(e) }));

    // ── New reservation: family confirmation (only when switched on) ──
    if (settings.email_families) {
      const first = String(order.parent_name || "").split(" ")[0];
      const famHtml = wrap(`
        <h2 style="font-weight:500;margin-bottom:4px">You're reserved${first ? `, ${esc(first)}` : ""}!</h2>
        <p style="color:#777;margin-top:0">${esc(settings.fundraiser_name)} · Reservation <strong>${esc(order.order_no)}</strong> · ${esc(placed)}</p>
        <div style="margin:18px 0;padding:16px 18px;border:1px solid #e5d9cf;border-radius:6px;background:#fff8f2">
          <p style="margin:0 0 8px;font-weight:600">Next steps</p>
          <p style="margin:0 0 8px">${instrHtml}</p>
          <ol style="margin:0;padding-left:20px">
            <li>Donate <strong>${money(total)}</strong> on FutureFund. If there's a note field, add your reservation number <strong>${esc(order.order_no)}</strong>.</li>
            <li>Save your FutureFund receipt.</li>
            <li>Bring the receipt to pick up your pieces before or after school on <strong>${esc(days)}</strong>${places ? ` at the <strong>${esc(places)}</strong>` : ""}.</li>
          </ol>
          ${link ? button(esc(link), `Donate ${money(total)} on FutureFund`) : ""}
        </div>
        <h3 style="margin:22px 0 6px;font-weight:600">Your reservation</h3>
        ${table}
        ${terms.length ? `<h3 style="margin:24px 0 6px;font-weight:600;font-size:15px">Reservation terms you agreed to</h3>
          <ol style="margin:0;padding-left:20px;font-size:13px;color:#555">${terms.map((t) => `<li style="margin:4px 0">${esc(t)}</li>`).join("")}</ol>` : ""}
        <p style="margin-top:22px;font-size:14px">Changed your mind? <a href="${esc(cancelUrl)}">Cancel this reservation</a> any time before pickup — the pieces go back to the sale for other families.</p>
        <p style="color:#777;font-size:13px">Questions? Just reply to this email.</p>`);
      const famText = [
        `You're reserved! — ${settings.fundraiser_name}`, `Reservation ${order.order_no} · ${placed}`, ``,
        `Next steps:`, instrText,
        `1. Donate ${money(total)} on FutureFund (add ${order.order_no} in the note if you can).`,
        `2. Save your FutureFund receipt.`,
        `3. Bring the receipt to pick up before or after school on ${days}${places ? ` at the ${places}` : ""}.`, ``,
        `Your reservation:`, ...itemLines, `Suggested donation: ${money(total)}`, ``,
        ...(terms.length ? [`Reservation terms you agreed to:`, ...terms.map((t, n) => `${n + 1}. ${t}`), ``] : []),
        `Cancel any time before pickup: ${cancelUrl}`,
        `Questions? Just reply to this email.`,
      ].join("\n");
      results.family = await sendEmail([order.email], `Your reservation ${order.order_no} — ${settings.fundraiser_name}`, famHtml, famText, replyTo)
        .catch((e) => ({ error: String(e) }));
    }

    return json({ ok: true, results });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
