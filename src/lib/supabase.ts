import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Browser Supabase client. Uses @supabase/ssr cookie storage (NOT plain
 * supabase-js localStorage) so the session is visible to the middleware and
 * to /api route handlers — API auth 401s for every request otherwise.
 */
export function createClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}
