# KardVault — Vendor-First TCG Inventory & Storefront Platform

## What This Is

KardVault is a mobile-first PWA that helps TCG bazaar vendors in Malaysia digitize their card inventory through camera scanning, manage pricing against live market data, track profit/loss, and generate a QR-code storefront that buyers can browse instantly on their phones.

**Target user:** Pokémon TCG vendors at Malaysian weekend bazaars, comic conventions, and TCG market events. They sell from binders at folding tables, price cards manually, and have zero digital tooling.

**Initial TCG support:** Pokémon only.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Next.js 15 (PWA) + Tailwind CSS | PWA for Add-to-Home-Screen app-like experience |
| Backend/DB | Supabase (PostgreSQL + Auth + Storage + Realtime) | Row Level Security on all tables |
| Auth | Supabase Auth — phone OTP | Malaysian vendors prefer phone login over email |
| Card Recognition | Autocomplete search (primary) + Tesseract.js OCR (accelerator) | Hybrid: fast text search against local DB, OCR pre-fills when it works |
| Card Data | pokemontcg.io API (free, 20K req/day) | Nightly sync to local Supabase `cards` table — no live API calls during scanning |
| Image Storage | Supabase Storage (S3-compatible) | Card condition photos + vendor profile images |
| Hosting | Vercel (Singapore region) | Edge deployment close to SEA users |
| QR Generation | qrcode.js (client-side) | No server cost |
| Payment | Billplz or Revenue Monster | Malaysian FPX bank transfers + eWallets |
| Analytics | PostHog (free tier) | Product analytics |

### Why PWA, Not Native

- Buyer storefront MUST be a website (no app download friction at bazaars), so web is built regardless
- Single codebase serves vendors + buyers + storefront
- Instant deployment via Vercel, no App Store review delays
- Browser camera API is sufficient for card scanning
- If native features needed later, wrap with Capacitor (same codebase)

---

## Core Features (MVP)

### 1. Single Card Scan
- Vendor opens camera → takes photo of card → OCR attempts to read card number in background
- If OCR succeeds: card auto-populates with name, set, artwork, market price
- If OCR fails: search field appears, vendor types first 2-3 characters → autocomplete from local DB
- Same UI either way — OCR just pre-fills the search, vendor doesn't see "OCR failed" errors
- Vendor sets sell price (default: market price), tags condition (NM/LP/MP/HP/DMG)
- Scan photo saved as condition proof
- Taps "Add to Inventory" or "Remove from Inventory"
- **The full flow (scan → identify → confirm → add) must complete in under 5 seconds per card**

### 2. Binder Page Scan (Pro tier only)
- Vendor photographs a full 9-pocket binder page
- Image segmentation splits photo into 3×3 grid
- Each cell runs OCR independently — successfully identified cards auto-populate
- Unidentified cards show "Tap to search" with the cropped image
- Vendor reviews grid, manually searches any missed cards
- Sets batch pricing rule (e.g. all at market price, all at 80% of market), confirms all

### 3. Inventory Management
- Searchable, sortable list of all cards in stock
- Each entry: card image, name, set, condition, asking price, market price with delta indicator
- **Add stock:** scan → confirm → set buy price + sell price → add
- **Remove stock (sold):** scan → match against inventory → confirm sale price → remove + log sale
- Duplicates: show quantity, decrement by 1 on removal
- Bulk actions: select multiple cards for price adjustment or removal

### 4. QR Code Storefront
- Each vendor gets a unique QR code + short URL: `kardvault.com/v/{slug}`
- Buyer scans QR → mobile-optimized catalog loads instantly (no app download)
- Search, filter by set/type/condition, sort by name
- **Listings show card name, set, condition, and market price only — NOT the vendor's asking price**
- Vendor's asking price is never visible to buyers — they must ask in person
- This encourages face-to-face interaction and protects vendors from price undercutting
- WhatsApp button: pre-filled message "I'm interested in [card name]" (no price included)
- Free tier: "Powered by KardVault" watermark. Pro tier: clean + vendor branding

### 5. Profit Dashboard (Pro tier only)
- Total inventory value (market price vs asking price)
- Sales log: today / this week / this month with revenue totals
- Per-card profit: buy price vs sell price with margin percentage
- Best-selling cards, highest-margin cards
- Inventory aging: cards held 30/60/90+ days without sale

### 6. CSV/Excel Import
- Vendor uploads a CSV or Excel (.xlsx) file from their existing spreadsheet
- App auto-detects column mapping using header matching + data pattern analysis
- Vendor sees a mapping confirmation screen: "We think Column A is Card Name, Column C is Price — is that right?" with dropdowns to correct
- Each card name gets fuzzy-matched against the local `cards` table using PostgreSQL trigram similarity
- Preview screen shows matched vs unmatched cards — vendor confirms before adding to inventory
- Also offer a downloadable KardVault CSV template for vendors who want to start fresh

**Auto-detection logic (no AI needed):**

```
Header matching — check column headers against alias dictionaries:
  Card name: ['name', 'card name', 'card', 'item', 'product', 'card_name']
  Price:     ['price', 'sell price', 'value', 'rm', 'cost', 'amount', 'sell']
  Set:       ['set', 'set name', 'expansion', 'series']
  Condition: ['condition', 'cond', 'grade', 'quality']
  Card #:    ['number', 'card number', 'no', '#', 'card_number']
  Quantity:  ['qty', 'quantity', 'count', 'amount']
  Buy price: ['buy price', 'cost price', 'purchase price', 'paid']

Data pattern matching (fallback if headers don't match):
  Column with values like '025/198' or 'SV1-025' → card number
  Column with all numbers between 1–10000 → price
  Column with known set names → set
  Column with 'NM','LP','MP','HP','DMG' → condition
```

**Libraries:**
- Papa Parse (client-side CSV parsing, handles messy files)
- SheetJS (client-side .xlsx reading)
- Both run in browser, no server processing needed

**Database:** Enable `pg_trgm` extension in Supabase for fuzzy name matching:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_cards_name_trgm ON cards USING gin (name gin_trgm_ops);
-- Query: SELECT * FROM cards WHERE similarity(name, 'Charizard Ex') > 0.3 ORDER BY similarity(name, 'Charizard Ex') DESC LIMIT 5;
```

---

## Card Recognition System

### Strategy: Hybrid Search-First + OCR-Assist

Pure OCR on card numbers is unreliable in real-world conditions (tiny text, foil glare, worn cards, bad lighting at bazaars). Realistic accuracy is 60-75%, not good enough as the sole identification method.

**The approach: autocomplete search as the primary flow, OCR as an optional accelerator.**

The UI is a single unified flow regardless of whether OCR works:

1. Vendor taps scan → camera opens
2. OCR runs in background on the card photo (Tesseract.js, client-side)
3. If OCR reads a card number successfully → auto-populates the search field and shows the matched card
4. If OCR fails or is uncertain → search field is empty, vendor types first 2-3 characters of card name
5. Autocomplete dropdown shows matching cards from the local database (instant, no API call)
6. Vendor taps correct card → confirmation screen with card image, set, market price
7. Vendor sets price, condition → adds to inventory

**Key insight:** The fallback is NOT a separate "manual search" mode. It's the same UI. OCR just pre-fills the search. If it works, the vendor saves 2 seconds of typing. If it doesn't, they type a few characters and tap. Either way, the flow is fast.

### Card Data Pipeline

The entire Pokémon TCG card database (~20,000 cards) is synced to the local Supabase `cards` table. Card lookups during scanning are local database queries — instant, free, unlimited.

**Data source:** pokemontcg.io API (free, 20,000 requests/day with API key)

**Sync strategy:**
1. Initial bulk sync: pull all cards from pokemontcg.io → insert into `cards` table (one-time, ~20K cards)
2. Nightly cron job: fetch cards updated since last sync → upsert into `cards` table
3. Price refresh: update `tcgplayer_market_price` field every 6 hours
4. New set releases: automatically picked up by the nightly sync

**No live API calls during scanning.** The pokemontcg.io API is only used server-side by the cron job. Vendors never hit rate limits.

### Autocomplete Search Implementation

- Supabase full-text search on `cards.name` with trigram index for fuzzy matching
- Search query runs against local DB, returns in <100ms
- Results show card image thumbnail + name + set + market price
- Filter by set (vendor can pre-select active set to narrow results)
- Most vendors know their cards by name — "Charizard ex", "Pikachu VMAX" — so 2-3 characters is enough to find the right card

### OCR Pipeline (Accelerator, Not Primary)

1. Camera captures card photo
2. Client-side preprocessing: crop bottom 20% of card (where number is printed), enhance contrast
3. Tesseract.js extracts text
4. Regex attempts to parse card number pattern (e.g. `025/198`, `SV1EN-025`, `TG15/TG30`)
5. If valid number found → query `cards` table by `card_number` + optional `set_id`
6. If match found with high confidence → auto-populate search and show result
7. If no match or low confidence → silently fall through to empty search field (no error message)

The OCR should feel invisible. When it works, the card just appears. When it doesn't, the vendor doesn't even know OCR was attempted — they just search normally.

### Binder Page Scan Pipeline

1. Vendor photographs full 9-pocket binder page
2. Image segmentation divides photo into 3×3 grid (fixed pocket positions based on standard binder page dimensions)
3. Each cell runs through OCR pipeline independently
4. Results displayed as 3×3 grid:
   - Successfully identified cards show name + market price with green checkmark
   - Failed identifications show "Tap to search" with the cropped card image
5. Vendor reviews grid, taps any unidentified slots to manually search
6. Sets batch pricing rule (e.g. all at market price, all at 80% of market)
7. Confirms all → cards added to inventory

### Price Data

- **Primary:** TCGplayer market price (USD) from pokemontcg.io, converted to RM at daily exchange rate
- **Conversion:** Use Bank Negara Malaysia daily exchange rate (or xe.com API) for USD→MYR
- **Local pricing (future):** As transaction volume grows, aggregate anonymized sell prices from KardVault vendors to build a Malaysian street price index
- **Displayed to vendors:** Both USD market price and RM estimated price shown side by side

---

## Database Schema (Supabase PostgreSQL)

All tables use Row Level Security (RLS).

```sql
-- Vendors
CREATE TABLE vendors (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  profile_image_url TEXT,
  banner_image_url TEXT,
  bio TEXT,
  slug TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  tier_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cards (reference data — populated by cron, no user writes)
CREATE TABLE cards (
  id TEXT PRIMARY KEY, -- Pokémon TCG API card ID (e.g. sv1-25)
  name TEXT NOT NULL,
  set_id TEXT NOT NULL,
  set_name TEXT NOT NULL,
  card_number TEXT NOT NULL, -- Printed number (e.g. 025/198)
  rarity TEXT,
  image_small TEXT,
  image_large TEXT,
  supertype TEXT, -- Pokémon, Trainer, Energy
  subtypes TEXT[],
  tcgplayer_market_price DECIMAL(10,2),
  market_price_rm DECIMAL(10,2),
  price_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inventory
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  condition TEXT NOT NULL DEFAULT 'NM' CHECK (condition IN ('NM', 'LP', 'MP', 'HP', 'DMG')),
  quantity INTEGER NOT NULL DEFAULT 1,
  buy_price_rm DECIMAL(10,2),
  sell_price_rm DECIMAL(10,2) NOT NULL,
  condition_photo_url TEXT,
  listed_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vendor_id, card_id, condition)
);

-- Transactions (buy/sell log for profit tracking)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  quantity INTEGER NOT NULL DEFAULT 1,
  price_rm DECIMAL(10,2) NOT NULL,
  market_price_at_time DECIMAL(10,2),
  condition TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### RLS Policies

```sql
-- Vendors: own row full access, public can read storefront fields
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendors can read own" ON vendors FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Vendors can update own" ON vendors FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Public can read storefront" ON vendors FOR SELECT USING (true);

-- Inventory: vendor full CRUD own rows, public can read for storefront
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor manages own inventory" ON inventory FOR ALL USING (auth.uid() = vendor_id);
CREATE POLICY "Public can read inventory" ON inventory FOR SELECT USING (true);

-- Transactions: vendor-only, no public access
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor manages own transactions" ON transactions FOR ALL USING (auth.uid() = vendor_id);

-- Cards: public read-only
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read cards" ON cards FOR SELECT USING (true);
```

---

## API Routes (Next.js /api)

Most operations go through Supabase client SDK directly. Custom API routes only for server-side logic:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/recognize` | Server-side fallback OCR if client-side Tesseract fails (rarely needed) |
| `GET /api/prices/sync` | Cron job: fetches latest card data + prices from pokemontcg.io, upserts into cards table |
| `POST /api/subscription/webhook` | Payment provider webhook for Pro activation/expiry |
| `GET /api/storefront/[slug]` | SSR storefront page data for SEO + social meta tags |

---

## User Flows

### Vendor Onboarding
1. Visit kardvault.com → sign up with phone number (OTP)
2. Enter: display name, WhatsApp number, optional profile photo
3. Scan first card (immediate value demonstration)
4. Add 5+ cards → QR code storefront auto-generated
5. Print/screenshot QR code to display at booth
6. Browser prompts "Add to Home Screen" → app icon on phone

### Adding Inventory (Single Scan)
1. Tap (+) → camera opens
2. Point at card → identified in ~2 seconds
3. Confirmation: card image, name, set, card number, market price
4. Set sell price (pre-filled with market price), optionally set buy price
5. Select condition (NM default) → tap "Add to Inventory"
6. Storefront updates in real time

### Removing Inventory (Card Sold)
1. Tap (-) → camera opens
2. Scan card → app matches against inventory
3. If multiple copies, show quantity + condition options
4. Confirm/adjust actual sale price → tap "Sold"
5. Card removed, sale logged to profit dashboard, storefront updates

### Buyer Flow
1. Scan vendor's QR code at bazaar (or open shared link)
2. Mobile catalog loads instantly — no download, no signup
3. Search for specific card or browse by set/type
4. Tap card → full details, condition photo, market price (vendor's asking price NOT shown)
5. Tap WhatsApp button → "I'm interested in [card name]" (no price in message)
6. Buyer asks vendor for price in person or via WhatsApp → transaction completes offline

---

## Business Model

### Pricing Tiers

| Feature | Free | Pro — RM19/month (RM179/year) |
|---------|------|-------------------------------|
| Cards in inventory | Up to 50 | Unlimited |
| Single card scan | Yes | Yes |
| Binder page scan | No | Yes |
| QR storefront | With watermark | Clean + vendor branding |
| Market price lookup | Unlimited | Unlimited |
| Profit dashboard | No | Full analytics |
| Condition tagging | NM/LP only | Full (NM/LP/MP/HP/DMG) |
| WhatsApp integration | No | Yes |
| CSV export | No | Yes |

### Payment Integration
- Billplz or Revenue Monster for Malaysian FPX + eWallets
- Webhook at `/api/subscription/webhook` handles activation/expiry
- No sensitive financial data stored — fully delegated to payment provider

---

## Infrastructure

| Component | Service | Est. Cost |
|-----------|---------|-----------|
| Frontend + API | Vercel (Singapore) | Free → RM85/mo |
| Database + Auth + Storage | Supabase | Free → RM110/mo |
| Domain | kardvault.com | RM50/year |
| Payment processing | Billplz / Revenue Monster | 2.5–3.5% per charge |
| Monitoring | PostHog + Sentry | Free tier |
| **Total MVP** | | **~RM0–50/month** |
| **Total at 500 vendors** | | **~RM200–300/month** |

---

## Development Phases

### Phase 1: Alpha (Weeks 1–4)
- [ ] Next.js 15 project setup with PWA config (next-pwa)
- [ ] Supabase project setup (Singapore region) with schema + RLS
- [ ] Phone OTP auth flow
- [ ] Vendor profile CRUD
- [ ] Single card scan: camera → Tesseract.js OCR → Pokémon TCG API lookup
- [ ] Basic inventory CRUD (add/remove/list)
- [ ] QR code generation per vendor
- [ ] Public storefront page at `/v/[slug]` with search + filters

### Phase 2: Beta (Weeks 5–8)
- [ ] Binder page scan (9-card batch with 3×3 grid segmentation)
- [ ] Profit dashboard (revenue, margins, best sellers)
- [ ] Condition tagging with photo proof (Supabase Storage)
- [ ] WhatsApp integration (pre-filled message button)
- [ ] Market price delta indicator on inventory list
- [ ] Inventory aging indicators
- [ ] CSV/Excel import with auto-detection column mapping + fuzzy card matching

### Phase 3: Launch (Weeks 9–10)
- [ ] Pro tier subscription + payment integration (Billplz)
- [ ] Free/Pro feature gating
- [ ] Vendor branding on storefront (logo, banner, bio)
- [ ] CSV export
- [ ] PWA manifest + service worker optimization

### Phase 4: Growth (Weeks 11+)
- [ ] Cross-vendor search (buyers search all vendors)
- [ ] Event mode (see below)
- [ ] Vendor ratings and reviews
- [ ] Price alerts
- [ ] Local RM price index from transaction data

### Future Feature: Event Mode (v2)

**Concept:** Vendors tag which bazaar/event they're attending this weekend. Buyers can browse an event page showing all attending vendors and search across their combined inventory before deciding to go.

**Vendor flow:**
1. Vendor taps "I'm going to an event" → selects from a list of upcoming events or creates a new one (name, date, location)
2. Their full inventory becomes linked to that event page
3. Takes 2 seconds — no extra work beyond the initial tap

**Buyer flow:**
1. Buyer opens KardVault → sees "Upcoming events near you"
2. Taps an event (e.g. "Comic Fiesta — 12 vendors listed")
3. Searches across ALL vendors attending that event: "Who has Charizard ex?"
4. Sees "3 vendors have this card" — no prices shown, just vendor names and booth info
5. Decides to attend to check prices in person

**Key design rule:** Event search results NEVER show prices. Only show: card name, number of vendors who have it, and vendor display names. Prices are only visible on individual vendor storefronts (via QR scan at the booth). This drives foot traffic to the event — the buyer must show up to see the deal.

**Schema additions (future):**
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  date DATE NOT NULL,
  end_date DATE,
  created_by UUID REFERENCES vendors(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE event_vendors (
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  booth_info TEXT, -- optional: "Booth A12" or "Near entrance"
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, vendor_id)
);
```

**Why this matters:** Creates a reason for buyers to open the app BETWEEN bazaars, not just at them. Drives foot traffic to events (organizers will love this). The more vendors tag an event, the more useful it is for buyers, which drives more attendance, which makes vendors want to tag next time — flywheel effect.

**Not in MVP.** Build after cross-vendor search is live, since event mode depends on searching across multiple vendor inventories.

---

## Key Technical Decisions

1. **Hybrid card recognition (search-first + OCR-assist)** — autocomplete search against local DB is the primary identification method. Tesseract.js OCR runs in background to pre-fill the search when it works, but the UI never depends on OCR succeeding. This avoids the fragile OCR-only approach.

2. **Local card database (synced from pokemontcg.io)** — the entire Pokémon TCG card database (~20K cards) is synced to Supabase nightly. All card lookups during scanning are local DB queries (instant, free, unlimited). No live API calls during vendor usage.

2. **PWA over native** — single codebase for vendor app + buyer storefront. Wrap with Capacitor later if native features needed.

3. **Supabase over custom backend** — auth, DB, storage, realtime subscriptions all built-in. RLS eliminates most API middleware. Free tier covers MVP.

4. **Phone OTP auth** — Malaysian bazaar vendors are not email-oriented. Phone number is their identity (same number as WhatsApp).

5. **Unique constraint on (vendor_id, card_id, condition)** — same card at same condition groups as quantity rather than duplicate rows. Different conditions are separate rows.

6. **Storefront is SSR** — Next.js server-renders `/v/[slug]` pages for SEO and social sharing (OpenGraph meta tags with card images).

7. **Billplz over Stripe** — lower fees for Malaysian FPX bank transfers. Stripe can be added later for international.

---

## Brand & Color System

**Theme:** Obsidian & violet frost — dark-first, premium, holo-card energy.

### Color Tokens (Tailwind CSS custom config)

```
Background:
  bg-primary:     #0D0C12   (main app background)
  bg-surface:     #15141C   (cards, modals, elevated surfaces)
  bg-surface-2:   #1E1D28   (input fields, secondary surfaces)
  bg-hover:       #242330   (hover states on surfaces)

Primary (violet):
  primary-50:     #E4DFF0   (frost — light text on dark bg)
  primary-100:    #C8BFE0   (secondary text on dark bg)
  primary-200:    #A593CF   (muted accents, subtitles, prices)
  primary-400:    #7C6BB5   (primary buttons, links, active states)
  primary-600:    #5B4D8A   (borders, dividers on dark bg)
  primary-800:    #3A3160   (subtle backgrounds, pressed states)

Text:
  text-primary:   #E4DFF0   (headings, card names, prices — all key text stays light)
  text-secondary: #7A7890   (set names, timestamps, hints, labels)
  text-muted:     #5A586A   (disabled, placeholders)
  text-on-primary:#0D0C12   (text on violet buttons)

Semantic:
  success:        #5BD4A8   (profit, price UP indicator arrow/badge only)
  danger:         #D96B7A   (loss, price DOWN indicator arrow/badge only)
  warning:        #E5C05C   (alerts, aging inventory)
  info:           #6BB5D9   (neutral info, tips)

Borders:
  border-default: rgba(124,107,181,0.12)  (subtle dividers)
  border-hover:   rgba(124,107,181,0.25)  (interactive borders)
  border-focus:   #7C6BB5                  (focus rings)

Pro badge:
  badge-bg:       rgba(124,107,181,0.12)
  badge-text:     #A593CF
```

### Logo Treatment
- Logo text: "Kad" in text-primary (#E4DFF0), "Vault" in primary-400 (#7C6BB5)
- On light backgrounds (storefront, marketing): invert to dark text with violet accent
- App icon: violet vault symbol on obsidian background

### Design Principles
- Dark-first: #0D0C12 background, never pure black (#000000) — pure black feels harsh on OLED
- Surfaces use subtle elevation via slightly lighter backgrounds, not shadows
- Violet accents used sparingly — buttons, active states, badges, links
- **Prices are always white (#E4DFF0)** — the actual price number stays neutral
- **Price movement indicators use green/red** — a small arrow or badge NEXT to the price shows direction (▲ green for up, ▼ red for down), but the price itself stays white
- Card images provide the color in the UI; the chrome stays neutral
- Light mode (for buyer storefront): invert to white bg with violet accents, same token names

### Buyer Storefront Light Theme Tokens
```
  bg:       #F8F7FC   (page background)
  surface:  #FFFFFF   (cards)
  text:     #1A1825   (headings, card names)
  text2:    #6B6880   (secondary text)
  border:   rgba(124,107,181,0.12)
  input-bg: #F0EFF5
  chip-active-bg: #7C6BB5 (with white text)
  powered-by: #B0AEBE
```

---

## Screen-by-Screen UI Specification

Reference mockup: `kardvault-all-screens-v2.html`

The app has 8 key screens. All vendor-facing screens use the dark obsidian theme. The buyer storefront uses the light theme.

### Screen 1: Dashboard (vendor, dark theme)
**Nav:** Dashboard tab active in bottom nav
**Layout top-to-bottom:**
1. Header: "KardVault" logo + PRO badge (top right)
2. Stats row (3-column grid): Inventory count, Market value (RM), Cards sold this month. Each card has a small green/red arrow showing week-over-week change
3. Revenue chart card: Large RM number + "Revenue this month" subtitle. Period toggle tabs (7D / 30D / 90D). Chart type toggle (area graph / bar chart). Area chart with violet gradient fill, smooth bezier curves, glowing dot on current period
4. Profit row (2-column grid): Total profit (green) with avg margin %, Average sell price per card
5. Recent sales list: Card image thumbnail, name, set, time ago. Right side: sale price (white) + profit/loss (green/red)
6. Inventory aging bar: Horizontal stacked bar — violet (<30d), yellow (30-60d), orange (60-90d), red (90d+). Legend below with counts
7. Best performers grid (2×2): Highest margin card, Most sold card, Longest held card (warning), Biggest price rise card

### Screen 2: Inventory List (vendor, dark theme)
**Nav:** Inventory tab active
**Layout top-to-bottom:**
1. Header: "KardVault" logo + "247 cards" count
2. Summary row (3 columns): Total market value, Your total asking price, Potential profit (green)
3. Action buttons row (3 buttons, equal width):
   - **Import CSV** (highlighted with primary-800 bg + primary-600 border) — upload icon
   - **Export CSV** — download icon
   - **Filter** — funnel icon
4. Search bar: magnifying glass icon + text input with "Search cards..." placeholder
5. Filter chips: horizontal scroll row — "All" (active/filled), then set names as chips
6. Card list: Each row has card image (42×58px rounded), card name, set + number, condition tag. Right side: vendor's asking price (white), market price (muted), delta arrow (green up / red down with %)
7. Duplicate indicator: "×2" badge on card image corner when quantity > 1

### Screen 3: Single Card Scan (vendor, dark theme)
**Nav:** No bottom nav — full screen camera mode
**Layout top-to-bottom:**
1. Camera view (top 380px, dark bg): Back button (circle, top left), Mode toggle tabs "Single | Binder 3×3" (top center). Scan frame (220×310px, violet border with corner brackets). Animated scan line sweeping vertically. Hint text at bottom: "Align card within the frame"
2. Result card (below camera): Card image (70×98px) + card name (15px bold) + set info + market price (18px bold). Input row: "Your price (RM)" + "Buy price (RM)" inputs. Input row: Condition dropdown (NM/LP/MP/HP/DMG) + Quantity input. Two buttons: "Add to inventory" (primary violet) + "Remove (sold)" (outline)

### Screen 4: Binder Page Scan Results (vendor, dark theme)
**Nav:** Back button header
**Layout top-to-bottom:**
1. Header: Back arrow + "Binder scan results" + "7/9 matched" (green text, right)
2. 3×3 grid of card cells: Matched cells have green border + green checkmark badge + card image + name + market price. Unmatched cells have yellow border + "?" badge + "Tap to search" text (yellow) + "Not identified" (muted)
3. Batch pricing card: Label "Batch pricing rule" + 4 toggle buttons: "At market" (active), "90% mkt", "80% mkt", "Custom"
4. Full-width button: "Add 7 cards to inventory" (primary violet)

### Screen 5: CSV Import — Upload (vendor, dark theme)
**Nav:** Back button header
**Layout top-to-bottom:**
1. Header: Back arrow + "Import inventory"
2. Upload zone: Dashed border (border-hover color), rounded 16px. Upload icon (circle with primary-800 bg, arrow-up svg in primary-200). Title: "Upload your spreadsheet". Hint: "Supports CSV and Excel (.xlsx) files. We'll auto-detect your columns."
3. File attached state (shown after upload): Green border card with file icon, filename ("my_pokemon_cards.csv"), meta ("124 rows · 6 columns · 18 KB"), X button to remove
4. Divider text: "— or start with our template —"
5. Template download button: outline style, download icon + "Download KardVault CSV template"
6. Full-width button: "Continue to column mapping" (primary violet)

### Screen 6: CSV Import — Column Mapping (vendor, dark theme)
**Nav:** Back button header
**Layout top-to-bottom:**
1. Header: Back arrow + "Map your columns" + "4 auto-detected" (green text, right)
2. Instruction text (muted, 11px): "We detected 6 columns in your file. Confirm or adjust the mapping below."
3. Column mapping cards (one per CSV column): Each card has:
   - Left: Status icon (green checkmark = auto-detected, purple ? = needs review, grey dash = skipped)
   - Middle: Column label from CSV ("Column A: Card Name"), preview of first few values, "Auto-detected" tag if applicable
   - Arrow: "→"
   - Right: Dropdown select to assign the KardVault field (Card name, Set, Sell price, Buy price, Condition, Card #, Quantity, Skip)
4. Full-width button: "Match 124 cards against database" (primary violet)
5. Back button (outline)

### Screen 7: CSV Import — Match Preview (vendor, dark theme)
**Nav:** Back button header
**Layout top-to-bottom:**
1. Header: Back arrow + "Review matches"
2. Match summary row (3 cards): Matched count (green), Uncertain count (yellow), Not found count (red)
3. Filter chips: "All (124)" active, "Matched (108)", "Uncertain (12)", "Not found (4)"
4. Match list — three types of rows:
   - **Matched** (green checkmark icon): Card name, set + number + price, "Matched" label + "99% match" confidence
   - **Uncertain** (yellow ? icon): Shows CSV value → suggested match with "?" (e.g. "Zard ex → Charizard ex?"), "Tap to confirm or search", "68% match" confidence
   - **Not found** (red ✗ icon): CSV value, "No match in database · Tap to search manually"
5. Full-width button: "Import 108 matched cards" (primary violet)
6. Footer text (muted, centered): "12 uncertain + 4 not found will be skipped. You can add them manually later."

### Screen 8: Buyer Storefront (buyer-facing, LIGHT theme)
**Nav:** No app nav — standalone web page accessed via QR scan
**Layout top-to-bottom:**
1. Vendor header: Avatar circle (initials, violet gradient), vendor display name (16px bold), bio text (11px muted)
2. Vendor stats row: Cards count, Sets count, Rating (stars)
3. WhatsApp button: Full-width, green (#25D366) bg, WhatsApp icon + "Message on WhatsApp"
4. Search bar: light input bg (#F0EFF5), magnifying glass icon
5. Filter chips: "All" (active, violet bg white text), set name chips (outline)
6. Card list: Each card has image (50×70px), card name (13px medium), set info, condition badge (violet bg pill). Right side: "Available" label (green), "Market" label (tiny uppercase) + market price (14px bold). **No vendor asking price shown — buyer must ask in person**
7. Footer: "Powered by KardVault" watermark (free tier only)

---

## Code Conventions

- TypeScript strict mode throughout
- Tailwind CSS for all styling — no CSS modules or styled-components
- Supabase client initialized in `lib/supabase.ts` (browser) and `lib/supabase-server.ts` (server)
- All Supabase queries use typed client generated from `supabase gen types typescript`
- Environment variables in `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- File structure: `app/` (Next.js app router), `components/`, `lib/`, `hooks/`, `types/`
- Card recognition logic in `lib/recognition/` — `ocr.ts` (Tesseract wrapper), `parser.ts` (card number regex), `search.ts` (autocomplete query)
- CSV import logic in `lib/import/` — `parser.ts` (Papa Parse + SheetJS), `column-detector.ts` (auto-detection), `matcher.ts` (fuzzy card matching)
- Storefront pages: `app/v/[slug]/page.tsx` (SSR)
- Import flow pages: `app/import/page.tsx` (upload), `app/import/mapping/page.tsx` (column mapping), `app/import/preview/page.tsx` (match review)
- API routes: `app/api/*/route.ts`
