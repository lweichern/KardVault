import { updateSession } from "@/lib/supabase-middleware";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public files (icons, manifest, etc.)
     * - v/[slug] storefront pages (public, no auth)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|icons/|manifest.json|v/).*)",
  ],
};
