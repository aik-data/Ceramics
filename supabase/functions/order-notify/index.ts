// Emails the admin(s) a complete, forward-ready record of each new reservation.
// Called by the site right after place_order succeeds. Families get no email,
// so this message is the log the admin can forward if a family loses their copy.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY  – from resend.com (free tier)
//   FROM_EMAIL      – optional. Defaults to Resend's shared "onboarding@resend.dev",
//                     which needs no domain but can only deliver to the email
//                     address that owns the Resend account.
//   SITE_URL        – optional, defaults to the GitHub Pages address
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
    body: JSON.stringify({ from, to, subject, html, text, reply_to: replyTo }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: "order_id required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Claim the notification atomically so emails go out only once per order,
    // and only for fresh orders (stops anyone replaying old order ids).
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: order, error } = await admin
      .from("orders")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", order_id)
      .is("notified_at", null)
      .gte("created_at", since)
      .select("*, order_items(*)")
      .maybeSingle();
    if (error) throw error;
    if (!order) return json({ ok: true, already: true });

    const [{ data: settings }, { data: pickups }] = await Promise.all([
      admin.from("settings").select("*").eq("id", 1).single(),
      admin.from("pickup_options").select("*").eq("active", true),
    ]);
    const siteUrl = (Deno.env.get("SITE_URL") ?? "https://aik-data.github.io/Ceramics").replace(/\/$/, "");
    const items = order.order_items.filter((i: any) => !i.released);
    const total = items.reduce((s: number, i: any) => s + i.qty * i.suggested_cents, 0);
    const placed = new Date(order.created_at).toLocaleString("en-US", {
      timeZone: settings.timezone || "America/Los_Angeles", dateStyle: "full", timeStyle: "short",
    });
    const link = settings.donate_url || "";
    const days = pickupDaysText(pickups ?? []);
    const places = [...new Set((pickups ?? []).map((p: any) => p.location).filter(Boolean))].join(" / ");
    const instr = (settings.instructions || DEFAULT_INSTRUCTIONS).replaceAll("{pickup_days}", days);
    const instrText = instr.replaceAll("{link}", link);
    const instrHtml = instr.split("{link}").map(esc).join(`<a href="${esc(link)}">${esc(link)}</a>`);
    const credit = (a: string) => `Handcrafted by ${a || "a Cal High Ceramics 1 student"}`;

    const rows = items
      .map((i: any) =>
        `<tr><td style="padding:6px 0">${esc(i.title)}${i.qty > 1 ? ` × ${i.qty}` : ""}<br><span style="color:#777;font-size:13px">${esc(credit(i.artist))}</span></td>` +
        `<td style="padding:6px 0;text-align:right">${money(i.qty * i.suggested_cents)}</td></tr>`)
      .join("");
    const table = `<table style="width:100%;border-collapse:collapse;font-size:15px">${rows}
      <tr><td style="padding-top:10px;border-top:1px solid #ddd"><strong>Suggested donation</strong></td>
      <td style="padding-top:10px;border-top:1px solid #ddd;text-align:right"><strong>${money(total)}</strong></td></tr></table>`;
    const kv = (k: string, v: string) => `<tr><td style="padding:3px 14px 3px 0;color:#777;vertical-align:top">${k}</td><td style="padding:3px 0">${v}</td></tr>`;

    const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:auto;color:#1d1c1a;line-height:1.5">
      <h2 style="font-weight:500;margin-bottom:4px">New reservation ${esc(order.order_no)}</h2>
      <p style="color:#777;margin-top:0">${esc(settings.fundraiser_name)} · ${esc(placed)}</p>
      <table style="font-size:15px;border-collapse:collapse">
        ${kv("Reservation", `<strong>${esc(order.order_no)}</strong>`)}
        ${kv("Name", esc(order.parent_name))}
        ${kv("Email", `<a href="mailto:${esc(order.email)}">${esc(order.email)}</a>`)}
        ${kv("Phone", esc(order.phone))}
        ${order.notes ? kv("Notes", esc(order.notes)) : ""}
      </table>
      <h3 style="margin:22px 0 6px;font-weight:600">Items</h3>
      ${table}
      <p style="margin-top:22px"><a href="${siteUrl}/admin.html#/order/${order.id}"
        style="background:#c2410c;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">Open in admin portal</a></p>
      <div style="margin-top:26px;padding:16px 18px;border:1px solid #e5d9cf;border-radius:6px;background:#fff8f2">
        <p style="margin:0 0 8px;font-size:13px;color:#777;text-transform:uppercase;letter-spacing:1px">Instructions shown to the family (forward this if they lose their copy)</p>
        <p style="margin:0 0 8px">${instrHtml}</p>
        <p style="margin:0">Suggested donation: <strong>${money(total)}</strong> · Reservation number: <strong>${esc(order.order_no)}</strong>${places ? ` · Pickup: ${esc(places)}` : ""}</p>
      </div>
      <p style="color:#777;font-size:13px;margin-top:18px">Reply to this email to write to ${esc(order.parent_name)} directly.</p>
    </div>`;

    const text = [
      `New reservation ${order.order_no} — ${settings.fundraiser_name}`,
      `Reserved: ${placed}`,
      ``,
      `Name: ${order.parent_name}`,
      `Email: ${order.email}`,
      `Phone: ${order.phone}`,
      ...(order.notes ? [`Notes: ${order.notes}`] : []),
      ``,
      `Items:`,
      ...items.map((i: any) => `- ${i.title}${i.qty > 1 ? ` x ${i.qty}` : ""} (${money(i.qty * i.suggested_cents)})`),
      `Suggested donation: ${money(total)}`,
      ``,
      `Instructions shown to the family:`,
      instrText,
      `Reservation number: ${order.order_no}${places ? ` · Pickup: ${places}` : ""}`,
      ``,
      `Admin portal: ${siteUrl}/admin.html#/order/${order.id}`,
    ].join("\n");

    const result = await sendEmail(
      settings.notify_emails ?? [],
      `New reservation ${order.order_no} — ${order.parent_name} (${money(total)})`,
      html,
      text,
      order.email, // "Reply" goes straight to the family
    );

    return json({ ok: true, result });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
