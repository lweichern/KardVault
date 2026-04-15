# Public Storefront + QR Code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public buyer-facing storefront at `/v/[slug]` with light theme, search, filters, WhatsApp integration, and add QR code generation to the vendor's storefront tab.

**Architecture:** SSR server component fetches vendor + inventory data, passes to a client component for interactive search/filter. Separate vendor-facing page generates QR codes client-side. Next.js image config updated for card thumbnails.

**Tech Stack:** Next.js 15 (App Router, SSR), Supabase, qrcode.js, Tailwind CSS v4

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `next.config.ts` | Modify | Add `images.remotePatterns` for pokemontcg.io |
| `src/app/v/[slug]/page.tsx` | Create | SSR server component — data fetch + OpenGraph meta |
| `src/app/v/[slug]/storefront-client.tsx` | Create | Client component — search, filter, card list, WhatsApp |
| `src/app/(vendor)/storefront/page.tsx` | Rewrite | QR code display, copy link, stats |

---

### Task 1: Install qrcode and configure Next.js images

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install qrcode @types/qrcode
```

- [ ] **Step 2: Add image remote patterns to next.config.ts**

Replace the contents of `next.config.ts` with:

```ts
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
});

const nextConfig: NextConfig = {
  turbopack: {},
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pokemontcg.io" },
    ],
  },
};

export default withPWA(nextConfig);
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json next.config.ts
git commit -m "chore: add qrcode lib and configure pokemontcg.io image domain"
```

---

### Task 2: Public storefront SSR page

**Files:**
- Create: `src/app/v/[slug]/page.tsx`

**Context:** This is a Next.js App Router server component. It fetches data from Supabase on the server using the server client at `src/lib/supabase-server.ts`, which exports an async `createClient()` function. The `vendors` table has public SELECT RLS. The `inventory` table also has public SELECT RLS. The server component passes all data as props to the client component (Task 3).

**Existing types to know:**
- `Database["public"]["Tables"]["vendors"]["Row"]` — has `id`, `display_name`, `whatsapp_number`, `slug`, `bio`, `profile_image_url`, `tier`
- `Database["public"]["Tables"]["inventory"]["Row"]` — has `vendor_id`, `card_id`, `condition`, `quantity`, `sell_price_rm`
- `Database["public"]["Tables"]["cards"]["Row"]` — has `id`, `name`, `set_id`, `set_name`, `card_number`, `rarity`, `image_small`, `market_price_rm`, `tcgplayer_market_price`

- [ ] **Step 1: Create the SSR page**

Create `src/app/v/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { StorefrontClient } from "./storefront-client";
import type { Metadata } from "next";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];
type InventoryRow = Database["public"]["Tables"]["inventory"]["Row"];

export interface StorefrontItem extends InventoryRow {
  card: Card;
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: vendor } = await supabase
    .from("vendors")
    .select("display_name")
    .eq("slug", slug)
    .single();

  if (!vendor) {
    return { title: "Store Not Found | KadVault" };
  }

  return {
    title: `${vendor.display_name}'s Store | KadVault`,
    description: `Browse Pokémon TCG cards from ${vendor.display_name} on KadVault`,
    openGraph: {
      title: `${vendor.display_name}'s Store | KadVault`,
      description: `Browse Pokémon TCG cards from ${vendor.display_name}`,
      type: "website",
    },
  };
}

export default async function StorefrontPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();

  // Fetch vendor by slug
  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("*")
    .eq("slug", slug)
    .single();

  if (vendorError || !vendor) {
    notFound();
  }

  // Fetch inventory with card data
  const { data: rawItems } = await supabase
    .from("inventory")
    .select("*, card:cards(*)")
    .eq("vendor_id", vendor.id)
    .order("listed_at", { ascending: false });

  const items: StorefrontItem[] = (rawItems ?? []).map((row) => {
    const { card, ...rest } = row as Record<string, unknown>;
    return {
      ...(rest as InventoryRow),
      card: card as Card,
    };
  });

  // Strip the + from whatsapp number for wa.me links
  const whatsappNumber = vendor.whatsapp_number.replace(/^\+/, "");

  return (
    <StorefrontClient
      vendor={{
        displayName: vendor.display_name,
        bio: vendor.bio,
        profileImageUrl: vendor.profile_image_url,
        tier: vendor.tier,
        whatsappNumber,
      }}
      items={items}
    />
  );
}
```

- [ ] **Step 2: Verify it compiles (will fail on missing client component — that's expected)**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: error about missing `./storefront-client` module. This is correct — we build it in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/app/v/\[slug\]/page.tsx
git commit -m "feat: add SSR storefront page with vendor + inventory data fetch"
```

---

### Task 3: Storefront client component

**Files:**
- Create: `src/app/v/[slug]/storefront-client.tsx`

**Context:** This client component receives pre-fetched data from the server component (Task 2). All filtering is client-side — no API calls. It uses the `storefront-*` color tokens from `globals.css`. It renders the full buyer-facing UI: vendor header, stats, WhatsApp button, search, filter chips, card list, footer.

**Types it receives:**
- `vendor: { displayName: string; bio: string | null; profileImageUrl: string | null; tier: "free" | "pro"; whatsappNumber: string }`
- `items: StorefrontItem[]` where `StorefrontItem` has `card: Card`, `condition`, `quantity`, etc.

- [ ] **Step 1: Create the storefront client component**

Create `src/app/v/[slug]/storefront-client.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";
import type { StorefrontItem } from "./page";

interface VendorInfo {
  displayName: string;
  bio: string | null;
  profileImageUrl: string | null;
  tier: "free" | "pro";
  whatsappNumber: string;
}

interface StorefrontClientProps {
  vendor: VendorInfo;
  items: StorefrontItem[];
}

const CONDITION_COLORS: Record<string, string> = {
  NM: "bg-green-100 text-green-800",
  LP: "bg-blue-100 text-blue-800",
  MP: "bg-yellow-100 text-yellow-800",
  HP: "bg-orange-100 text-orange-800",
  DMG: "bg-red-100 text-red-800",
};

export function StorefrontClient({ vendor, items }: StorefrontClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSet, setActiveSet] = useState<string | null>(null);

  // Derive unique set names from inventory
  const setNames = useMemo(() => {
    const sets = new Set(items.map((item) => item.card.set_name));
    return Array.from(sets).sort();
  }, [items]);

  // Filter items by search + set
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        !searchQuery ||
        item.card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.card.set_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.card.card_number.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSet = !activeSet || item.card.set_name === activeSet;

      return matchesSearch && matchesSet;
    });
  }, [items, searchQuery, activeSet]);

  const totalCards = items.reduce((sum, i) => sum + i.quantity, 0);

  // Vendor initials for avatar
  const initials = vendor.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const generalWhatsAppUrl = `https://wa.me/${vendor.whatsappNumber}?text=${encodeURIComponent("Hi, I found your store on KadVault!")}`;

  function cardWhatsAppUrl(cardName: string) {
    return `https://wa.me/${vendor.whatsappNumber}?text=${encodeURIComponent(`I'm interested in ${cardName} from your KadVault store`)}`;
  }

  return (
    <div className="min-h-screen bg-storefront-bg">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Vendor header */}
        <div className="flex flex-col items-center mb-5">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary-400 text-white font-bold text-lg mb-2">
            {initials}
          </div>
          <h1 className="text-storefront-text font-bold text-base">
            {vendor.displayName}
          </h1>
          {vendor.bio && (
            <p className="text-storefront-text2 text-[11px] mt-0.5 text-center max-w-[280px]">
              {vendor.bio}
            </p>
          )}
        </div>

        {/* Stats row */}
        <div className="flex justify-center gap-6 mb-4">
          <div className="text-center">
            <p className="text-storefront-text font-bold text-sm">{totalCards}</p>
            <p className="text-storefront-text2 text-[10px] uppercase tracking-wide">Cards</p>
          </div>
          <div className="text-center">
            <p className="text-storefront-text font-bold text-sm">{setNames.length}</p>
            <p className="text-storefront-text2 text-[10px] uppercase tracking-wide">Sets</p>
          </div>
        </div>

        {/* WhatsApp button */}
        <a
          href={generalWhatsAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-whatsapp text-white font-medium text-sm mb-5"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
          </svg>
          Message on WhatsApp
        </a>

        {/* Search bar */}
        <div className="relative mb-3">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-storefront-text2"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cards..."
            className="w-full bg-storefront-input text-storefront-text placeholder:text-storefront-text2 rounded-xl pl-10 pr-4 py-2.5 text-sm border border-storefront-border focus:border-primary-400 focus:outline-none"
          />
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-3 mb-3 scrollbar-none">
          <button
            onClick={() => setActiveSet(null)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeSet === null
                ? "bg-storefront-chip-active text-white"
                : "bg-storefront-surface text-storefront-text2 border border-storefront-border"
            }`}
          >
            All
          </button>
          {setNames.map((setName) => (
            <button
              key={setName}
              onClick={() => setActiveSet(activeSet === setName ? null : setName)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                activeSet === setName
                  ? "bg-storefront-chip-active text-white"
                  : "bg-storefront-surface text-storefront-text2 border border-storefront-border"
              }`}
            >
              {setName}
            </button>
          ))}
        </div>

        {/* Card list */}
        {filteredItems.length === 0 && items.length === 0 && (
          <div className="text-center py-12">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-storefront-input mx-auto mb-3">
              <svg className="w-7 h-7 text-storefront-text2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
            </div>
            <p className="text-storefront-text2 text-sm">No cards listed yet</p>
          </div>
        )}

        {filteredItems.length === 0 && items.length > 0 && (
          <div className="text-center py-8">
            <p className="text-storefront-text2 text-sm">No cards match your search</p>
          </div>
        )}

        <div className="space-y-2">
          {filteredItems.map((item) => (
            <a
              key={item.id}
              href={cardWhatsAppUrl(item.card.name)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-storefront-surface rounded-xl p-3 border border-storefront-border hover:border-primary-400/30 transition-colors"
            >
              {item.card.image_small ? (
                <img
                  src={item.card.image_small}
                  alt={item.card.name}
                  className="w-[50px] h-[70px] rounded-lg object-cover bg-storefront-input flex-shrink-0"
                />
              ) : (
                <div className="w-[50px] h-[70px] rounded-lg bg-storefront-input flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-storefront-text text-[13px] font-medium truncate">
                  {item.card.name}
                </p>
                <p className="text-storefront-text2 text-[11px] truncate">
                  {item.card.set_name} · {item.card.card_number}
                </p>
                <span
                  className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    CONDITION_COLORS[item.condition] ?? "bg-gray-100 text-gray-800"
                  }`}
                >
                  {item.condition}
                </span>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-green-600 text-[10px] font-medium">Available</p>
                {item.card.market_price_rm != null && (
                  <>
                    <p className="text-storefront-text2 text-[9px] uppercase tracking-wide mt-0.5">
                      Market
                    </p>
                    <p className="text-storefront-text text-sm font-bold">
                      RM {item.card.market_price_rm.toFixed(2)}
                    </p>
                  </>
                )}
              </div>
            </a>
          ))}
        </div>

        {/* Footer */}
        <div className="text-center mt-8 pb-4">
          <p className="text-storefront-powered-by text-[11px]">
            Powered by KadVault
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the project builds**

```bash
npm run build
```

Expected: build succeeds. The `/v/[slug]` route should appear as a dynamic (`ƒ`) route in the output.

- [ ] **Step 3: Commit**

```bash
git add src/app/v/\[slug\]/page.tsx src/app/v/\[slug\]/storefront-client.tsx
git commit -m "feat: add public storefront page with search, filters, and WhatsApp"
```

---

### Task 4: Vendor storefront tab with QR code

**Files:**
- Rewrite: `src/app/(vendor)/storefront/page.tsx`

**Context:** This replaces the placeholder storefront management page. It shows the vendor's QR code, a copy-link button, and stats. It uses existing hooks: `useAuth` (`src/hooks/use-auth.ts`), `useVendor` (`src/hooks/use-vendor.ts`), `useInventory` (`src/hooks/use-inventory.ts`). Uses the `qrcode` library to generate a QR data URL client-side.

**Existing hook APIs:**
- `useAuth()` → `{ user, loading, signOut }`
- `useVendor(userId)` → `{ vendor, loading }` where vendor has `slug`, `display_name`
- `useInventory(vendorId)` → `{ items, totalCards }` where items have `card.set_name`

- [ ] **Step 1: Rewrite the storefront page**

Replace the entire contents of `src/app/(vendor)/storefront/page.tsx` with:

```tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import QRCode from "qrcode";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { useInventory } from "@/hooks/use-inventory";

export default function StorefrontPage() {
  const { user } = useAuth();
  const { vendor, loading: vendorLoading } = useVendor(user?.id);
  const { items, totalCards, loading: inventoryLoading } = useInventory(vendor?.id);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const storefrontUrl = vendor
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/v/${vendor.slug}`
    : "";

  const setCount = useMemo(() => {
    const sets = new Set(items.map((i) => i.card.set_name));
    return sets.size;
  }, [items]);

  // Generate QR code on mount / when vendor changes
  useEffect(() => {
    if (!vendor) return;

    const url = `${window.location.origin}/v/${vendor.slug}`;
    QRCode.toDataURL(url, {
      width: 200,
      margin: 2,
      color: { dark: "#1A1825", light: "#FFFFFF" },
    }).then(setQrDataUrl);
  }, [vendor]);

  async function handleCopyLink() {
    await navigator.clipboard.writeText(storefrontUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpenStorefront() {
    window.open(storefrontUrl, "_blank");
  }

  const loading = vendorLoading || inventoryLoading;

  if (loading) {
    return (
      <div className="px-4 pt-6">
        <header className="mb-6">
          <h1 className="text-xl font-bold">
            <span className="text-text-primary">Kad</span>
            <span className="text-primary-400">Vault</span>
          </h1>
          <p className="text-text-secondary text-sm mt-1">Your Storefront</p>
        </header>
        <div className="flex items-center justify-center py-20">
          <p className="text-text-muted text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="px-4 pt-6">
        <p className="text-text-muted text-sm">Sign in to view your storefront.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold">
          <span className="text-text-primary">Kad</span>
          <span className="text-primary-400">Vault</span>
        </h1>
        <p className="text-text-secondary text-sm mt-1">Your Storefront</p>
      </header>

      {/* QR Code card */}
      <div className="bg-bg-surface rounded-xl p-6 text-center mb-4">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="Storefront QR Code"
            className="w-[200px] h-[200px] mx-auto rounded-lg mb-3"
          />
        ) : (
          <div className="w-[200px] h-[200px] mx-auto rounded-lg bg-bg-surface-2 mb-3 flex items-center justify-center">
            <p className="text-text-muted text-xs">Generating...</p>
          </div>
        )}
        <p className="text-text-secondary text-xs">
          {storefrontUrl.replace(/^https?:\/\//, "")}
        </p>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={handleCopyLink}
          className="flex items-center justify-center gap-2 h-11 bg-bg-surface text-text-primary text-sm font-medium rounded-xl border border-border-default hover:bg-bg-hover transition-colors"
        >
          {copied ? (
            <>
              <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
              </svg>
              Copy Link
            </>
          )}
        </button>
        <button
          onClick={handleOpenStorefront}
          className="flex items-center justify-center gap-2 h-11 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl transition-opacity hover:opacity-90"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Open Storefront
        </button>
      </div>

      {/* Stats card */}
      <div className="bg-bg-surface rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          {totalCards > 0 ? (
            <div className="w-2 h-2 rounded-full bg-success" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-text-muted" />
          )}
          <p className="text-text-secondary text-xs font-medium">
            {totalCards > 0 ? "Your storefront is live" : "No cards listed"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wide">Cards listed</p>
            <p className="text-text-primary text-lg font-bold">{totalCards}</p>
          </div>
          <div>
            <p className="text-text-muted text-[10px] uppercase tracking-wide">Sets</p>
            <p className="text-text-primary text-lg font-bold">{setCount}</p>
          </div>
        </div>

        {totalCards === 0 && (
          <p className="text-text-muted text-xs mt-3">
            Add cards to your inventory so buyers have something to browse.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the project builds**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(vendor\)/storefront/page.tsx
git commit -m "feat: add QR code generation and share link to vendor storefront tab"
```

---

### Task 5: Build verification and smoke test

**Files:** None — verification only.

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected output should show:
- `/v/[slug]` as a dynamic (`ƒ`) route
- `/storefront` as a static (`○`) route
- No build errors

- [ ] **Step 2: Start dev server and test**

```bash
npm run dev
```

Verify in browser:

**Public storefront (`/v/{some-slug}`):**
1. Light theme background (#F8F7FC)
2. Vendor name + initials avatar at top
3. Stats row showing cards + sets count
4. Green WhatsApp button opens wa.me link
5. Search bar filters cards client-side
6. Set filter chips — "All" active by default, clicking a set filters
7. Card rows show: image, name, set, condition badge, "Available", market price (RM)
8. No asking/sell price visible anywhere
9. Tapping a card opens WhatsApp with card-specific message
10. "Powered by KadVault" footer
11. Non-existent slug shows 404

**Vendor storefront tab (`/storefront`):**
1. QR code renders (200×200px)
2. URL shown below QR
3. "Copy Link" copies to clipboard, shows "Copied!" briefly
4. "Open Storefront" opens the public page in new tab
5. Stats card shows cards + sets count
6. Green dot when inventory > 0

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address storefront issues from smoke test"
```
