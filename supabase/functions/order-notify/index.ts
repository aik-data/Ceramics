// Emails the admin(s) about each new order, once per order.
// Called by the site right after place_order succeeds. Families get no email;
// the admin sends them a FutureFund invoice by hand.
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

async function sendEmail(to: string[], subject: string, html: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("FROM_EMAIL") ?? "Ceramics Sale <onboarding@resend.dev>";
  if (!key || to.length === 0) return { skipped: true };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, reply_to: replyTo }),
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

    const { data: settings } = await admin.from("settings").select("*").eq("id", 1).single();
    const siteUrl = (Deno.env.get("SITE_URL") ?? "https://aik-data.github.io/Ceramics").replace(/\/$/, "");
    const total = order.order_items.reduce((s: number, i: any) => s + i.qty * i.suggested_cents, 0);

    const rows = order.order_items
      .map((i: any) =>
        `<tr><td style="padding:6px 0">${esc(i.title)}${i.qty > 1 ? ` × ${i.qty}` : ""}<br><span style="color:#777;font-size:13px">by ${esc(i.artist)}</span></td>` +
        `<td style="padding:6px 0;text-align:right">${money(i.qty * i.suggested_cents)}</td></tr>`)
      .join("");
    const table = `<table style="width:100%;border-collapse:collapse;font-size:15px">${rows}
      <tr><td style="padding-top:10px;border-top:1px solid #ddd"><strong>Suggested total</strong></td>
      <td style="padding-top:10px;border-top:1px solid #ddd;text-align:right"><strong>${money(total)}</strong></td></tr></table>`;
    const wrap = (inner: string) =>
      `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:auto;color:#1d1c1a;line-height:1.5">${inner}</div>`;

    const adminHtml = wrap(`
      <h2 style="font-weight:500">New order ${esc(order.order_no)}</h2>
      <p><strong>${esc(order.parent_name)}</strong><br>${esc(order.email)}${order.phone ? `<br>${esc(order.phone)}` : ""}</p>
      <p>Student: ${esc(order.student_name)} — ${esc(order.student_class)}<br>Pickup: ${esc(order.pickup_label)}</p>
      ${order.notes ? `<p>Notes: ${esc(order.notes)}</p>` : ""}
      ${table}
      <p style="margin-top:24px"><a href="${siteUrl}/admin.html#/order/${order.id}"
        style="background:#1d1c1a;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">Open in admin dashboard</a></p>
      <p style="color:#777;font-size:13px">Put <strong>${esc(order.order_no)}</strong> in the FutureFund invoice memo.</p>`);

    const result = await sendEmail(
      settings.notify_emails ?? [],
      `New ceramics order ${order.order_no} — ${order.parent_name}`,
      adminHtml,
      order.email, // "Reply" goes straight to the family
    );

    return json({ ok: true, result });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
