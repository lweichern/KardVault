# Vendor's Unfair Advantage — Design

**Date:** 2026-04-17
**Status:** Draft
**Priority:** Build order: Feature 1 (Buyer Interest Signals) > Feature 2 (End-of-Day Report) > Feature 3 (Event Card Finder)

---

## Problem

KardVault needs to attract its first 50 vendors and become the default choice for new vendors entering the Malaysian TCG scene. Competitors (Shiny, Collectr) are collector-focused apps with strong scanning and large databases, but zero vendor-specific features. KardVault must offer capabilities that no collector app would ever build — features that only make sense if you're selling cards at physical bazaars.

### Barriers to Overcome

1. **Migration friction** — vendors already have inventory in Shiny/Collectr and don't want to re-do it
2. **No perceived need** — vendors use spreadsheets/WhatsApp and think they're fine
3. **Feature comparison anxiety** — "Shiny has a better scanner and bigger database, why switch?"

### Strategy

Build features that are impossible in collector apps because they require a vendor-buyer relationship, storefront traffic data, and event context. These create value that grows with the platform and cannot be replicated by Shiny/Collectr without fundamentally changing their product.

---

## Feature 1: Buyer Interest Signals

### What It Is

Analytics that show vendors what buyers are looking at on their storefront. No collector app can offer this because collectors don't have buyers visiting a storefront.

### Data Collected

Two new tables track anonymous buyer behavior on vendor storefronts:

**`storefront_views`** — logged when a buyer views a card on a vendor's storefront:
```sql
CREATE TABLE storefront_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storefront_views_vendor_card ON storefront_views (vendor_id, card_id);
CREATE INDEX idx_storefront_views_vendor_time ON storefront_views (vendor_id, viewed_at);
```

**`storefront_searches`** — logged when a buyer searches on a vendor's storefront:
```sql
CREATE TABLE storefront_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results_count INTEGER NOT NULL DEFAULT 0,
  searched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storefront_searches_vendor_time ON storefront_searches (vendor_id, searched_at);
```

**RLS Policies:**
- `storefront_views`: Public INSERT (anonymous buyers can log views), vendor SELECT own rows only
- `storefront_searches`: Public INSERT, vendor SELECT own rows only

**Privacy:** No buyer identity is stored — no IP, no device fingerprint, no cookies. Just card_id + vendor_id + timestamp.

### Where It Shows Up

#### 1a. Inventory List — View Count Badge

Each card in the vendor's inventory list shows a small view count next to it:

```
[Card Image] Charizard ex              RM 180.00
             Scarlet & Violet · 006/198  Market: RM 175.50 ▲2%
             NM                          👁 12 this week
```

**Implementation:** In `useInventory` hook, after fetching inventory, run a single aggregation query:
```sql
SELECT card_id, COUNT(*) as view_count
FROM storefront_views
WHERE vendor_id = $1 AND viewed_at >= NOW() - INTERVAL '7 days'
GROUP BY card_id
```

Join the counts to the inventory items client-side by card_id.

#### 1b. Dashboard — Insights Section

New section on the dashboard page, below the existing "Best Performers" grid:

**Most Viewed Cards** (top 5):
- Card image + name + view count this week
- Sorted by view count descending

**Viewed But Unsold** (top 5):
- Cards with high view counts but no sell transactions in the same period
- Signal: "Buyers want this but aren't buying — is the price too high?"
- Query: cards in `storefront_views` that have zero matching rows in `transactions` (type=sell) for the same vendor + card_id in the same 7-day window

**Buyer Search Misses** (top 5):
- Search queries where `results_count = 0`
- Grouped by normalized query (lowercase, trimmed), show count of searches
- Signal: "Buyers searched for cards you don't stock"

**Implementation:** New fields in `DashboardData` interface in `use-dashboard.ts`:
```typescript
// Buyer Interest Signals
mostViewedCards: { card: Card; viewCount: number }[];
viewedButUnsold: { card: Card; viewCount: number }[];
searchMisses: { query: string; searchCount: number }[];
```

Three additional queries in `fetchDashboard`, added to the existing `Promise.all`:
1. Top 5 viewed cards (aggregate storefront_views last 7d)
2. Viewed-but-unsold (left join storefront_views with transactions, filter where no sell)
3. Top 5 zero-result searches (aggregate storefront_searches where results_count=0, last 7d)

### Storefront Logging (Client-Side)

In `storefront-client.tsx`, add view logging:

**Card view logging:** When a buyer scrolls a card into view (using IntersectionObserver) or taps on a card in list/grid view, log ONE view per card per session. Use a `Set<string>` in component state to deduplicate — if `card_id` already in the set, skip the INSERT.

```typescript
const viewedCards = useRef(new Set<string>());

function logCardView(cardId: string, vendorId: string) {
  if (viewedCards.current.has(cardId)) return;
  viewedCards.current.add(cardId);
  supabase.from("storefront_views").insert({ vendor_id: vendorId, card_id: cardId });
}
```

**Search logging:** After search query executes (debounced, 500ms after last keystroke), log the query and result count. Deduplicate by normalizing (lowercase + trim) and tracking logged queries in a Set.

```typescript
const loggedSearches = useRef(new Set<string>());

function logSearch(vendorId: string, query: string, resultsCount: number) {
  const normalized = query.toLowerCase().trim();
  if (normalized.length < 2 || loggedSearches.current.has(normalized)) return;
  loggedSearches.current.add(normalized);
  supabase.from("storefront_searches").insert({
    vendor_id: vendorId,
    query: normalized,
    results_count: resultsCount,
  });
}
```

### Data Volume / Cleanup

At modest scale (50 vendors, ~100 buyer visits/day), this generates ~5K-15K rows/week in `storefront_views`. Manageable for free-tier Supabase.

Future: Add a weekly cron that rolls up views older than 90 days into a `storefront_views_weekly` summary table, then deletes the raw rows. Not needed for MVP.

### Non-Goals

- No buyer identity tracking (no cookies, no IP logging)
- No real-time "someone is viewing your store" notifications (future feature)
- No A/B testing of price changes based on views (way too early)

---

## Feature 2: End-of-Day Sales Report (Shareable)

### What It Is

A vendor taps "Generate Report" after a bazaar day and gets a beautiful card-style image summarizing their sales. Shareable to Instagram Stories, WhatsApp Status, or saved as PNG. Every shared report is free marketing for KardVault.

### Report Content

```
┌──────────────────────────────────────────┐
│                                          │
│  [KardVault logo]                        │
│                                          │
│  📊 BAZAAR DAY REPORT                   │
│  Sunday, 20 Apr 2026                     │
│                                          │
│  ┌────────────┐  ┌────────────┐          │
│  │ Cards Sold │  │  Revenue   │          │
│  │     23     │  │  RM 847    │          │
│  └────────────┘  └────────────┘          │
│  ┌────────────┐  ┌────────────┐          │
│  │ Avg Margin │  │ Best Seller│          │
│  │    32%     │  │ Charizard  │          │
│  └────────────┘  └────────────┘          │
│                                          │
│  {vendor display name}                   │
│  kardvault.com                           │
│                                          │
└──────────────────────────────────────────┘
```

### Data Source

All data comes from the existing `transactions` table, filtered to today's date:

```sql
SELECT t.*, c.name, c.image_small, c.set_name
FROM transactions t
JOIN cards c ON t.card_id = c.id
WHERE t.vendor_id = $1
  AND t.type = 'sell'
  AND t.created_at >= $today_start
  AND t.created_at < $tomorrow_start
ORDER BY t.created_at DESC
```

Aggregations (all client-side from the query result):
- **Cards Sold:** SUM(quantity)
- **Revenue:** SUM(price_rm * quantity)
- **Avg Margin:** (total_revenue - total_buy_cost) / total_revenue * 100. Buy cost from matching buy transactions for the same card_ids. If no buy price data, show "—" instead of a misleading number.
- **Best Seller:** Card with highest SUM(quantity) sold today. Show card name only.

### Image Generation

Use `html-to-image` library (lightweight, ~5KB gzipped) to render a hidden HTML div as a PNG:

1. Render report as a styled `<div>` (not displayed to user — offscreen or `position: absolute; left: -9999px`)
2. Call `toPng(element)` from `html-to-image`
3. Result is a data URL — display as preview, then offer share/save

**Why `html-to-image` over `html2canvas`:** Smaller bundle, simpler API, no canvas dependency issues on mobile browsers. Both work, but `html-to-image` is lighter.

### Share Flow

1. Vendor navigates to Dashboard
2. Taps "Today's Report" button (below the stats row, only visible if there are sales today)
3. Report card renders with today's data
4. Preview shown in a modal
5. Two action buttons:
   - **"Share"** — uses Web Share API (`navigator.share({ files: [pngBlob] })`) which opens native share sheet (Instagram, WhatsApp, etc.)
   - **"Save Image"** — downloads PNG via `<a download>` fallback
6. If Web Share API not available (desktop browsers), only show "Save Image"

### UI Location

New button on the Dashboard page, in the stats row area:

```tsx
{cardsSoldToday > 0 && (
  <button onClick={openReport} className="...">
    Today's Report
  </button>
)}
```

The report modal is a new component: `components/sales-report-modal.tsx`.

### Report Styling

- Dark theme matching the app (obsidian bg, violet accents)
- 1080×1920px aspect ratio (Instagram Stories optimal)
- KardVault logo top-left (small, not dominant)
- Vendor's display name at bottom
- "kardvault.com" URL at very bottom (the marketing hook)
- No vendor's asking prices or specific card prices shown — just aggregate stats

### Non-Goals

- Custom date range reports (future — just today for now)
- PDF export (overkill for social sharing)
- Automatic posting to social media (vendor shares manually)
- Multiple report templates/themes (one design, keep it simple)

---

## Feature 3: Event Card Finder (Buyer-Facing)

### What It Is

Buyers at an event can search or scan a card name and instantly see which vendors attending that event have the card in their inventory. This extends the existing event detail page (`/browse/events/[id]`) with a more prominent, buyer-friendly card search experience.

### Current State

The event detail page (`src/app/browse/events/[id]/page.tsx`) already has a cross-vendor search implemented via `searchCardsAtEvent()` in `use-events.ts`. It:
- Takes an event ID + text query
- Fetches vendor IDs from `event_vendors` for that event
- Queries `inventory` for matching cards across those vendors
- Groups results by card, showing vendor names + storefront links
- Shows NO prices (by design — drives foot traffic)

### What We're Adding

The existing search works but is buried in the event detail page. We need to make it the hero feature of the buyer's event experience:

#### 3a. Prominent Search UI

Redesign the event detail page to lead with the card search:

- Move the search bar to the TOP of the page, right below the event header
- Larger search input with a camera icon button next to it
- Placeholder text: "Find a card at this event..."
- Search results appear inline, pushing vendor list below
- Empty state when no search: show "Search for any card to see which vendors have it" with an illustration

#### 3b. Camera Scan Option

Add a camera scan button next to the search bar that lets buyers identify a card visually:

1. Buyer taps camera icon next to search
2. Camera opens (reuses existing `useCamera` hook)
3. Buyer points at a card they're interested in
4. OCR pipeline runs (reuses existing `lib/recognition/ocr.ts` + `parser.ts`)
5. If OCR identifies the card → auto-populates search and runs the cross-vendor query
6. If OCR fails → autocomplete search appears (reuses `useCardSearch` hook)
7. Results show which vendors at the event have this card

**Key reuse:** The entire camera → OCR → search pipeline exists in the scan page. We extract the identification logic into a reusable flow and wire it to the event search context instead of the "add to inventory" context.

**Camera UI:** Opens as a full-screen overlay modal (not a new page), consistent with the vendor scan page. Back button dismisses and returns to the event page. After card identification, the modal closes and the search field is populated with the result.

#### 3c. Search Results Enhancement

Enhance the existing search results to be more useful for buyers:

Current result card:
```
[Card Image] Charizard ex
             Scarlet & Violet · #006/198
             [Vendor A] [Vendor B] [Vendor C]     3 vendors
```

Enhanced result card:
```
[Card Image] Charizard ex
             Scarlet & Violet · #006/198
             Market: RM 175.50
             ─────────────────────────
             [Avatar] Vendor A · Booth A12  →
             [Avatar] Vendor B · Near entrance  →
             [Avatar] Vendor C  →
```

Changes:
- Show market price (from `cards` table) so buyers know the reference price before asking vendors
- Show booth info (from `event_vendors.booth_info`) so buyers can physically find the vendor
- Each vendor row links to their storefront (`/v/{slug}`)
- Vendor profile photo (avatar) for recognition at the event

#### 3d. "Scan to Find" Entry Point from Event List

On the event browse page (`/browse/events`), add a floating action button or banner:

```
┌─────────────────────────────────────┐
│ 📷 Scan a card to find it here     │
└─────────────────────────────────────┘
```

This opens the camera directly from the events list. After identifying the card, it searches across ALL upcoming events' vendors (not just one event). Results grouped by event:

```
Charizard ex · Scarlet & Violet · #006

🗓 Comic Fiesta (Apr 26-27)
  3 vendors have this card

🗓 PJ TCG Weekend (Apr 20)
  1 vendor has this card
```

Tapping an event result navigates to that event's detail page with the search pre-filled.

### Technical Implementation

#### New Hook: `useEventCardSearch`

```typescript
// hooks/use-event-card-search.ts

interface EventCardSearchResult {
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

interface CrossEventSearchResult {
  event: {
    id: string;
    name: string;
    date: string;
    city: string;
  };
  vendorCount: number;
}
```

The hook wraps two query patterns:
1. **Single event search** (existing `searchCardsAtEvent` logic, enhanced to return market price + booth info + avatar)
2. **Cross-event search** (new: given a card_id, find all upcoming events where at least one vendor stocks it)

#### Modifications to Existing Files

**`src/app/browse/events/[id]/page.tsx`:**
- Restructure layout: search at top, results inline, vendor list below
- Add camera scan button next to search input
- Use enhanced result cards with market price + booth info

**`src/hooks/use-events.ts`:**
- Enhance `searchCardsAtEvent` return type to include `market_price_rm`, `booth_info`, `profile_image_url`
- Add new `searchCardAcrossEvents` function

**`src/app/browse/events/page.tsx`:**
- Add "Scan to find" floating button
- Add cross-event search results view

### Design Rules (Unchanged from Spec)

- **NO vendor asking prices shown** — only market price from `cards` table
- Buyers see card name, market price, vendor names, and booth info
- To see the vendor's actual price, they must visit the booth or WhatsApp

### Non-Goals

- No "reserve" or "hold" functionality — all transactions happen in person
- No buyer accounts — search is fully anonymous, no login required
- No distance/geolocation within an event venue — just booth info text

---

## Database Migrations Summary

Two new tables needed (Feature 1 only). Features 2 and 3 use existing tables.

```sql
-- Feature 1: Buyer Interest Signals
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

---

## Files to Create or Modify

### New Files
| File | Feature | Purpose |
|------|---------|---------|
| `components/sales-report-modal.tsx` | 2 | Report generation modal with html-to-image |
| `hooks/use-event-card-search.ts` | 3 | Enhanced event card search with camera + cross-event |
| `components/event-card-scanner.tsx` | 3 | Camera scan UI for buyer card identification at events |

### Modified Files
| File | Feature | Changes |
|------|---------|---------|
| `app/v/[slug]/storefront-client.tsx` | 1 | Add view logging (IntersectionObserver) + search logging |
| `app/v/[slug]/page.tsx` | 1 | Pass vendor_id to client component for logging |
| `hooks/use-dashboard.ts` | 1 | Add mostViewedCards, viewedButUnsold, searchMisses queries |
| `app/(vendor)/dashboard/page.tsx` | 1, 2 | Add Insights section + Today's Report button/modal |
| `hooks/use-inventory.ts` | 1 | Add view counts to inventory items |
| `app/(vendor)/inventory/page.tsx` | 1 | Display view count badge per card |
| `types/database.ts` | 1 | Add storefront_views + storefront_searches table types |
| `app/browse/events/[id]/page.tsx` | 3 | Restructure with search-first layout + camera + enhanced results |
| `hooks/use-events.ts` | 3 | Enhance searchCardsAtEvent return type, add searchCardAcrossEvents |
| `app/browse/events/page.tsx` | 3 | Add "Scan to find" button + cross-event search |

### New Dependencies
| Package | Feature | Purpose |
|---------|---------|---------|
| `html-to-image` | 2 | Render report div to PNG for sharing |

---

## Success Metrics

- **Feature 1:** Vendors check their insights at least once per week. At least 50% of vendors with storefront traffic view the insights section.
- **Feature 2:** At least 30% of vendors who make sales generate and share a report. Shared reports drive measurable signups (track via UTM or referral).
- **Feature 3:** Buyers at events use the card finder before visiting vendor booths. Cross-event search drives event page views.
