// Admin-only: invite a new admin by email, or remove one.
// Body: { action: "invite", email } | { action: "remove", user_id }
// Optional secret: SITE_URL (where the invite link lands).

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Who is calling? Must be an existing admin.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data: { user } } = await service.auth.getUser(jwt);
    if (!user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await service.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!me) return json({ error: "Admins only" }, 403);

    const body = await req.json();

    if (body.action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Invalid email" }, 400);
      const siteUrl = (Deno.env.get("SITE_URL") ?? "https://calhighceramics.org").replace(/\/$/, "");

      let userId: string | undefined;
      const invited = await service.auth.admin.inviteUserByEmail(email, {
        redirectTo: siteUrl ? `${siteUrl}/admin.html#/set-password` : undefined,
      });
      if (invited.error) {
        // Already has an account? Look it up instead.
        const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
        userId = list?.users.find((u) => u.email?.toLowerCase() === email)?.id;
        if (!userId) throw invited.error;
      } else {
        userId = invited.data.user.id;
      }
      const { error } = await service.from("admins").upsert({ user_id: userId, email });
      if (error) throw error;
      return json({ ok: true, user_id: userId });
    }

    if (body.action === "remove") {
      if (body.user_id === user.id) return json({ error: "You can't remove yourself" }, 400);
      const { error } = await service.from("admins").delete().eq("user_id", body.user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
