import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";

function cookieMethods(cookieStore: Awaited<ReturnType<typeof cookies>>): CookieMethodsServer {
  return {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
        });
      } catch {
        // Called from a Server Component — safe to ignore
      }
    }
  };
}

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods(cookieStore) }
  );
}

/** Service-role client for cron jobs / admin routes — bypasses RLS */
export async function createServiceClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: cookieMethods(cookieStore) }
  );
}
