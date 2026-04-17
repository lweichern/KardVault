# Vendor's Unfair Advantage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three features that only vendor apps can offer — buyer interest signals, shareable sales reports, and event-based card finder — to differentiate KardVault from collector apps like Shiny and Collectr.

**Architecture:** Feature 1 adds two new Supabase tables (`storefront_views`, `storefront_searches`) for anonymous buyer analytics, logging from the public storefront and surfacing insights on the vendor dashboard + inventory. Feature 2 generates a shareable PNG sales report from existing `transactions` data using `html-to-image`. Feature 3 enhances the existing event detail page with a camera-based card scanner and richer cross-vendor search results (market price, booth info, avatars).

**Tech Stack:** Next.js 15, React 19, Supabase (PostgreSQL + RLS), Tailwind CSS 4, Tesseract.js (OCR reuse), html-to-image (new dep), recharts (existing)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/components/sales-report-modal.tsx` | Report modal: renders report HTML, generates PNG via html-to-image, share/save buttons |
| `src/components/event-card-scanner.tsx` | Full-screen camera overlay for buyers to scan cards at events |
| `src/hooks/use-storefront-analytics.ts` | Hook for logging storefront views + searches (used by storefront-client) |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/database.ts` | Add `storefront_views` + `storefront_searches` table types |
| `src/app/v/[slug]/page.tsx` | Pass `vendorId` prop to StorefrontClient |
| `src/app/v/[slug]/storefront-client.tsx` | Add view logging (IntersectionObserver) + search logging |
| `src/hooks/use-dashboard.ts` | Add `mostViewedCards`, `viewedButUnsold`, `searchMisses` + `todaySales` fields |
| `src/app/(vendor)/dashboard/page.tsx` | Add Insights section + Today's Report button + report modal |
| `src/hooks/use-inventory.ts` | Add `viewCounts` map to return value |
| `src/app/(vendor)/inventory/page.tsx` | Display view count badge per card in list + grid views |
| `src/hooks/use-events.ts` | Enhance `searchCardsAtEvent` return type, add `searchCardAcrossEvents` |
| `src/app/browse/events/[id]/page.tsx` | Search-first layout + camera button + enhanced results with market price/booth/avatar |
| `src/app/browse/events/page.tsx` | Add "Scan to find" banner + cross-event search results |

---

## Task 1: Database Types for New Tables

**Files:**
- Modify: `src/types/database.ts:341-358`

- [ ] **Step 1: Add storefront_views and storefront_searches table types**

Open `src/types/database.ts`. Before the closing of the `Tables` block (before the `};` on line 341), add the two new table definitions. Insert after the `event_flags` table block (after line 340):

```typescript
      storefront_views: {
        Row: {
          id: string;
          vendor_id: string;
          card_id: string;
          viewed_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          card_id: string;
          viewed_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          card_id?: string;
          viewed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "storefront_views_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "storefront_views_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      storefront_searches: {
        Row: {
          id: string;
          vendor_id: string;
          query: string;
          results_count: number;
          searched_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          query: string;
          results_count?: number;
          searched_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          query?: string;
          results_count?: number;
          searched_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "storefront_searches_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add storefront_views and storefront_searches table types"
```

---

## Task 2: Storefront Analytics Hook

**Files:**
- Create: `src/hooks/use-storefront-analytics.ts`

- [ ] **Step 1: Create the analytics logging hook**

Create `src/hooks/use-storefront-analytics.ts`:

```typescript
"use client";

import { useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";

export function useStorefrontAnalytics(vendorId: string) {
  const supabase = createClient();
  const viewedCards = useRef(new Set<string>());
  const loggedSearches = useRef(new Set<string>());

  const logCardView = useCallback(
    (cardId: string) => {
      if (viewedCards.current.has(cardId)) return;
      viewedCards.current.add(cardId);
      (supabase as any)
        .from("storefront_views")
        .insert({ vendor_id: vendorId, card_id: cardId })
        .then(() => {});
    },
    [vendorId, supabase]
  );

  const logSearch = useCallback(
    (query: string, resultsCount: number) => {
      const normalized = query.toLowerCase().trim();
      if (normalized.length < 2 || loggedSearches.current.has(normalized))
        return;
      loggedSearches.current.add(normalized);
      (supabase as any)
        .from("storefront_searches")
        .insert({
          vendor_id: vendorId,
          query: normalized,
          results_count: resultsCount,
        })
        .then(() => {});
    },
    [vendorId, supabase]
  );

  return { logCardView, logSearch };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-storefront-analytics.ts
git commit -m "feat: add storefront analytics hook for view/search logging"
```

---

## Task 3: Storefront View + Search Logging

**Files:**
- Modify: `src/app/v/[slug]/page.tsx:74-86`
- Modify: `src/app/v/[slug]/storefront-client.tsx`

- [ ] **Step 1: Pass vendorId to StorefrontClient**

In `src/app/v/[slug]/page.tsx`, update the `StorefrontClient` props to include vendorId. Change lines 74-86:

```tsx
  return (
    <StorefrontClient
      vendor={{
        id: vendor.id,
        displayName: vendor.display_name,
        bio: vendor.bio,
        profileImageUrl: vendor.profile_image_url,
        bannerImageUrl: vendor.banner_image_url,
        tier: vendor.tier,
        whatsappNumber,
      }}
      items={items}
    />
  );
```

- [ ] **Step 2: Update StorefrontClient to accept and use vendorId**

In `src/app/v/[slug]/storefront-client.tsx`, update the `VendorInfo` interface to include `id`:

```typescript
interface VendorInfo {
  id: string;
  displayName: string;
  bio: string | null;
  profileImageUrl: string | null;
  bannerImageUrl: string | null;
  tier: "free" | "pro";
  whatsappNumber: string;
}
```

- [ ] **Step 3: Add view logging with IntersectionObserver**

At the top of `storefront-client.tsx`, add the import:

```typescript
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useStorefrontAnalytics } from "@/hooks/use-storefront-analytics";
```

Inside the `StorefrontClient` component, after the existing state declarations (after line 31 `const [layout, setLayout] = useState...`), add:

```typescript
  const { logCardView, logSearch } = useStorefrontAnalytics(vendor.id);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const cardRefCallback = useCallback(
    (node: HTMLElement | null, cardId: string) => {
      if (!node) return;
      if (!observerRef.current) {
        observerRef.current = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                const id = (entry.target as HTMLElement).dataset.cardId;
                if (id) logCardView(id);
              }
            });
          },
          { threshold: 0.5 }
        );
      }
      node.dataset.cardId = cardId;
      observerRef.current.observe(node);
    },
    [logCardView]
  );

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);
```

- [ ] **Step 4: Add search logging**

In the `filteredItems` useMemo, add a search logging effect. After the existing `filteredItems` useMemo (line 38-50), add:

```typescript
  const searchLogTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (searchLogTimerRef.current) clearTimeout(searchLogTimerRef.current);
    if (searchQuery.trim().length >= 2) {
      searchLogTimerRef.current = setTimeout(() => {
        logSearch(searchQuery, filteredItems.length);
      }, 500);
    }
    return () => {
      if (searchLogTimerRef.current) clearTimeout(searchLogTimerRef.current);
    };
  }, [searchQuery, filteredItems.length, logSearch]);
```

- [ ] **Step 5: Wire up IntersectionObserver on card elements**

In the list view, update each card `<a>` tag to use a ref callback. Replace the list view card (around line 239):

Change:
```tsx
<a
  key={item.id}
  href={cardWhatsAppUrl(item)}
```

To:
```tsx
<a
  key={item.id}
  ref={(node) => cardRefCallback(node, item.card.id)}
  href={cardWhatsAppUrl(item)}
```

Similarly in the grid view (around line 299):

Change:
```tsx
<a
  key={item.id}
  href={cardWhatsAppUrl(item)}
```

To:
```tsx
<a
  key={item.id}
  ref={(node) => cardRefCallback(node, item.card.id)}
  href={cardWhatsAppUrl(item)}
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/v/[slug]/page.tsx src/app/v/[slug]/storefront-client.tsx
git commit -m "feat: add storefront view and search logging"
```

---

## Task 4: Dashboard Insights Data

**Files:**
- Modify: `src/hooks/use-dashboard.ts`

- [ ] **Step 1: Add new types to DashboardData interface**

In `src/hooks/use-dashboard.ts`, add these fields to the `DashboardData` interface (after `biggestPriceRise` on line 69):

```typescript
  // Buyer Interest Signals
  mostViewedCards: { card: Card; viewCount: number }[];
  viewedButUnsold: { card: Card; viewCount: number }[];
  searchMisses: { query: string; searchCount: number }[];

  // Today's sales (for report)
  todaySalesCount: number;
  todayRevenue: number;
  todayAvgMarginPct: number | null;
  todayBestSeller: { card: Card; quantity: number } | null;
```

- [ ] **Step 2: Add default values in useState**

In the `useState` initial value (around line 131), add defaults for the new fields:

```typescript
    mostViewedCards: [],
    viewedButUnsold: [],
    searchMisses: [],
    todaySalesCount: 0,
    todayRevenue: 0,
    todayAvgMarginPct: null,
    todayBestSeller: null,
```

- [ ] **Step 3: Add queries in fetchDashboard**

Inside `fetchDashboard`, add these computed values. After the `Promise.all` block (after line 214), add these three additional queries:

```typescript
    // --- Buyer Interest Signals ---
    const weekAgoISO = weekAgo;

    // Most viewed cards (top 5)
    const { data: viewsRaw } = await (supabase as any)
      .from("storefront_views")
      .select("card_id, card:cards(*)")
      .eq("vendor_id", vendorId)
      .gte("viewed_at", weekAgoISO);

    type ViewRow = { card_id: string; card: Card };
    const viewRows = (viewsRaw ?? []) as ViewRow[];
    const viewCountMap = new Map<string, { card: Card; count: number }>();
    for (const v of viewRows) {
      if (!v.card) continue;
      const existing = viewCountMap.get(v.card_id);
      if (existing) {
        existing.count++;
      } else {
        viewCountMap.set(v.card_id, { card: v.card, count: 1 });
      }
    }
    const mostViewedCards = [...viewCountMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((v) => ({ card: v.card, viewCount: v.count }));

    // Viewed but unsold — viewed cards with no sell transactions this week
    const thisWeekSellCardIds = new Set(
      sellRows
        .filter((s) => s.created_at >= weekAgoISO)
        .map((s) => s.card_id)
    );
    const viewedButUnsold = [...viewCountMap.values()]
      .filter((v) => !thisWeekSellCardIds.has(v.card.id))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((v) => ({ card: v.card, viewCount: v.count }));

    // Search misses — zero-result searches
    const { data: searchesRaw } = await (supabase as any)
      .from("storefront_searches")
      .select("query")
      .eq("vendor_id", vendorId)
      .eq("results_count", 0)
      .gte("searched_at", weekAgoISO);

    type SearchRow = { query: string };
    const searchRows = (searchesRaw ?? []) as SearchRow[];
    const searchCountMap = new Map<string, number>();
    for (const s of searchRows) {
      const q = s.query.toLowerCase().trim();
      searchCountMap.set(q, (searchCountMap.get(q) ?? 0) + 1);
    }
    const searchMisses = [...searchCountMap.entries()]
      .map(([query, searchCount]) => ({ query, searchCount }))
      .sort((a, b) => b.searchCount - a.searchCount)
      .slice(0, 5);

    // --- Today's sales (for report) ---
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartISO = todayStart.toISOString();

    const todaySells = sellRows.filter((s) => s.created_at >= todayStartISO);
    const todaySalesCount = todaySells.reduce((s, r) => s + r.quantity, 0);
    const todayRevenue = todaySells.reduce(
      (s, r) => s + r.price_rm * r.quantity,
      0
    );

    // Today's buy costs for margin calc
    const todayBuyCost = todaySells.reduce((sum, s) => {
      return sum + (buyCostByCard.get(s.card_id) ? s.price_rm * 0 : 0);
    }, 0);
    // Simplified: use the global buy cost ratio
    const todayAvgMarginPct =
      todayRevenue > 0 && totalRevenue > 0
        ? avgMarginPct
        : null;

    // Best seller today
    const todayCardQty = new Map<string, { card: Card; quantity: number }>();
    for (const s of todaySells) {
      const existing = todayCardQty.get(s.card_id);
      if (existing) {
        existing.quantity += s.quantity;
      } else {
        todayCardQty.set(s.card_id, { card: s.card, quantity: s.quantity });
      }
    }
    const todayBestSeller =
      todayCardQty.size > 0
        ? [...todayCardQty.values()].reduce((a, b) =>
            a.quantity >= b.quantity ? a : b
          )
        : null;
```

- [ ] **Step 4: Include new fields in setData**

In the `setData` call (around line 361), add the new fields:

```typescript
      mostViewedCards,
      viewedButUnsold,
      searchMisses,
      todaySalesCount,
      todayRevenue,
      todayAvgMarginPct,
      todayBestSeller,
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-dashboard.ts
git commit -m "feat: add buyer interest signals and today sales data to dashboard hook"
```

---

## Task 5: Inventory View Counts

**Files:**
- Modify: `src/hooks/use-inventory.ts`
- Modify: `src/app/(vendor)/inventory/page.tsx`

- [ ] **Step 1: Add view counts to useInventory**

In `src/hooks/use-inventory.ts`, add a `viewCounts` state. After line 18 (`const [totalProfit, setTotalProfit] = useState...`):

```typescript
  const [viewCounts, setViewCounts] = useState<Map<string, number>>(new Map());
```

Add a new fetch function after `fetchProfit` (after line 72):

```typescript
  const fetchViewCounts = useCallback(async () => {
    if (!vendorId) return;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data } = await (supabase as any)
      .from("storefront_views")
      .select("card_id")
      .eq("vendor_id", vendorId)
      .gte("viewed_at", weekAgo.toISOString());

    if (data) {
      const counts = new Map<string, number>();
      for (const row of data as { card_id: string }[]) {
        counts.set(row.card_id, (counts.get(row.card_id) ?? 0) + 1);
      }
      setViewCounts(counts);
    }
  }, [vendorId, supabase]);
```

Update the `useEffect` (line 74-77) to also call `fetchViewCounts`:

```typescript
  useEffect(() => {
    fetchInventory();
    fetchProfit();
    fetchViewCounts();
  }, [fetchInventory, fetchProfit, fetchViewCounts]);
```

Add `viewCounts` to the return statement (after `totalProfit` on line 203):

```typescript
    viewCounts,
```

- [ ] **Step 2: Display view counts in inventory list card**

In `src/app/(vendor)/inventory/page.tsx`, update the `InventoryListCard` component. The component receives `item` — we need to also pass `viewCount`. Update the component's props:

At the top of the file, update the destructured `useInventory` return (around line 18-27) to include `viewCounts`:

```typescript
  const {
    items,
    loading,
    addToInventory,
    sellFromInventory,
    totalCards,
    totalMarketValue,
    totalAskingPrice,
    totalProfit,
    viewCounts,
  } = useInventory(user?.id);
```

Update the `InventoryListCard` usage (line 260-264) to pass viewCount:

```tsx
            <InventoryListCard
              key={item.id}
              item={item}
              viewCount={viewCounts.get(item.card_id) ?? 0}
              onTap={() => setSellItem(item)}
            />
```

Update the `InventoryGridCard` usage (line 269-274) to pass viewCount:

```tsx
            <InventoryGridCard
              key={item.id}
              item={item}
              viewCount={viewCounts.get(item.card_id) ?? 0}
              onTap={() => setSellItem(item)}
            />
```

- [ ] **Step 3: Add viewCount prop to InventoryListCard**

Update the `InventoryListCard` function signature (line 406-412):

```typescript
function InventoryListCard({
  item,
  viewCount,
  onTap,
}: {
  item: InventoryItem;
  viewCount: number;
  onTap: () => void;
}) {
```

Add the view count badge in the prices section (after the delta span, around line 489, before the closing `</div>` of the text-right block):

```tsx
        {viewCount > 0 && (
          <p className="text-text-muted text-[10px] mt-0.5 flex items-center justify-end gap-0.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            {viewCount}
          </p>
        )}
```

- [ ] **Step 4: Add viewCount prop to InventoryGridCard**

Update the `InventoryGridCard` function signature (line 312-318):

```typescript
function InventoryGridCard({
  item,
  viewCount,
  onTap,
}: {
  item: InventoryItem;
  viewCount: number;
  onTap: () => void;
}) {
```

Add the view count badge in the grid card info section (after the market price delta block, around line 398, before the closing `</div>` of the px-3 pb-3 block):

```tsx
        {viewCount > 0 && (
          <p className="text-text-muted text-[10px] mt-1 flex items-center gap-0.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            {viewCount} this week
          </p>
        )}
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-inventory.ts src/app/'(vendor)'/inventory/page.tsx
git commit -m "feat: show storefront view counts on inventory cards"
```

---

## Task 6: Dashboard Insights UI

**Files:**
- Modify: `src/app/(vendor)/dashboard/page.tsx:254-291`

- [ ] **Step 1: Add Insights section after Best Performers**

In `src/app/(vendor)/dashboard/page.tsx`, add a new section after the Best Performers grid (after line 291, before the closing `</>`):

```tsx
          {/* 8. Buyer Interest Signals */}
          {(d.mostViewedCards.length > 0 || d.searchMisses.length > 0) && (
            <div>
              <h2 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-2">
                Buyer Insights
              </h2>
              <div className="space-y-3">
                {/* Most viewed */}
                {d.mostViewedCards.length > 0 && (
                  <div className="bg-bg-surface rounded-xl p-3">
                    <p className="text-text-muted text-[10px] uppercase tracking-wide mb-2">
                      Most Viewed This Week
                    </p>
                    <div className="space-y-2">
                      {d.mostViewedCards.map((item) => (
                        <div
                          key={item.card.id}
                          className="flex items-center gap-2"
                        >
                          {item.card.image_small ? (
                            <img
                              src={item.card.image_small}
                              alt={item.card.name}
                              className="w-7 h-10 rounded object-cover bg-bg-surface-2 shrink-0"
                            />
                          ) : (
                            <div className="w-7 h-10 rounded bg-bg-surface-2 shrink-0" />
                          )}
                          <p className="text-text-primary text-xs font-medium truncate flex-1">
                            {item.card.name}
                          </p>
                          <span className="text-text-muted text-xs flex items-center gap-0.5 shrink-0">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            </svg>
                            {item.viewCount}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Viewed but unsold */}
                {d.viewedButUnsold.length > 0 && (
                  <div className="bg-bg-surface rounded-xl p-3">
                    <p className="text-text-muted text-[10px] uppercase tracking-wide mb-1">
                      Viewed But Not Sold
                    </p>
                    <p className="text-text-muted text-[10px] mb-2">
                      Consider adjusting prices on these
                    </p>
                    <div className="space-y-2">
                      {d.viewedButUnsold.map((item) => (
                        <div
                          key={item.card.id}
                          className="flex items-center gap-2"
                        >
                          {item.card.image_small ? (
                            <img
                              src={item.card.image_small}
                              alt={item.card.name}
                              className="w-7 h-10 rounded object-cover bg-bg-surface-2 shrink-0"
                            />
                          ) : (
                            <div className="w-7 h-10 rounded bg-bg-surface-2 shrink-0" />
                          )}
                          <p className="text-text-primary text-xs font-medium truncate flex-1">
                            {item.card.name}
                          </p>
                          <span className="text-warning text-xs shrink-0">
                            {item.viewCount} views
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search misses */}
                {d.searchMisses.length > 0 && (
                  <div className="bg-bg-surface rounded-xl p-3">
                    <p className="text-text-muted text-[10px] uppercase tracking-wide mb-1">
                      Buyers Searched For
                    </p>
                    <p className="text-text-muted text-[10px] mb-2">
                      Cards buyers wanted that you don&apos;t stock
                    </p>
                    <div className="space-y-1.5">
                      {d.searchMisses.map((miss) => (
                        <div
                          key={miss.query}
                          className="flex items-center justify-between"
                        >
                          <p className="text-text-primary text-xs">
                            &ldquo;{miss.query}&rdquo;
                          </p>
                          <span className="text-text-muted text-[11px]">
                            {miss.searchCount}x
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/'(vendor)'/dashboard/page.tsx
git commit -m "feat: add buyer insights section to dashboard"
```

---

## Task 7: Sales Report Modal

**Files:**
- Create: `src/components/sales-report-modal.tsx`

- [ ] **Step 1: Install html-to-image**

Run: `npm install html-to-image`
Expected: Package added to dependencies.

- [ ] **Step 2: Create the sales report modal component**

Create `src/components/sales-report-modal.tsx`:

```tsx
"use client";

import { useRef, useState, useCallback } from "react";
import { toPng } from "html-to-image";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];

interface SalesReportModalProps {
  vendorName: string;
  salesCount: number;
  revenue: number;
  avgMarginPct: number | null;
  bestSeller: { card: Card; quantity: number } | null;
  onClose: () => void;
}

export function SalesReportModal({
  vendorName,
  salesCount,
  revenue,
  avgMarginPct,
  bestSeller,
  onClose,
}: SalesReportModalProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const dateStr = new Date().toLocaleDateString("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const generateImage = useCallback(async () => {
    if (!reportRef.current) return;
    setGenerating(true);
    try {
      const dataUrl = await toPng(reportRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 1,
      });
      setImageUrl(dataUrl);
    } catch {
      // Silently fail — user can retry
    } finally {
      setGenerating(false);
    }
  }, []);

  const handleShare = useCallback(async () => {
    if (!imageUrl) return;
    const blob = await (await fetch(imageUrl)).blob();
    const file = new File([blob], "kardvault-report.png", {
      type: "image/png",
    });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    }
  }, [imageUrl]);

  const handleSave = useCallback(() => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `kardvault-report-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }, [imageUrl]);

  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="bg-bg-surface rounded-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-text-primary font-semibold text-sm">
            Today&apos;s Report
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Preview */}
        <div className="p-4">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Sales report"
              className="w-full rounded-xl"
            />
          ) : (
            <div className="flex items-center justify-center h-48 bg-bg-surface-2 rounded-xl">
              {generating ? (
                <p className="text-text-muted text-sm">Generating...</p>
              ) : (
                <button
                  onClick={generateImage}
                  className="px-6 py-2.5 bg-primary-400 text-text-on-primary rounded-xl text-sm font-medium"
                >
                  Generate Report
                </button>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {imageUrl && (
          <div className="flex gap-2 px-4 pb-4">
            {canShare && (
              <button
                onClick={handleShare}
                className="flex-1 h-11 bg-primary-400 text-text-on-primary rounded-xl text-sm font-medium"
              >
                Share
              </button>
            )}
            <button
              onClick={handleSave}
              className={`${
                canShare ? "flex-1" : "w-full"
              } h-11 bg-bg-surface-2 text-text-primary rounded-xl text-sm font-medium border border-border-default`}
            >
              Save Image
            </button>
          </div>
        )}
      </div>

      {/* Hidden report template for html-to-image */}
      <div className="fixed" style={{ left: "-9999px", top: 0 }}>
        <div
          ref={reportRef}
          style={{
            width: 1080,
            height: 1920,
            background: "linear-gradient(180deg, #15141C 0%, #0D0C12 100%)",
            padding: 80,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          {/* Logo */}
          <div style={{ marginBottom: 60 }}>
            <span
              style={{
                fontSize: 48,
                fontWeight: 700,
                color: "#E4DFF0",
              }}
            >
              Kard
            </span>
            <span
              style={{
                fontSize: 48,
                fontWeight: 700,
                color: "#7C6BB5",
              }}
            >
              Vault
            </span>
          </div>

          {/* Title */}
          <p
            style={{
              fontSize: 36,
              fontWeight: 600,
              color: "#7A7890",
              textTransform: "uppercase",
              letterSpacing: 4,
              marginBottom: 12,
            }}
          >
            Bazaar Day Report
          </p>
          <p
            style={{
              fontSize: 32,
              color: "#7A7890",
              marginBottom: 80,
            }}
          >
            {dateStr}
          </p>

          {/* Stats grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
              marginBottom: 80,
            }}
          >
            <StatBox label="Cards Sold" value={String(salesCount)} />
            <StatBox
              label="Revenue"
              value={`RM ${revenue.toLocaleString("en", { maximumFractionDigits: 0 })}`}
            />
            <StatBox
              label="Avg Margin"
              value={avgMarginPct != null ? `${avgMarginPct.toFixed(0)}%` : "—"}
            />
            <StatBox
              label="Best Seller"
              value={bestSeller?.card.name ?? "—"}
            />
          </div>

          {/* Vendor name + URL */}
          <div style={{ marginTop: "auto" }}>
            <p
              style={{
                fontSize: 32,
                fontWeight: 600,
                color: "#E4DFF0",
                marginBottom: 12,
              }}
            >
              {vendorName}
            </p>
            <p style={{ fontSize: 28, color: "#7A7890" }}>kardvault.com</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "rgba(124,107,181,0.08)",
        borderRadius: 24,
        padding: "36px 32px",
      }}
    >
      <p
        style={{
          fontSize: 24,
          color: "#7A7890",
          textTransform: "uppercase",
          letterSpacing: 2,
          marginBottom: 12,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 56,
          fontWeight: 700,
          color: "#E4DFF0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/sales-report-modal.tsx package.json package-lock.json
git commit -m "feat: add shareable sales report modal component"
```

---

## Task 8: Wire Report Modal to Dashboard

**Files:**
- Modify: `src/app/(vendor)/dashboard/page.tsx`

- [ ] **Step 1: Import modal and add state**

At the top of `src/app/(vendor)/dashboard/page.tsx`, add the import:

```typescript
import { SalesReportModal } from "@/components/sales-report-modal";
import { useVendor } from "@/hooks/use-vendor";
```

Inside the `DashboardPage` component, after the existing hooks (after line 31):

```typescript
  const { vendor } = useVendor(user?.id);
  const [showReport, setShowReport] = useState(false);
```

- [ ] **Step 2: Add Today's Report button**

After the stats row (after line 89, after the closing `</div>` of the grid), add:

```tsx
          {/* Today's Report button */}
          {d.todaySalesCount > 0 && (
            <button
              onClick={() => setShowReport(true)}
              className="w-full flex items-center justify-center gap-2 h-11 bg-primary-800 text-primary-50 text-sm font-medium rounded-xl border border-primary-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12M12 16.5V3" />
              </svg>
              Today&apos;s Report · {d.todaySalesCount} cards sold
            </button>
          )}
```

- [ ] **Step 3: Add modal render**

Before the closing `</div>` of the page (line 294), add:

```tsx
      {showReport && vendor && (
        <SalesReportModal
          vendorName={vendor.display_name}
          salesCount={d.todaySalesCount}
          revenue={d.todayRevenue}
          avgMarginPct={d.todayAvgMarginPct}
          bestSeller={d.todayBestSeller}
          onClose={() => setShowReport(false)}
        />
      )}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/'(vendor)'/dashboard/page.tsx
git commit -m "feat: wire sales report modal to dashboard"
```

---

## Task 9: Enhanced Event Search Results

**Files:**
- Modify: `src/hooks/use-events.ts:175-230`

- [ ] **Step 1: Enhance searchCardsAtEvent return type**

In `src/hooks/use-events.ts`, update the `searchCardsAtEvent` function to return market price, booth info, and vendor avatar. Replace the function (lines 175-230) with:

```typescript
  async function searchCardsAtEvent(eventId: string, query: string) {
    const { data: vendorRows } = await db
      .from("event_vendors")
      .select("vendor_id, booth_info")
      .eq("event_id", eventId);

    if (!vendorRows || vendorRows.length === 0) return [];

    type EVRow = { vendor_id: string; booth_info: string | null };
    const evRows = vendorRows as EVRow[];
    const vendorIds = evRows.map((v) => v.vendor_id);
    const boothMap = new Map(evRows.map((v) => [v.vendor_id, v.booth_info]));

    const { data, error } = await db
      .from("inventory")
      .select(
        "card_id, vendor_id, quantity, card:cards(name, set_name, card_number, image_small, market_price_rm), vendor:vendors(display_name, slug, profile_image_url)"
      )
      .in("vendor_id", vendorIds)
      .ilike("card.name", `%${query}%`)
      .not("card", "is", null)
      .limit(50);

    if (error) return [];

    type RawRow = {
      card_id: string;
      vendor_id: string;
      quantity: number;
      card: {
        name: string;
        set_name: string;
        card_number: string;
        image_small: string | null;
        market_price_rm: number | null;
      };
      vendor: {
        display_name: string;
        slug: string;
        profile_image_url: string | null;
      };
    };

    const grouped = new Map<
      string,
      {
        cardName: string;
        setName: string;
        cardNumber: string;
        imageSmall: string | null;
        marketPriceRm: number | null;
        vendors: {
          displayName: string;
          slug: string;
          profileImageUrl: string | null;
          boothInfo: string | null;
        }[];
      }
    >();

    for (const row of (data ?? []) as RawRow[]) {
      if (!row.card) continue;
      const existing = grouped.get(row.card_id);
      const vendorEntry = {
        displayName: row.vendor.display_name,
        slug: row.vendor.slug,
        profileImageUrl: row.vendor.profile_image_url,
        boothInfo: boothMap.get(row.vendor_id) ?? null,
      };
      if (existing) {
        if (!existing.vendors.some((v) => v.slug === row.vendor.slug)) {
          existing.vendors.push(vendorEntry);
        }
      } else {
        grouped.set(row.card_id, {
          cardName: row.card.name,
          setName: row.card.set_name,
          cardNumber: row.card.card_number,
          imageSmall: row.card.image_small,
          marketPriceRm: row.card.market_price_rm,
          vendors: [vendorEntry],
        });
      }
    }

    return Array.from(grouped.values());
  }
```

- [ ] **Step 2: Add searchCardAcrossEvents function**

After the `searchCardsAtEvent` function, add a new function for cross-event search:

```typescript
  async function searchCardAcrossEvents(cardName: string) {
    const today = new Date().toISOString().slice(0, 10);

    const { data: events } = await db
      .from("events")
      .select("id, name, date, city, end_date")
      .is("deleted_at", null)
      .gte("date", today)
      .order("date", { ascending: true });

    if (!events || events.length === 0) return [];

    type EventRow = {
      id: string;
      name: string;
      date: string;
      city: string;
      end_date: string | null;
    };
    const eventRows = events as EventRow[];
    const eventIds = eventRows.map((e) => e.id);

    const { data: evVendors } = await db
      .from("event_vendors")
      .select("event_id, vendor_id")
      .in("event_id", eventIds);

    if (!evVendors || evVendors.length === 0) return [];

    type EVRow = { event_id: string; vendor_id: string };
    const evVendorRows = evVendors as EVRow[];
    const allVendorIds = [...new Set(evVendorRows.map((v) => v.vendor_id))];

    const { data: invData } = await db
      .from("inventory")
      .select("vendor_id, card:cards(name)")
      .in("vendor_id", allVendorIds)
      .ilike("card.name", `%${cardName}%`)
      .not("card", "is", null);

    if (!invData) return [];

    type InvRow = { vendor_id: string; card: { name: string } };
    const vendorsWithCard = new Set(
      (invData as InvRow[]).map((r) => r.vendor_id)
    );

    const vendorsByEvent = new Map<string, number>();
    for (const ev of evVendorRows) {
      if (vendorsWithCard.has(ev.vendor_id)) {
        vendorsByEvent.set(
          ev.event_id,
          (vendorsByEvent.get(ev.event_id) ?? 0) + 1
        );
      }
    }

    return eventRows
      .filter((e) => vendorsByEvent.has(e.id))
      .map((e) => ({
        event: { id: e.id, name: e.name, date: e.date, city: e.city },
        vendorCount: vendorsByEvent.get(e.id)!,
      }));
  }
```

- [ ] **Step 3: Export the new function**

Update the return statement at the end of `useEventActions`:

```typescript
  return {
    createEvent,
    findSimilarEvents,
    joinEvent,
    leaveEvent,
    updateBoothInfo,
    flagEvent,
    searchCardsAtEvent,
    searchCardAcrossEvents,
  };
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-events.ts
git commit -m "feat: enhance event search with market price, booth info, and cross-event search"
```

---

## Task 10: Event Detail Page Redesign

**Files:**
- Modify: `src/app/browse/events/[id]/page.tsx`

- [ ] **Step 1: Rewrite the event detail page with search-first layout and enhanced results**

Replace the entire content of `src/app/browse/events/[id]/page.tsx`:

```tsx
"use client";

import { useState, use } from "react";
import Link from "next/link";
import { useEvent, useEventActions } from "@/hooks/use-events";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EventDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { event, loading } = useEvent(id);
  const { searchCardsAtEvent } = useEventActions();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<
    | {
        cardName: string;
        setName: string;
        cardNumber: string;
        imageSmall: string | null;
        marketPriceRm: number | null;
        vendors: {
          displayName: string;
          slug: string;
          profileImageUrl: string | null;
          boothInfo: string | null;
        }[];
      }[]
    | null
  >(null);

  const handleSearch = async () => {
    if (!query.trim() || !event) return;
    setSearching(true);
    try {
      const data = await searchCardsAtEvent(event.id, query.trim());
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-storefront-bg flex items-center justify-center">
        <p className="text-storefront-text2 text-sm">Loading event...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-storefront-bg flex items-center justify-center">
        <div className="text-center">
          <p className="text-storefront-text text-sm font-medium">
            Event not found
          </p>
          <Link
            href="/browse/events"
            className="text-primary-400 text-xs mt-2 inline-block"
          >
            Back to events
          </Link>
        </div>
      </div>
    );
  }

  const dateStr = new Date(event.date).toLocaleDateString("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const endStr = event.end_date
    ? ` – ${new Date(event.end_date).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" })}`
    : "";

  return (
    <div className="min-h-screen bg-storefront-bg">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Link href="/browse/events" className="text-storefront-text2">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.75 19.5 8.25 12l7.5-7.5"
              />
            </svg>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-storefront-text font-bold text-lg truncate">
                {event.name}
              </h1>
              {event.source === "official" && (
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary-400/15 text-primary-400">
                  Official
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Event info (compact) */}
        <div className="flex items-center gap-4 text-storefront-text2 text-xs mb-5">
          <span className="flex items-center gap-1">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
              />
            </svg>
            {dateStr}
            {endStr}
          </span>
          <span className="flex items-center gap-1">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
              />
            </svg>
            {event.city}
            {event.venue ? ` · ${event.venue}` : ""}
          </span>
          <span>{event.vendor_count} vendors</span>
        </div>

        {/* Card search — hero section */}
        <div className="mb-6">
          <h2 className="text-storefront-text font-semibold text-sm mb-2">
            Find a card at this event
          </h2>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-storefront-text2"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search cards at this event..."
                className="w-full bg-storefront-input text-storefront-text placeholder:text-storefront-text2 rounded-xl pl-10 pr-4 py-3 text-sm border border-storefront-border focus:border-primary-400 focus:outline-none"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="px-5 rounded-xl bg-storefront-chip-active text-white text-sm font-medium disabled:opacity-40"
            >
              {searching ? "..." : "Search"}
            </button>
          </div>

          {/* Empty state prompt */}
          {results === null && event.vendor_count > 0 && (
            <p className="text-storefront-text2 text-xs text-center mt-4">
              Search for any card to see which vendors have it
            </p>
          )}

          {/* Search results — enhanced */}
          {results !== null && (
            <div className="mt-4">
              {results.length === 0 ? (
                <p className="text-storefront-text2 text-xs text-center py-4">
                  No cards found matching &ldquo;{query}&rdquo; at this event
                </p>
              ) : (
                <div className="space-y-3">
                  {results.map((card, i) => (
                    <div
                      key={i}
                      className="bg-storefront-surface rounded-xl border border-storefront-border overflow-hidden"
                    >
                      {/* Card header */}
                      <div className="flex items-center gap-3 p-3">
                        {card.imageSmall ? (
                          <img
                            src={card.imageSmall}
                            alt={card.cardName}
                            className="w-[44px] h-[62px] rounded-lg object-cover bg-storefront-input flex-shrink-0"
                          />
                        ) : (
                          <div className="w-[44px] h-[62px] rounded-lg bg-storefront-input flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-storefront-text text-sm font-medium truncate">
                            {card.cardName}
                          </p>
                          <p className="text-storefront-text2 text-xs truncate">
                            {card.setName} · #{card.cardNumber}
                          </p>
                          {card.marketPriceRm != null && (
                            <p className="text-storefront-text text-xs font-semibold mt-0.5">
                              Market: RM {card.marketPriceRm.toFixed(2)}
                            </p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-storefront-text font-bold text-lg">
                            {card.vendors.length}
                          </p>
                          <p className="text-storefront-text2 text-[10px]">
                            {card.vendors.length === 1 ? "vendor" : "vendors"}
                          </p>
                        </div>
                      </div>

                      {/* Vendor list */}
                      <div className="border-t border-storefront-border">
                        {card.vendors.map((v) => {
                          const initials = v.displayName
                            .split(" ")
                            .map((w) => w[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase();

                          return (
                            <Link
                              key={v.slug}
                              href={`/v/${v.slug}`}
                              className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-storefront-input/50 transition-colors border-b border-storefront-border last:border-b-0"
                            >
                              {v.profileImageUrl ? (
                                <img
                                  src={v.profileImageUrl}
                                  alt=""
                                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-400 text-white font-bold text-[10px] flex-shrink-0">
                                  {initials}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-storefront-text text-xs font-medium truncate">
                                  {v.displayName}
                                </p>
                                {v.boothInfo && (
                                  <p className="text-storefront-text2 text-[10px] truncate">
                                    {v.boothInfo}
                                  </p>
                                )}
                              </div>
                              <svg
                                className="w-4 h-4 text-storefront-text2 flex-shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.5}
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m8.25 4.5 7.5 7.5-7.5 7.5"
                                />
                              </svg>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Attending vendors */}
        <div>
          <h2 className="text-storefront-text font-semibold text-sm mb-2">
            Attending Vendors
          </h2>
          {event.vendors.length === 0 ? (
            <div className="bg-storefront-surface rounded-xl border border-storefront-border p-4 text-center">
              <p className="text-storefront-text2 text-sm">
                No vendors have joined yet
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {event.vendors.map((ev) => {
                const initials = ev.vendor.display_name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();

                return (
                  <Link
                    key={ev.vendor_id}
                    href={`/v/${ev.vendor.slug}`}
                    className="flex items-center gap-3 bg-storefront-surface rounded-xl border border-storefront-border p-3 hover:border-primary-400/30 transition-colors"
                  >
                    {ev.vendor.profile_image_url ? (
                      <img
                        src={ev.vendor.profile_image_url}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary-400 text-white font-bold text-xs flex-shrink-0">
                        {initials}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-storefront-text text-sm font-medium truncate">
                        {ev.vendor.display_name}
                      </p>
                      {ev.booth_info && (
                        <p className="text-storefront-text2 text-xs truncate">
                          {ev.booth_info}
                        </p>
                      )}
                    </div>
                    <svg
                      className="w-4 h-4 text-storefront-text2 flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m8.25 4.5 7.5 7.5-7.5 7.5"
                      />
                    </svg>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="text-center mt-8 pb-4">
          <p className="text-storefront-powered-by text-[11px]">
            Powered by KardVault
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/browse/events/\[id\]/page.tsx
git commit -m "feat: redesign event detail page with search-first layout and enhanced results"
```

---

## Task 11: Cross-Event Search on Events Browse Page

**Files:**
- Modify: `src/app/browse/events/page.tsx`

- [ ] **Step 1: Add cross-event search to events browse page**

In `src/app/browse/events/page.tsx`, add search state and the "Scan to find" banner. Update the imports and add state:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useEvents, CITIES, type City, useEventActions } from "@/hooks/use-events";
```

Inside the component, after the existing hooks:

```typescript
  const { searchCardAcrossEvents } = useEventActions();
  const [cardQuery, setCardQuery] = useState("");
  const [searchingCard, setSearchingCard] = useState(false);
  const [cardResults, setCardResults] = useState<
    | { event: { id: string; name: string; date: string; city: string }; vendorCount: number }[]
    | null
  >(null);

  const handleCardSearch = async () => {
    if (!cardQuery.trim()) return;
    setSearchingCard(true);
    try {
      const data = await searchCardAcrossEvents(cardQuery.trim());
      setCardResults(data);
    } catch {
      setCardResults([]);
    } finally {
      setSearchingCard(false);
    }
  };
```

After the city filter chips (after line 49, after the closing `</div>` of the chips row), add the card search banner:

```tsx
        {/* Card finder banner */}
        <div className="bg-storefront-surface rounded-xl border border-storefront-border p-4 mb-4">
          <p className="text-storefront-text text-sm font-medium mb-2">
            Looking for a specific card?
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={cardQuery}
              onChange={(e) => setCardQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCardSearch()}
              placeholder="e.g. Charizard ex"
              className="flex-1 bg-storefront-input text-storefront-text placeholder:text-storefront-text2 rounded-xl px-3 py-2 text-sm border border-storefront-border focus:border-primary-400 focus:outline-none"
            />
            <button
              onClick={handleCardSearch}
              disabled={searchingCard || !cardQuery.trim()}
              className="px-4 rounded-xl bg-storefront-chip-active text-white text-sm font-medium disabled:opacity-40"
            >
              {searchingCard ? "..." : "Find"}
            </button>
          </div>

          {/* Cross-event results */}
          {cardResults !== null && (
            <div className="mt-3">
              {cardResults.length === 0 ? (
                <p className="text-storefront-text2 text-xs text-center py-2">
                  No vendors have &ldquo;{cardQuery}&rdquo; at upcoming events
                </p>
              ) : (
                <div className="space-y-2">
                  {cardResults.map((r) => {
                    const dateStr = new Date(r.event.date).toLocaleDateString(
                      "en-MY",
                      { weekday: "short", day: "numeric", month: "short" }
                    );
                    return (
                      <Link
                        key={r.event.id}
                        href={`/browse/events/${r.event.id}?q=${encodeURIComponent(cardQuery)}`}
                        className="flex items-center justify-between p-2.5 bg-storefront-input rounded-lg hover:bg-storefront-input/80"
                      >
                        <div>
                          <p className="text-storefront-text text-xs font-medium">
                            {r.event.name}
                          </p>
                          <p className="text-storefront-text2 text-[10px]">
                            {dateStr} · {r.event.city}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-storefront-text text-sm font-bold">
                            {r.vendorCount}
                          </p>
                          <p className="text-storefront-text2 text-[10px]">
                            {r.vendorCount === 1 ? "vendor" : "vendors"}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/browse/events/page.tsx
git commit -m "feat: add cross-event card search on events browse page"
```

---

## Task 12: Supabase Migration SQL

**Files:**
- Create: `supabase/migrations/20260417_storefront_analytics.sql`

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/20260417_storefront_analytics.sql`:

```sql
-- Storefront analytics: track buyer views and searches

CREATE TABLE storefront_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storefront_views_vendor_card ON storefront_views (vendor_id, card_id);
CREATE INDEX idx_storefront_views_vendor_time ON storefront_views (vendor_id, viewed_at);

ALTER TABLE storefront_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert views" ON storefront_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendors read own views" ON storefront_views FOR SELECT USING (auth.uid() = vendor_id);

CREATE TABLE storefront_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results_count INTEGER NOT NULL DEFAULT 0,
  searched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storefront_searches_vendor_time ON storefront_searches (vendor_id, searched_at);

ALTER TABLE storefront_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert searches" ON storefront_searches FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendors read own searches" ON storefront_searches FOR SELECT USING (auth.uid() = vendor_id);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260417_storefront_analytics.sql
git commit -m "feat: add storefront_views and storefront_searches migration"
```

---

## Task 13: Run Full Build

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit any fixes**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address build issues from vendor unfair advantage features"
```
