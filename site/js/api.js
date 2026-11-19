// Picks the live (Supabase) backend when configured, otherwise demo mode.
import { CONFIG } from "./config.js";

export async function getApi() {
  if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
    const { createLiveBackend } = await import("./backend-live.js");
    return createLiveBackend(CONFIG);
  }
  const { createDemoBackend } = await import("./backend-demo.js");
  return createDemoBackend();
}
