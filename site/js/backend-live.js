// Live backend: Supabase (database, logins, photo storage, edge functions).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { resizeImage, saleState } from "./util.js";

export function createLiveBackend({ supabaseUrl, supabaseAnonKey, area = "family" }) {
  // The admin portal and the family site keep separate logins, so signing in
  // with the family password never signs an admin out (and vice versa).
  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: area === "admin",
      storageKey: area === "admin" ? "ceramics-admin-auth" : "ceramics-family-auth",
    },
  });

  let publicInfo = null;
  const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  const currentEmail = async () => (await sb.auth.getSession()).data.session?.user?.email?.toLowerCase() ?? null;

  async function log(order_id, action, detail = "") {
    const admin_email = await currentEmail();
    await sb.from("activity").insert({ order_id, action, detail, admin_email });
  }

  const api = {
    mode: "live",
    client: sb,

    // ───── Family ─────
    async getPublicInfo() {
      publicInfo = unwrap(await sb.rpc("get_public_info"));
      return publicInfo;
    },
    async familySession() {
      const email = await currentEmail();
      if (!email) return false;
      if (!publicInfo) await api.getPublicInfo();
      if (email === publicInfo.family_email.toLowerCase()) return true;
      return unwrap(await sb.rpc("is_admin")); // admins can browse the family site too
    },
    async familySignIn(password) {
      if (!publicInfo) await api.getPublicInfo();
      const { error } = await sb.auth.signInWithPassword({ email: publicInfo.family_email, password });
      if (error) throw error;
    },
    async familySignOut() { await sb.auth.signOut(); },
    async getGallery() { return unwrap(await sb.rpc("get_gallery")); },
    async placeOrder(order) {
      const res = unwrap(await sb.rpc("place_order", { p: order }));
      // Fire-and-forget emails; the order already exists even if email fails.
      sb.functions.invoke("order-notify", { body: { order_id: res.order_id } }).catch(() => {});
      return res;
    },

    // ───── Admin auth ─────
    async adminSession() {
      const email = await currentEmail();
      if (!email) return null;
      const isAdmin = unwrap(await sb.rpc("is_admin"));
      return isAdmin ? { email } : { email, notAdmin: true };
    },
    async adminSignIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const s = await api.adminSession();
      if (!s || s.notAdmin) { await sb.auth.signOut(); throw new Error("This account isn't an admin."); }
      return s;
    },
    async adminSignOut() { await sb.auth.signOut(); },
    async sendPasswordReset(email) {
      const redirectTo = location.href.split("#")[0] + "#/set-password";
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
    },
    async setOwnPassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
    },

    // ───── Admin data ─────
    async adminLoad() {
      const [settings, pieces, stock, orders, donations, pickupOptions, activity, admins] = await Promise.all([
        sb.from("settings").select("*").eq("id", 1).single().then(unwrap),
        sb.from("pieces").select("*").order("sort").order("created_at").then(unwrap),
        sb.from("piece_stock").select("*").then(unwrap),
        sb.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }).then(unwrap),
        sb.from("donations").select("*").order("donated_on", { ascending: false }).then(unwrap),
        sb.from("pickup_options").select("*").order("sort").order("pickup_date").then(unwrap),
        sb.from("activity").select("*").order("at", { ascending: false }).limit(500).then(unwrap),
        sb.from("admins").select("*").order("created_at").then(unwrap),
      ]);
      const byId = Object.fromEntries(stock.map((s) => [s.piece_id, s]));
      for (const p of pieces) Object.assign(p, { held: 0, sold: 0, available: p.quantity }, byId[p.id] ?? {});
      settings.sale_state = saleState(settings);
      return { settings, pieces, orders, donations, pickupOptions, activity, admins };
    },

    async orderAction(order, action, data = {}) {
      const now = new Date().toISOString();
      const upd = (patch) => sb.from("orders").update(patch).eq("id", order.id).then(unwrap);
      switch (action) {
        case "seen":
          if (!order.seen_at) await upd({ seen_at: now });
          return;
        case "invoice_sent":
          await upd({ status: "invoice_sent", invoice_sent_at: now, seen_at: order.seen_at ?? now });
          return log(order.id, "Invoice sent");
        case "paid":
          await upd({ status: "paid", paid_at: now, amount_received_cents: data.amount_cents, seen_at: order.seen_at ?? now });
          return log(order.id, "Marked paid", `$${(data.amount_cents / 100).toFixed(2)}`);
        case "unpaid":
          await upd({ status: "new", paid_at: null, amount_received_cents: null, picked_up_at: null });
          return log(order.id, "Payment undone");
        case "paid_picked_up":
          await upd({ status: "paid", paid_at: now, picked_up_at: now, amount_received_cents: data.amount_cents, seen_at: order.seen_at ?? now });
          return log(order.id, "Receipt checked — paid and picked up", `$${(data.amount_cents / 100).toFixed(2)}`);
        case "picked_up":
          await upd({ picked_up_at: now });
          return log(order.id, "Picked up");
        case "unpicked":
          await upd({ picked_up_at: null });
          return log(order.id, "Pickup undone");
        case "release":
          await sb.from("order_items").update({ released: true }).eq("order_id", order.id).then(unwrap);
          await upd({ status: "released", released_at: now, seen_at: order.seen_at ?? now });
          return log(order.id, "Order released", "All pieces back on sale");
        case "release_item": {
          await sb.from("order_items").update({ released: true }).eq("id", data.item.id).then(unwrap);
          const left = order.order_items.filter((i) => !i.released && i.id !== data.item.id);
          if (left.length === 0) await upd({ status: "released", released_at: now });
          return log(order.id, "Item released", data.item.title);
        }
        case "set_qty":
          await sb.from("order_items").update({ qty: data.qty }).eq("id", data.item.id).then(unwrap);
          return log(order.id, "Quantity changed", `${data.item.title}: ${data.item.qty} → ${data.qty}`);
        default:
          throw new Error("Unknown action " + action);
      }
    },

    async savePiece(piece) {
      const row = { ...piece, updated_at: new Date().toISOString() };
      for (const k of ["held", "sold", "available", "piece_id"]) delete row[k];
      if (!row.id) delete row.id;
      return unwrap(await sb.from("pieces").upsert(row).select().single());
    },
    async uploadPhoto(file) {
      const blob = await resizeImage(file);
      const path = `pieces/${crypto.randomUUID()}.jpg`;
      unwrap(await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" }));
      return sb.storage.from("photos").getPublicUrl(path).data.publicUrl;
    },
    async savePickup(opt) {
      const row = { ...opt };
      if (!row.id) delete row.id;
      for (const k of ["pickup_date", "start_time", "end_time"]) if (row[k] === "") row[k] = null;
      return unwrap(await sb.from("pickup_options").upsert(row).select().single());
    },
    async deletePickup(id) {
      // Keep options that orders already reference; just turn them off.
      const { error } = await sb.from("pickup_options").delete().eq("id", id);
      if (error) unwrap(await sb.from("pickup_options").update({ active: false }).eq("id", id));
    },
    async saveSettings(patch) {
      return unwrap(await sb.from("settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1).select().single());
    },
    async saveDonation(d) {
      const row = { ...d };
      if (!row.id) delete row.id;
      return unwrap(await sb.from("donations").upsert(row).select().single());
    },
    async deleteDonation(id) { unwrap(await sb.from("donations").delete().eq("id", id)); },
    async setFamilyPassword(pw) { unwrap(await sb.rpc("admin_set_family_password", { new_password: pw })); },
    async inviteAdmin(email) {
      const { data, error } = await sb.functions.invoke("admin-users", { body: { action: "invite", email } });
      if (error || data?.error) throw new Error(data?.error ?? error.message);
    },
    async removeAdmin(user_id) {
      const { data, error } = await sb.functions.invoke("admin-users", { body: { action: "remove", user_id } });
      if (error || data?.error) throw new Error(data?.error ?? error.message);
    },
  };
  return api;
}
