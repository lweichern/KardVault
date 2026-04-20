# Card Database & Vision AI Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pokemontcg.io sync + Tesseract.js OCR system with a GitHub-repo-based card seeder and Vision AI scanning (Gemini/GPT/Claude Haiku) with Quick Scan and Single Scan modes.

**Architecture:** Server-side API route receives base64 images, calls a Vision AI provider (selected via env var), matches results against local Supabase `cards` table using a waterfall strategy (exact number → name+set → name-only), and returns matched cards. The scan page offers two modes: Single Scan (immediate) and Quick Scan (batch rapid-fire).

**Tech Stack:** Next.js 15, Supabase (PostgreSQL + RLS), `@google/generative-ai`, `openai`, `@anthropic-ai/sdk`, Tailwind CSS

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/00007_card_database_vision_scan.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 00007_card_database_vision_scan.sql
-- Replaces old card/inventory schema with extended card_sets + cards + new inventory + scan_logs

-- ============================================
-- 1. CREATE card_sets TABLE (must exist before cards references it)
-- ============================================
CREATE TABLE IF NOT EXISTS card_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  series TEXT NOT NULL,
  printed_total INTEGER,
  total INTEGER,
  ptcgo_code TEXT,
  release_date DATE,
  image_symbol TEXT,
  image_logo TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE card_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Card sets are publicly readable" ON card_sets FOR SELECT USING (true);
CREATE INDEX idx_sets_release ON card_sets (release_date DESC);

-- ============================================
-- 2. DROP tables that depend on cards (cascade handles FK deps)
-- ============================================
DROP TABLE IF EXISTS storefront_views CASCADE;
DROP TABLE IF EXISTS storefront_searches CASCADE;
DROP TABLE IF EXISTS scan_logs CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS cards CASCADE;

-- ============================================
-- 3. RECREATE cards with extended schema
-- ============================================
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  supertype TEXT NOT NULL,
  subtypes TEXT[],
  hp TEXT,
  types TEXT[],
  evolves_from TEXT,
  evolves_to TEXT[],
  set_id TEXT NOT NULL REFERENCES card_sets(id),
  set_name TEXT NOT NULL,
  set_series TEXT NOT NULL,
  number TEXT NOT NULL,
  rarity TEXT,
  artist TEXT,
  attacks JSONB,
  weaknesses JSONB,
  resistances JSONB,
  retreat_cost TEXT[],
  converted_retreat_cost INTEGER,
  rules TEXT[],
  abilities JSONB,
  flavor_text TEXT,
  image_small TEXT,
  image_large TEXT,
  national_pokedex_numbers INTEGER[],
  legality_standard TEXT,
  legality_expanded TEXT,
  legality_unlimited TEXT,
  regulation_mark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cards are publicly readable" ON cards FOR SELECT USING (true);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_cards_name_trgm ON cards USING GIN (name gin_trgm_ops);
CREATE INDEX idx_cards_set_id ON cards (set_id);
CREATE INDEX idx_cards_rarity ON cards (rarity);
CREATE INDEX idx_cards_supertype ON cards (supertype);
CREATE INDEX idx_cards_name_set ON cards (name, set_id);
CREATE INDEX idx_cards_number ON cards (number);

-- ============================================
-- 4. SEARCH FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION search_cards(
  search_query TEXT,
  result_limit INTEGER DEFAULT 20,
  result_offset INTEGER DEFAULT 0
)
RETURNS SETOF cards
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM cards
  WHERE
    name ILIKE '%' || search_query || '%'
    OR set_name ILIKE '%' || search_query || '%'
    OR number ILIKE '%' || search_query || '%'
  ORDER BY
    CASE WHEN name ILIKE search_query THEN 0
         WHEN name ILIKE search_query || '%' THEN 1
         WHEN number = search_query THEN 2
         ELSE 3
    END,
    set_id DESC,
    name ASC
  LIMIT result_limit
  OFFSET result_offset;
$$;

-- ============================================
-- 5. NEW inventory TABLE
-- ============================================
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id),
  manual_card_name TEXT,
  manual_card_set TEXT,
  manual_card_number TEXT,
  condition TEXT NOT NULL DEFAULT 'NM' CHECK (condition IN ('NM', 'LP', 'MP', 'HP', 'DMG')),
  price_myr INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  photos TEXT[],
  is_graded BOOLEAN DEFAULT FALSE,
  grading_company TEXT,
  grade TEXT,
  subgrades JSONB,
  cert_number TEXT,
  deal_method TEXT DEFAULT 'BOTH' CHECK (deal_method IN ('COD', 'SHIPPING', 'BOTH')),
  cod_location TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'REMOVED', 'RESERVED')),
  scan_source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor manages own inventory" ON inventory FOR ALL USING (auth.uid() = vendor_id);
CREATE POLICY "Public can read active inventory" ON inventory FOR SELECT USING (status = 'ACTIVE');

CREATE INDEX idx_inventory_vendor ON inventory (vendor_id);
CREATE INDEX idx_inventory_card ON inventory (card_id);
CREATE INDEX idx_inventory_status ON inventory (status);
CREATE INDEX idx_inventory_vendor_active ON inventory (vendor_id) WHERE status = 'ACTIVE';

-- ============================================
-- 6. RECREATE transactions
-- ============================================
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id),
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  quantity INTEGER NOT NULL DEFAULT 1,
  price_rm DECIMAL(10,2) NOT NULL,
  market_price_at_time DECIMAL(10,2),
  condition TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor manages own transactions" ON transactions FOR ALL USING (auth.uid() = vendor_id);
CREATE INDEX idx_transactions_vendor_id ON transactions (vendor_id);
CREATE INDEX idx_transactions_created_at ON transactions (created_at);

-- ============================================
-- 7. RECREATE storefront analytics tables
-- ============================================
CREATE TABLE storefront_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE storefront_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can insert views" ON storefront_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendor can read own views" ON storefront_views FOR SELECT USING (auth.uid() = vendor_id);

CREATE TABLE storefront_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results_count INTEGER DEFAULT 0,
  searched_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE storefront_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can insert searches" ON storefront_searches FOR INSERT WITH CHECK (true);
CREATE POLICY "Vendor can read own searches" ON storefront_searches FOR SELECT USING (auth.uid() = vendor_id);

-- ============================================
-- 8. NEW scan_logs TABLE
-- ============================================
CREATE TABLE scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  scan_mode TEXT NOT NULL,
  vision_model TEXT NOT NULL,
  api_response JSONB,
  matched_card_id TEXT,
  vendor_corrected BOOLEAN DEFAULT FALSE,
  corrected_card_id TEXT,
  confidence TEXT,
  photo_quality_score FLOAT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendor manages own scan logs" ON scan_logs FOR ALL USING (auth.uid() = vendor_id);
CREATE INDEX idx_scan_logs_vendor ON scan_logs (vendor_id);
CREATE INDEX idx_scan_logs_created ON scan_logs (created_at);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/00007_card_database_vision_scan.sql
git commit -m "feat: add migration for extended card schema, vision scan, and scan_logs"
```

---

## Task 2: Delete Old Files & Update Dependencies

**Files:**
- Delete: `src/lib/sync/sync-cards.ts`, `src/lib/sync/pokemontcg.ts`, `src/lib/recognition/ocr.ts`, `src/lib/recognition/parser.ts`, `scripts/sync-cards.ts`
- Modify: `package.json`

- [ ] **Step 1: Delete old sync and recognition files**

```bash
rm -rf src/lib/sync/
rm -rf src/lib/recognition/
rm scripts/sync-cards.ts
```

- [ ] **Step 2: Remove tesseract.js and add AI SDKs**

```bash
npm uninstall tesseract.js
npm install @google/generative-ai openai @anthropic-ai/sdk
```

- [ ] **Step 3: Update package.json scripts**

Replace the `sync:cards` and `sync:cards:incremental` scripts with new seed scripts:

```json
{
  "scripts": {
    "seed:cards": "tsx scripts/seed-cards.ts",
    "seed:cards:set": "tsx scripts/seed-cards.ts --set"
  }
}
```

Remove these lines from the `scripts` object:
```
"sync:cards": "tsx scripts/sync-cards.ts",
"sync:cards:incremental": "tsx scripts/sync-cards.ts --since 7",
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old sync/recognition, add AI SDKs, update scripts"
```

---

## Task 3: Update TypeScript Database Types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Rewrite database.ts with new schema types**

Replace the entire file with types matching the new migration:

```typescript
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      vendors: {
        Row: {
          id: string;
          display_name: string;
          whatsapp_number: string;
          profile_image_url: string | null;
          banner_image_url: string | null;
          bio: string | null;
          slug: string;
          tier: "free" | "pro";
          tier_expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          whatsapp_number: string;
          profile_image_url?: string | null;
          banner_image_url?: string | null;
          bio?: string | null;
          slug: string;
          tier?: "free" | "pro";
          tier_expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          whatsapp_number?: string;
          profile_image_url?: string | null;
          banner_image_url?: string | null;
          bio?: string | null;
          slug?: string;
          tier?: "free" | "pro";
          tier_expires_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      card_sets: {
        Row: {
          id: string;
          name: string;
          series: string;
          printed_total: number | null;
          total: number | null;
          ptcgo_code: string | null;
          release_date: string | null;
          image_symbol: string | null;
          image_logo: string | null;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          series: string;
          printed_total?: number | null;
          total?: number | null;
          ptcgo_code?: string | null;
          release_date?: string | null;
          image_symbol?: string | null;
          image_logo?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          series?: string;
          printed_total?: number | null;
          total?: number | null;
          ptcgo_code?: string | null;
          release_date?: string | null;
          image_symbol?: string | null;
          image_logo?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      cards: {
        Row: {
          id: string;
          name: string;
          supertype: string;
          subtypes: string[] | null;
          hp: string | null;
          types: string[] | null;
          evolves_from: string | null;
          evolves_to: string[] | null;
          set_id: string;
          set_name: string;
          set_series: string;
          number: string;
          rarity: string | null;
          artist: string | null;
          attacks: Json | null;
          weaknesses: Json | null;
          resistances: Json | null;
          retreat_cost: string[] | null;
          converted_retreat_cost: number | null;
          rules: string[] | null;
          abilities: Json | null;
          flavor_text: string | null;
          image_small: string | null;
          image_large: string | null;
          national_pokedex_numbers: number[] | null;
          legality_standard: string | null;
          legality_expanded: string | null;
          legality_unlimited: string | null;
          regulation_mark: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          supertype: string;
          subtypes?: string[] | null;
          hp?: string | null;
          types?: string[] | null;
          evolves_from?: string | null;
          evolves_to?: string[] | null;
          set_id: string;
          set_name: string;
          set_series: string;
          number: string;
          rarity?: string | null;
          artist?: string | null;
          attacks?: Json | null;
          weaknesses?: Json | null;
          resistances?: Json | null;
          retreat_cost?: string[] | null;
          converted_retreat_cost?: number | null;
          rules?: string[] | null;
          abilities?: Json | null;
          flavor_text?: string | null;
          image_small?: string | null;
          image_large?: string | null;
          national_pokedex_numbers?: number[] | null;
          legality_standard?: string | null;
          legality_expanded?: string | null;
          legality_unlimited?: string | null;
          regulation_mark?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          supertype?: string;
          subtypes?: string[] | null;
          hp?: string | null;
          types?: string[] | null;
          evolves_from?: string | null;
          evolves_to?: string[] | null;
          set_id?: string;
          set_name?: string;
          set_series?: string;
          number?: string;
          rarity?: string | null;
          artist?: string | null;
          attacks?: Json | null;
          weaknesses?: Json | null;
          resistances?: Json | null;
          retreat_cost?: string[] | null;
          converted_retreat_cost?: number | null;
          rules?: string[] | null;
          abilities?: Json | null;
          flavor_text?: string | null;
          image_small?: string | null;
          image_large?: string | null;
          national_pokedex_numbers?: number[] | null;
          legality_standard?: string | null;
          legality_expanded?: string | null;
          legality_unlimited?: string | null;
          regulation_mark?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cards_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "card_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory: {
        Row: {
          id: string;
          vendor_id: string;
          card_id: string | null;
          manual_card_name: string | null;
          manual_card_set: string | null;
          manual_card_number: string | null;
          condition: "NM" | "LP" | "MP" | "HP" | "DMG";
          price_myr: number | null;
          quantity: number;
          photos: string[] | null;
          is_graded: boolean;
          grading_company: string | null;
          grade: string | null;
          subgrades: Json | null;
          cert_number: string | null;
          deal_method: "COD" | "SHIPPING" | "BOTH";
          cod_location: string | null;
          status: "ACTIVE" | "SOLD" | "REMOVED" | "RESERVED";
          scan_source: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          card_id?: string | null;
          manual_card_name?: string | null;
          manual_card_set?: string | null;
          manual_card_number?: string | null;
          condition?: "NM" | "LP" | "MP" | "HP" | "DMG";
          price_myr?: number | null;
          quantity?: number;
          photos?: string[] | null;
          is_graded?: boolean;
          grading_company?: string | null;
          grade?: string | null;
          subgrades?: Json | null;
          cert_number?: string | null;
          deal_method?: "COD" | "SHIPPING" | "BOTH";
          cod_location?: string | null;
          status?: "ACTIVE" | "SOLD" | "REMOVED" | "RESERVED";
          scan_source?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          card_id?: string | null;
          manual_card_name?: string | null;
          manual_card_set?: string | null;
          manual_card_number?: string | null;
          condition?: "NM" | "LP" | "MP" | "HP" | "DMG";
          price_myr?: number | null;
          quantity?: number;
          photos?: string[] | null;
          is_graded?: boolean;
          grading_company?: string | null;
          grade?: string | null;
          subgrades?: Json | null;
          cert_number?: string | null;
          deal_method?: "COD" | "SHIPPING" | "BOTH";
          cod_location?: string | null;
          status?: "ACTIVE" | "SOLD" | "REMOVED" | "RESERVED";
          scan_source?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      transactions: {
        Row: {
          id: string;
          vendor_id: string;
          card_id: string | null;
          type: "buy" | "sell";
          quantity: number;
          price_rm: number;
          market_price_at_time: number | null;
          condition: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          card_id?: string | null;
          type: "buy" | "sell";
          quantity?: number;
          price_rm: number;
          market_price_at_time?: number | null;
          condition: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          card_id?: string | null;
          type?: "buy" | "sell";
          quantity?: number;
          price_rm?: number;
          market_price_at_time?: number | null;
          condition?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transactions_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      scan_logs: {
        Row: {
          id: string;
          vendor_id: string;
          scan_mode: string;
          vision_model: string;
          api_response: Json | null;
          matched_card_id: string | null;
          vendor_corrected: boolean;
          corrected_card_id: string | null;
          confidence: string | null;
          photo_quality_score: number | null;
          latency_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          scan_mode: string;
          vision_model: string;
          api_response?: Json | null;
          matched_card_id?: string | null;
          vendor_corrected?: boolean;
          corrected_card_id?: string | null;
          confidence?: string | null;
          photo_quality_score?: number | null;
          latency_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          scan_mode?: string;
          vision_model?: string;
          api_response?: Json | null;
          matched_card_id?: string | null;
          vendor_corrected?: boolean;
          corrected_card_id?: string | null;
          confidence?: string | null;
          photo_quality_score?: number | null;
          latency_ms?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scan_logs_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          id: string;
          name: string;
          city: string;
          venue: string | null;
          date: string;
          end_date: string | null;
          source: "official" | "community";
          created_by: string | null;
          flagged_count: number;
          deleted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          city: string;
          venue?: string | null;
          date: string;
          end_date?: string | null;
          source?: "official" | "community";
          created_by?: string | null;
          flagged_count?: number;
          deleted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          city?: string;
          venue?: string | null;
          date?: string;
          end_date?: string | null;
          source?: "official" | "community";
          created_by?: string | null;
          flagged_count?: number;
          deleted_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      event_vendors: {
        Row: {
          event_id: string;
          vendor_id: string;
          booth_info: string | null;
          joined_at: string;
        };
        Insert: {
          event_id: string;
          vendor_id: string;
          booth_info?: string | null;
          joined_at?: string;
        };
        Update: {
          event_id?: string;
          vendor_id?: string;
          booth_info?: string | null;
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_vendors_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_vendors_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      event_flags: {
        Row: {
          id: string;
          event_id: string;
          flagged_by: string;
          reason: string | null;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          flagged_by: string;
          reason?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          flagged_by?: string;
          reason?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_flags_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_flags_flagged_by_fkey";
            columns: ["flagged_by"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
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
    };
    Views: {
      public_vendors: {
        Row: {
          id: string;
          display_name: string;
          slug: string;
          profile_image_url: string | null;
          banner_image_url: string | null;
          bio: string | null;
        };
      };
    };
    Functions: {
      search_cards: {
        Args: {
          search_query: string;
          result_limit?: number;
          result_offset?: number;
        };
        Returns: Database["public"]["Tables"]["cards"]["Row"][];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
```

- [ ] **Step 2: Verify the build compiles (expect errors in other files — that's OK for now)**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Type errors in hooks/components referencing old schema fields — these are fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: update database types for new card/inventory/scan_logs schema"
```

---

## Task 4: Seed Script — Types & GitHub Source

**Files:**
- Create: `src/lib/seed/types.ts`
- Create: `src/lib/seed/github-source.ts`

- [ ] **Step 1: Create seed types matching the GitHub repo JSON structure**

Create `src/lib/seed/types.ts`:

```typescript
export interface RawSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  ptcgoCode?: string;
  releaseDate: string;
  images: {
    symbol: string;
    logo: string;
  };
}

export interface RawCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  evolvesTo?: string[];
  set: {
    id: string;
    name: string;
    series: string;
  };
  number: string;
  rarity?: string;
  artist?: string;
  attacks?: {
    name: string;
    cost: string[];
    convertedEnergyCost: number;
    damage: string;
    text: string;
  }[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  retreatCost?: string[];
  convertedRetreatCost?: number;
  rules?: string[];
  abilities?: { name: string; text: string; type: string }[];
  flavorText?: string;
  images: {
    small: string;
    large: string;
  };
  nationalPokedexNumbers?: number[];
  legalities?: {
    standard?: string;
    expanded?: string;
    unlimited?: string;
  };
  regulationMark?: string;
}
```

- [ ] **Step 2: Create GitHub data source**

Create `src/lib/seed/github-source.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import type { RawSet, RawCard } from "./types";

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";

export interface SourceOptions {
  localPath?: string;
  onProgress?: (msg: string) => void;
}

export async function fetchSets(options: SourceOptions = {}): Promise<RawSet[]> {
  const log = options.onProgress ?? (() => {});

  if (options.localPath) {
    const filePath = path.join(options.localPath, "sets", "en.json");
    log(`Reading sets from local: ${filePath}`);
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  }

  const url = `${GITHUB_RAW_BASE}/sets/en.json`;
  log(`Fetching sets from GitHub...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch sets: ${res.status}`);
  return res.json();
}

export async function fetchCardsForSet(
  setId: string,
  options: SourceOptions = {}
): Promise<RawCard[]> {
  if (options.localPath) {
    const filePath = path.join(options.localPath, "cards", "en", `${setId}.json`);
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  }

  const url = `${GITHUB_RAW_BASE}/cards/en/${setId}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Failed to fetch cards for set ${setId}: ${res.status}`);
  }
  return res.json();
}

export async function fetchAllCards(
  sets: RawSet[],
  options: SourceOptions & { concurrency?: number } = {}
): Promise<RawCard[]> {
  const log = options.onProgress ?? (() => {});
  const concurrency = options.concurrency ?? 10;
  const allCards: RawCard[] = [];
  
  for (let i = 0; i < sets.length; i += concurrency) {
    const batch = sets.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((s) => fetchCardsForSet(s.id, options))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allCards.push(...result.value);
      }
    }

    log(`Fetched ${Math.min(i + concurrency, sets.length)}/${sets.length} sets (${allCards.length} cards)`);
  }

  return allCards;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/seed/
git commit -m "feat: add seed types and GitHub data source"
```

---

## Task 5: Seed Script — Main Logic & CLI

**Files:**
- Create: `src/lib/seed/seed-cards.ts`
- Create: `scripts/seed-cards.ts`

- [ ] **Step 1: Create the seed engine**

Create `src/lib/seed/seed-cards.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";
import { fetchSets, fetchAllCards, fetchCardsForSet, type SourceOptions } from "./github-source";
import type { RawSet, RawCard } from "./types";

const UPSERT_BATCH_SIZE = 500;

export interface SeedOptions extends SourceOptions {
  setId?: string;
  setsOnly?: boolean;
}

export interface SeedResult {
  setsUpserted: number;
  cardsUpserted: number;
  durationMs: number;
  errors: string[];
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

function toSetRow(set: RawSet) {
  return {
    id: set.id,
    name: set.name,
    series: set.series,
    printed_total: set.printedTotal,
    total: set.total,
    ptcgo_code: set.ptcgoCode ?? null,
    release_date: set.releaseDate || null,
    image_symbol: set.images.symbol,
    image_logo: set.images.logo,
    updated_at: new Date().toISOString(),
  };
}

function toCardRow(card: RawCard) {
  return {
    id: card.id,
    name: card.name,
    supertype: card.supertype,
    subtypes: card.subtypes ?? null,
    hp: card.hp ?? null,
    types: card.types ?? null,
    evolves_from: card.evolvesFrom ?? null,
    evolves_to: card.evolvesTo ?? null,
    set_id: card.set.id,
    set_name: card.set.name,
    set_series: card.set.series,
    number: card.number,
    rarity: card.rarity ?? null,
    artist: card.artist ?? null,
    attacks: card.attacks ?? null,
    weaknesses: card.weaknesses ?? null,
    resistances: card.resistances ?? null,
    retreat_cost: card.retreatCost ?? null,
    converted_retreat_cost: card.convertedRetreatCost ?? null,
    rules: card.rules ?? null,
    abilities: card.abilities ?? null,
    flavor_text: card.flavorText ?? null,
    image_small: card.images.small,
    image_large: card.images.large,
    national_pokedex_numbers: card.nationalPokedexNumbers ?? null,
    legality_standard: card.legalities?.standard ?? null,
    legality_expanded: card.legalities?.expanded ?? null,
    legality_unlimited: card.legalities?.unlimited ?? null,
    regulation_mark: card.regulationMark ?? null,
    updated_at: new Date().toISOString(),
  };
}

export async function seedCards(options: SeedOptions = {}): Promise<SeedResult> {
  const start = Date.now();
  const errors: string[] = [];
  const log = options.onProgress ?? (() => {});
  const supabase = createAdminClient();

  // 1. Fetch and upsert sets
  log("Fetching sets...");
  const sets = await fetchSets(options);
  log(`Found ${sets.length} sets`);

  const setRows = sets.map(toSetRow);
  for (let i = 0; i < setRows.length; i += UPSERT_BATCH_SIZE) {
    const batch = setRows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from("card_sets").upsert(batch, { onConflict: "id" });
    if (error) errors.push(`Sets batch error: ${error.message}`);
  }
  log(`Upserted ${setRows.length} sets`);

  if (options.setsOnly) {
    return { setsUpserted: setRows.length, cardsUpserted: 0, durationMs: Date.now() - start, errors };
  }

  // 2. Fetch and upsert cards
  let cards: RawCard[];
  if (options.setId) {
    log(`Fetching cards for set: ${options.setId}`);
    cards = await fetchCardsForSet(options.setId, options);
  } else {
    cards = await fetchAllCards(sets, options);
  }
  log(`Fetched ${cards.length} cards total. Upserting...`);

  let cardsUpserted = 0;
  for (let i = 0; i < cards.length; i += UPSERT_BATCH_SIZE) {
    const batch = cards.slice(i, i + UPSERT_BATCH_SIZE);
    const rows = batch.map(toCardRow);
    const { error } = await supabase.from("cards").upsert(rows, { onConflict: "id" });
    if (error) {
      errors.push(`Cards batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}: ${error.message}`);
    } else {
      cardsUpserted += batch.length;
    }
    log(`Upserted ${cardsUpserted}/${cards.length} cards`);
  }

  return {
    setsUpserted: setRows.length,
    cardsUpserted,
    durationMs: Date.now() - start,
    errors,
  };
}
```

- [ ] **Step 2: Create the CLI script**

Create `scripts/seed-cards.ts`:

```typescript
#!/usr/bin/env tsx
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { seedCards } from "../src/lib/seed/seed-cards";

async function main() {
  const args = process.argv.slice(2);

  let setId: string | undefined;
  let localPath: string | undefined;
  let setsOnly = false;

  const setIndex = args.indexOf("--set");
  if (setIndex !== -1 && args[setIndex + 1]) {
    setId = args[setIndex + 1];
  }

  const localIndex = args.indexOf("--local");
  if (localIndex !== -1 && args[localIndex + 1]) {
    localPath = args[localIndex + 1];
  }

  if (args.includes("--sets-only")) {
    setsOnly = true;
  }

  console.log("═══════════════════════════════════════");
  console.log("  KardVault Card Seed");
  console.log("═══════════════════════════════════════");
  console.log(`Source:   ${localPath ? `local (${localPath})` : "GitHub"}`);
  console.log(`Mode:     ${setsOnly ? "sets only" : setId ? `single set (${setId})` : "full"}`);
  console.log("───────────────────────────────────────");

  try {
    const result = await seedCards({
      setId,
      localPath,
      setsOnly,
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    console.log("───────────────────────────────────────");
    console.log(`  Sets:      ${result.setsUpserted}`);
    console.log(`  Cards:     ${result.cardsUpserted}`);
    console.log(`  Duration:  ${(result.durationMs / 1000).toFixed(1)}s`);
    if (result.errors.length > 0) {
      console.log(`  Errors:    ${result.errors.length}`);
      result.errors.forEach((e) => console.log(`    - ${e}`));
    }
    console.log("═══════════════════════════════════════");
    process.exit(result.errors.length > 0 ? 1 : 0);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/seed/seed-cards.ts scripts/seed-cards.ts
git commit -m "feat: add card seed script (GitHub repo source)"
```

---

## Task 6: Vision AI — Types & Prompts

**Files:**
- Create: `src/lib/vision/types.ts`
- Create: `src/lib/vision/prompts.ts`

- [ ] **Step 1: Create shared vision types**

Create `src/lib/vision/types.ts`:

```typescript
import type { Database } from "@/types/database";

export type Card = Database["public"]["Tables"]["cards"]["Row"];

export interface ScanResult {
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  hp: string | null;
  rarity: string | null;
  card_type: string | null;
  subtypes: string[] | null;
  regulation_mark: string | null;
  confidence: "high" | "medium" | "low";
  is_graded: boolean;
  grading_company: string | null;
  grade: string | null;
  subgrades: Record<string, string> | null;
  cert_number: string | null;
}

export interface MatchResult {
  match: Card | null;
  candidates?: Card[];
  confidence: "exact" | "high" | "medium" | "low" | "none";
}

export interface IdentifyResult {
  scan: ScanResult;
  match: MatchResult;
  latency_ms: number;
}

export interface QualityResult {
  ok: boolean;
  reason?: string;
}

export interface VisionProvider {
  name: string;
  identify(imageBase64: string): Promise<ScanResult>;
}
```

- [ ] **Step 2: Create prompt templates**

Create `src/lib/vision/prompts.ts`:

```typescript
export const SINGLE_CARD_PROMPT = `You are a Pokémon TCG card identification system. Analyze this card image and return ONLY a JSON object with these fields:

{
  "card_name": "exact card name as printed",
  "set_name": "expansion set name",
  "card_number": "card number as printed (e.g., '125/197' or 'GG56/GG70')",
  "hp": "HP value if visible",
  "rarity": "rarity if identifiable",
  "card_type": "Pokémon, Trainer, or Energy",
  "subtypes": ["ex", "VSTAR", "Supporter", etc.],
  "regulation_mark": "letter if visible (e.g., 'F', 'G', 'H')",
  "confidence": "high, medium, or low",
  "is_graded": false,
  "grading_company": null,
  "grade": null,
  "subgrades": null,
  "cert_number": null
}

If the card is in a grading slab (PSA, BGS, CGC, SGC, TAG, or ACE), set is_graded to true and fill in grading_company, grade, subgrades (if visible: {"centering":"9.5","corners":"10","edges":"9.5","surface":"10"}), and cert_number.

If you cannot identify a field, set it to null. Return ONLY the JSON, no other text.`;
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/vision/types.ts src/lib/vision/prompts.ts
git commit -m "feat: add vision AI types and prompt templates"
```

---

## Task 7: Vision AI — Provider Implementations

**Files:**
- Create: `src/lib/vision/gemini.ts`
- Create: `src/lib/vision/openai.ts`
- Create: `src/lib/vision/anthropic.ts`
- Create: `src/lib/vision/provider.ts`

- [ ] **Step 1: Create Gemini provider**

Create `src/lib/vision/gemini.ts`:

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { VisionProvider, ScanResult } from "./types";
import { SINGLE_CARD_PROMPT } from "./prompts";

export class GeminiProvider implements VisionProvider {
  name = "gemini-2.5-flash";
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async identify(imageBase64: string): Promise<ScanResult> {
    const model = this.client.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });

    const result = await model.generateContent([
      { text: SINGLE_CARD_PROMPT },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64,
        },
      },
    ]);

    const text = result.response.text();
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as ScanResult;
  }
}
```

- [ ] **Step 2: Create OpenAI provider**

Create `src/lib/vision/openai.ts`:

```typescript
import OpenAI from "openai";
import type { VisionProvider, ScanResult } from "./types";
import { SINGLE_CARD_PROMPT } from "./prompts";

export class OpenAIProvider implements VisionProvider {
  name = "gpt-4o-mini";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async identify(imageBase64: string): Promise<ScanResult> {
    const response = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: SINGLE_CARD_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    const text = response.choices[0]?.message?.content ?? "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as ScanResult;
  }
}
```

- [ ] **Step 3: Create Anthropic provider**

Create `src/lib/vision/anthropic.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { VisionProvider, ScanResult } from "./types";
import { SINGLE_CARD_PROMPT } from "./prompts";

export class AnthropicProvider implements VisionProvider {
  name = "claude-haiku-4.5";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async identify(imageBase64: string): Promise<ScanResult> {
    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageBase64,
              },
            },
            { type: "text", text: SINGLE_CARD_PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text : "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as ScanResult;
  }
}
```

- [ ] **Step 4: Create provider factory**

Create `src/lib/vision/provider.ts`:

```typescript
import type { VisionProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";

export type ProviderName = "gemini" | "openai" | "anthropic";

export function getVisionProvider(): VisionProvider {
  const providerName = (process.env.VISION_PROVIDER ?? "gemini") as ProviderName;

  switch (providerName) {
    case "gemini": {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY is not set");
      return new GeminiProvider(key);
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set");
      return new OpenAIProvider(key);
    }
    case "anthropic": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
      return new AnthropicProvider(key);
    }
    default:
      throw new Error(`Unknown vision provider: ${providerName}`);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/vision/gemini.ts src/lib/vision/openai.ts src/lib/vision/anthropic.ts src/lib/vision/provider.ts
git commit -m "feat: add vision AI providers (Gemini, OpenAI, Anthropic) with factory"
```

---

## Task 8: Vision AI — Quality Checks & Card Matching

**Files:**
- Create: `src/lib/vision/quality.ts`
- Create: `src/lib/vision/match.ts`

- [ ] **Step 1: Create client-side quality checks**

Create `src/lib/vision/quality.ts`:

```typescript
import type { QualityResult } from "./types";

export function checkPhotoQuality(imageData: ImageData): QualityResult {
  const { data, width, height } = imageData;

  // 1. Minimum resolution
  if (width < 480 || height < 480) {
    return { ok: false, reason: "Image too small. Move closer." };
  }

  // 2. Brightness check
  let totalBrightness = 0;
  const pixelCount = width * height;
  for (let i = 0; i < data.length; i += 4) {
    totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  const avgBrightness = totalBrightness / pixelCount;

  if (avgBrightness < 40) {
    return { ok: false, reason: "Too dark. Add more light." };
  }
  if (avgBrightness > 240) {
    return { ok: false, reason: "Too bright. Reduce glare." };
  }

  // 3. Blur detection (Laplacian variance approximation)
  // Sample a grid of pixels and compute local contrast
  let varianceSum = 0;
  let sampleCount = 0;
  const step = 4;

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const idx = (y * width + x) * 4;
      const center = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;

      const upIdx = ((y - step) * width + x) * 4;
      const downIdx = ((y + step) * width + x) * 4;
      const leftIdx = (y * width + (x - step)) * 4;
      const rightIdx = (y * width + (x + step)) * 4;

      const up = (data[upIdx] + data[upIdx + 1] + data[upIdx + 2]) / 3;
      const down = (data[downIdx] + data[downIdx + 1] + data[downIdx + 2]) / 3;
      const left = (data[leftIdx] + data[leftIdx + 1] + data[leftIdx + 2]) / 3;
      const right = (data[rightIdx] + data[rightIdx + 1] + data[rightIdx + 2]) / 3;

      const laplacian = Math.abs(up + down + left + right - 4 * center);
      varianceSum += laplacian * laplacian;
      sampleCount++;
    }
  }

  const blurScore = sampleCount > 0 ? Math.sqrt(varianceSum / sampleCount) : 0;
  if (blurScore < 50) {
    return { ok: false, reason: "Image is blurry. Hold steady." };
  }

  return { ok: true };
}
```

- [ ] **Step 2: Create card matching logic**

Create `src/lib/vision/match.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";
import type { ScanResult, MatchResult, Card } from "./types";

function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

export async function matchCard(scanResult: ScanResult): Promise<MatchResult> {
  const supabase = createServerClient();

  // Priority 1: Exact card number match
  if (scanResult.card_number) {
    const { data } = await supabase
      .from("cards")
      .select("*")
      .ilike("number", scanResult.card_number)
      .limit(5);

    if (data && data.length === 1) {
      return { match: data[0] as Card, confidence: "exact" };
    }

    // If card number + set name narrows it to 1
    if (data && data.length > 1 && scanResult.set_name) {
      const filtered = data.filter((c) =>
        c.set_name.toLowerCase().includes(scanResult.set_name!.toLowerCase())
      );
      if (filtered.length === 1) {
        return { match: filtered[0] as Card, confidence: "exact" };
      }
    }
  }

  // Priority 2: Name + set fuzzy match
  if (scanResult.card_name && scanResult.set_name) {
    const { data } = await supabase
      .from("cards")
      .select("*")
      .ilike("name", `%${scanResult.card_name}%`)
      .ilike("set_name", `%${scanResult.set_name}%`)
      .limit(10);

    if (data && data.length === 1) {
      return { match: data[0] as Card, confidence: "high" };
    }
    if (data && data.length > 1) {
      return { match: data[0] as Card, candidates: data as Card[], confidence: "medium" };
    }
  }

  // Priority 3: Name only
  if (scanResult.card_name) {
    const { data } = await supabase
      .from("cards")
      .select("*")
      .ilike("name", `%${scanResult.card_name}%`)
      .order("set_id", { ascending: false })
      .limit(10);

    if (data && data.length > 0) {
      return { match: data[0] as Card, candidates: data as Card[], confidence: "low" };
    }
  }

  // Priority 4: No match
  return { match: null, confidence: "none" };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/vision/quality.ts src/lib/vision/match.ts
git commit -m "feat: add photo quality checks and card matching logic"
```

---

## Task 9: API Route — POST /api/scan/identify

**Files:**
- Create: `src/app/api/scan/identify/route.ts`

- [ ] **Step 1: Create the scan identify API route**

Create `src/app/api/scan/identify/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getVisionProvider } from "@/lib/vision/provider";
import { matchCard } from "@/lib/vision/match";
import type { IdentifyResult, ScanResult } from "@/lib/vision/types";

const MAX_IMAGES = 10;

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse request
  const body = await request.json();
  const { images, mode } = body as { images: string[]; mode: string };

  if (!images || !Array.isArray(images) || images.length === 0) {
    return NextResponse.json({ error: "No images provided" }, { status: 400 });
  }
  if (images.length > MAX_IMAGES) {
    return NextResponse.json({ error: `Max ${MAX_IMAGES} images per request` }, { status: 400 });
  }

  // 3. Get vision provider
  const provider = getVisionProvider();

  // 4. Process all images concurrently
  const results: IdentifyResult[] = [];
  const settled = await Promise.allSettled(
    images.map(async (imageBase64): Promise<IdentifyResult> => {
      const start = Date.now();
      let scan: ScanResult;

      try {
        scan = await provider.identify(imageBase64);
      } catch {
        scan = {
          card_name: null,
          set_name: null,
          card_number: null,
          hp: null,
          rarity: null,
          card_type: null,
          subtypes: null,
          regulation_mark: null,
          confidence: "low",
          is_graded: false,
          grading_company: null,
          grade: null,
          subgrades: null,
          cert_number: null,
        };
      }

      const match = await matchCard(scan);
      const latency_ms = Date.now() - start;
      return { scan, match, latency_ms };
    })
  );

  for (const result of settled) {
    if (result.status === "fulfilled") {
      results.push(result.value);
    } else {
      results.push({
        scan: {
          card_name: null, set_name: null, card_number: null, hp: null,
          rarity: null, card_type: null, subtypes: null, regulation_mark: null,
          confidence: "low", is_graded: false, grading_company: null,
          grade: null, subgrades: null, cert_number: null,
        },
        match: { match: null, confidence: "none" },
        latency_ms: 0,
      });
    }
  }

  // 5. Log scans (fire-and-forget using service role)
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const logs = results.map((r) => ({
    vendor_id: user.id,
    scan_mode: mode || "single_scan",
    vision_model: provider.name,
    api_response: r.scan as unknown as Record<string, unknown>,
    matched_card_id: r.match.match?.id ?? null,
    confidence: r.match.confidence,
    latency_ms: r.latency_ms,
  }));

  adminClient.from("scan_logs").insert(logs).then(() => {});

  return NextResponse.json({ results });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/scan/identify/route.ts
git commit -m "feat: add POST /api/scan/identify route with vision AI"
```

---

## Task 10: Update Hooks — use-inventory

**Files:**
- Modify: `src/hooks/use-inventory.ts`

- [ ] **Step 1: Rewrite use-inventory for new schema**

The new inventory schema uses `price_myr` (integer, in sen, nullable) instead of `sell_price_rm` (decimal, required). Also adds `status` field and removes the join on `market_price_rm` from cards.

Replace `src/hooks/use-inventory.ts` entirely:

```typescript
"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];
type InventoryRow = Database["public"]["Tables"]["inventory"]["Row"];
type Condition = InventoryRow["condition"];

export interface InventoryItem extends InventoryRow {
  card: Card | null;
}

export function useInventory(vendorId: string | undefined) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchInventory = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("inventory")
      .select("*, card:cards(*)")
      .eq("vendor_id", vendorId)
      .eq("status", "ACTIVE")
      .order("updated_at", { ascending: false });

    if (!error && data) {
      const mapped: InventoryItem[] = data.map((row) => {
        const { card, ...rest } = row as Record<string, unknown>;
        return {
          ...(rest as InventoryRow),
          card: (card as Card) ?? null,
        };
      });
      setItems(mapped);
    }
    setLoading(false);
  }, [vendorId, supabase]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  async function addToInventory(params: {
    cardId?: string;
    manualCardName?: string;
    manualCardSet?: string;
    manualCardNumber?: string;
    priceMyr?: number;
    condition: Condition;
    quantity: number;
    gradingCompany?: string;
    grade?: string;
    subgrades?: Record<string, string>;
    certNumber?: string;
    scanSource?: string;
  }) {
    if (!vendorId) throw new Error("Not authenticated");

    const { error } = await supabase.from("inventory").insert({
      vendor_id: vendorId,
      card_id: params.cardId ?? null,
      manual_card_name: params.manualCardName ?? null,
      manual_card_set: params.manualCardSet ?? null,
      manual_card_number: params.manualCardNumber ?? null,
      price_myr: params.priceMyr ?? null,
      condition: params.condition,
      quantity: params.quantity,
      is_graded: !!(params.gradingCompany && params.grade),
      grading_company: params.gradingCompany ?? null,
      grade: params.grade ?? null,
      subgrades: params.subgrades ?? null,
      cert_number: params.certNumber ?? null,
      scan_source: params.scanSource ?? null,
    });

    if (error) throw error;
    await fetchInventory();
  }

  async function addBulkToInventory(
    cards: {
      cardId: string;
      condition?: Condition;
      scanSource?: string;
    }[]
  ) {
    if (!vendorId) throw new Error("Not authenticated");

    const rows = cards.map((c) => ({
      vendor_id: vendorId,
      card_id: c.cardId,
      condition: c.condition ?? "NM",
      quantity: 1,
      scan_source: c.scanSource ?? null,
    }));

    const { error } = await supabase.from("inventory").insert(rows);
    if (error) throw error;
    await fetchInventory();
  }

  async function sellFromInventory(params: {
    inventoryId: string;
    cardId: string | null;
    salePriceMyr: number;
    condition: string;
    quantity: number;
  }) {
    if (!vendorId) throw new Error("Not authenticated");

    const item = items.find((i) => i.id === params.inventoryId);
    if (!item) throw new Error("Item not found");

    if (item.quantity <= params.quantity) {
      await supabase
        .from("inventory")
        .update({ status: "SOLD", updated_at: new Date().toISOString() })
        .eq("id", params.inventoryId);
    } else {
      await supabase
        .from("inventory")
        .update({
          quantity: item.quantity - params.quantity,
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.inventoryId);
    }

    if (params.cardId) {
      await supabase.from("transactions").insert({
        vendor_id: vendorId,
        card_id: params.cardId,
        type: "sell",
        quantity: params.quantity,
        price_rm: params.salePriceMyr / 100,
        condition: params.condition,
      });
    }

    await fetchInventory();
  }

  const totalCards = items.reduce((sum, i) => sum + i.quantity, 0);

  return {
    items,
    loading,
    addToInventory,
    addBulkToInventory,
    sellFromInventory,
    refresh: fetchInventory,
    totalCards,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-inventory.ts
git commit -m "feat: rewrite use-inventory hook for new schema (price in sen, status, bulk add)"
```

---

## Task 11: Update Hooks — use-card-search

**Files:**
- Modify: `src/hooks/use-card-search.ts`

- [ ] **Step 1: Update to use search_cards RPC function**

Replace `src/hooks/use-card-search.ts`:

```typescript
"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];

export function useCardSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const supabase = createClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const search = useCallback(
    (q: string) => {
      setQuery(q);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (q.trim().length < 2) {
        setResults([]);
        setSearching(false);
        return;
      }

      setSearching(true);

      debounceRef.current = setTimeout(async () => {
        const { data, error } = await supabase.rpc("search_cards", {
          search_query: q.trim(),
          result_limit: 20,
          result_offset: 0,
        });

        if (!error && data) {
          setResults(data as Card[]);
        }
        setSearching(false);
      }, 250);
    },
    [supabase]
  );

  function clear() {
    setQuery("");
    setResults([]);
    setSearching(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }

  return { query, results, searching, search, clear };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-card-search.ts
git commit -m "feat: update card search hook to use search_cards RPC"
```

---

## Task 12: Update Components — add-card-modal & sell-modal

**Files:**
- Modify: `src/components/add-card-modal.tsx`
- Modify: `src/components/sell-modal.tsx`

- [ ] **Step 1: Update add-card-modal for new schema**

Key changes: price is now optional (in sen), grading selector gains subgrades/cert_number, calls new `addToInventory` signature.

Replace `src/components/add-card-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import { GradingSelector, type GradingCompany } from "@/components/grading-selector";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];
type Condition = Database["public"]["Tables"]["inventory"]["Row"]["condition"];

const CONDITIONS: Condition[] = ["NM", "LP", "MP", "HP", "DMG"];

interface AddCardModalProps {
  card: Card;
  onAdd: (params: {
    cardId: string;
    priceMyr?: number;
    condition: Condition;
    quantity: number;
    gradingCompany?: string;
    grade?: string;
    subgrades?: Record<string, string>;
    certNumber?: string;
  }) => Promise<void>;
  onClose: () => void;
}

export function AddCardModal({ card, onAdd, onClose }: AddCardModalProps) {
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<Condition>("NM");
  const [quantity, setQuantity] = useState(1);
  const [isGraded, setIsGraded] = useState(false);
  const [gradingCompany, setGradingCompany] = useState<GradingCompany | null>(null);
  const [grade, setGrade] = useState("");
  const [certNumber, setCertNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isGraded && (!gradingCompany || !grade)) {
      setError("Select a grading company and grade");
      return;
    }

    setSaving(true);
    setError(null);

    const priceSen = price ? Math.round(parseFloat(price) * 100) : undefined;
    if (price && (isNaN(priceSen!) || priceSen! < 0)) {
      setError("Enter a valid price");
      setSaving(false);
      return;
    }

    try {
      await onAdd({
        cardId: card.id,
        priceMyr: priceSen,
        condition,
        quantity,
        gradingCompany: isGraded ? gradingCompany ?? undefined : undefined,
        grade: isGraded ? grade || undefined : undefined,
        certNumber: isGraded && certNumber ? certNumber : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add card");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-bg-surface rounded-t-2xl sm:rounded-2xl p-5 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-5">
          {card.image_small ? (
            <img
              src={card.image_small}
              alt={card.name}
              className="w-[70px] h-[98px] rounded-lg object-cover bg-bg-surface-2"
            />
          ) : (
            <div className="w-[70px] h-[98px] rounded-lg bg-bg-surface-2" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-text-primary font-semibold text-[15px] truncate">
              {card.name}
            </h3>
            <p className="text-text-secondary text-xs">
              {card.set_name} · {card.number}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-text-secondary text-xs font-medium mb-1">
              Price (RM) — optional
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Set later"
              className="w-full h-11 bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
            />
          </div>

          <GradingSelector
            isGraded={isGraded}
            onToggleGraded={setIsGraded}
            company={gradingCompany}
            onCompanyChange={setGradingCompany}
            grade={grade}
            onGradeChange={setGrade}
          />

          {isGraded && (
            <div>
              <label className="block text-text-secondary text-xs font-medium mb-1">
                Cert number (optional)
              </label>
              <input
                type="text"
                value={certNumber}
                onChange={(e) => setCertNumber(e.target.value)}
                placeholder="e.g. 12345678"
                className="w-full h-11 bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
              />
            </div>
          )}

          {!isGraded && (
            <div>
              <label className="block text-text-secondary text-xs font-medium mb-1.5">
                Condition
              </label>
              <div className="flex gap-2">
                {CONDITIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCondition(c)}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      condition === c
                        ? "bg-primary-400 text-text-on-primary border-primary-400"
                        : "bg-bg-surface-2 text-text-secondary border-border-default hover:border-border-hover"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-text-secondary text-xs font-medium mb-1">
              Quantity
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default hover:border-border-hover"
              >
                -
              </button>
              <span className="text-text-primary text-lg font-medium w-8 text-center">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity(quantity + 1)}
                className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default hover:border-border-hover"
              >
                +
              </button>
            </div>
          </div>

          {error && (
            <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 text-text-secondary text-sm font-medium rounded-xl border border-border-default hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 h-12 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl disabled:opacity-50 transition-opacity"
            >
              {saving ? "Adding..." : "Add to inventory"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update sell-modal for new schema**

Key changes: `sell_price_rm` → `price_myr` (in sen), `card_id` is nullable, `card` is nullable.

Replace `src/components/sell-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import type { InventoryItem } from "@/hooks/use-inventory";

interface SellModalProps {
  item: InventoryItem;
  onSell: (params: {
    inventoryId: string;
    cardId: string | null;
    salePriceMyr: number;
    condition: string;
    quantity: number;
  }) => Promise<void>;
  onClose: () => void;
}

export function SellModal({ item, onSell, onClose }: SellModalProps) {
  const defaultPrice = item.price_myr != null ? (item.price_myr / 100).toFixed(2) : "";
  const [salePrice, setSalePrice] = useState(defaultPrice);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const cardName = item.card?.name ?? item.manual_card_name ?? "Unknown card";
  const cardImage = item.card?.image_small ?? null;
  const setName = item.card?.set_name ?? item.manual_card_set ?? "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const priceRm = parseFloat(salePrice);
    if (isNaN(priceRm) || priceRm <= 0) {
      setError("Enter a valid sale price");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSell({
        inventoryId: item.id,
        cardId: item.card_id,
        salePriceMyr: Math.round(priceRm * 100),
        condition: item.condition,
        quantity,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record sale");
      setSaving(false);
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="relative w-full max-w-md bg-bg-surface rounded-t-2xl sm:rounded-2xl p-5 text-center py-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-success/15 mx-auto mb-4">
            <svg className="w-7 h-7 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h3 className="text-text-primary font-semibold text-lg mb-1">Sale recorded</h3>
          <p className="text-text-secondary text-sm mb-5">
            {quantity}x {cardName}
          </p>
          <button onClick={onClose} className="w-full h-12 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-bg-surface rounded-t-2xl sm:rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-5">
          {cardImage ? (
            <img src={cardImage} alt={cardName} className="w-[56px] h-[78px] rounded-lg object-cover bg-bg-surface-2" />
          ) : (
            <div className="w-[56px] h-[78px] rounded-lg bg-bg-surface-2" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-text-primary font-semibold text-[15px] truncate">{cardName}</h3>
            <p className="text-text-secondary text-xs">{setName} · {item.condition}</p>
            <p className="text-text-muted text-xs mt-0.5">{item.quantity} in stock</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-text-secondary text-xs font-medium mb-1">Sale price (RM)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              className="w-full h-11 bg-bg-surface-2 text-text-primary rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-text-secondary text-xs font-medium mb-1">Quantity sold</label>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default">-</button>
              <span className="text-text-primary text-lg font-medium w-8 text-center">{quantity}</span>
              <button type="button" onClick={() => setQuantity(Math.min(item.quantity, quantity + 1))} className="w-10 h-10 flex items-center justify-center rounded-lg bg-bg-surface-2 text-text-secondary border border-border-default">+</button>
            </div>
          </div>

          {error && <p className="text-danger text-xs bg-danger/10 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-12 text-text-secondary text-sm font-medium rounded-xl border border-border-default hover:bg-bg-hover transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-12 bg-danger text-white text-sm font-medium rounded-xl disabled:opacity-50 transition-opacity">
              {saving ? "Recording..." : `Sold (-${quantity})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/add-card-modal.tsx src/components/sell-modal.tsx
git commit -m "feat: update add-card and sell modals for new inventory schema"
```

---

## Task 13: Scan Page — Full Rewrite

**Files:**
- Modify: `src/app/(vendor)/scan/page.tsx`

- [ ] **Step 1: Rewrite scan page with Single + Quick Scan modes**

Replace `src/app/(vendor)/scan/page.tsx` entirely:

```typescript
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCamera } from "@/hooks/use-camera";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { useInventory } from "@/hooks/use-inventory";
import { useCardSearch } from "@/hooks/use-card-search";
import { checkPhotoQuality } from "@/lib/vision/quality";
import { AddCardModal } from "@/components/add-card-modal";
import type { IdentifyResult } from "@/lib/vision/types";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];
type ScanMode = "single" | "quick";
type PageState = "camera" | "identifying" | "results";

export default function ScanPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { vendor } = useVendor(user?.id);
  const { addToInventory, addBulkToInventory } = useInventory(vendor?.id);
  const { query, results: searchResults, searching, search, clear: clearSearch } = useCardSearch();
  const { videoRef, canvasRef, status: cameraStatus, error: cameraError, startCamera, capturePhoto, retake } = useCamera();

  const [mode, setMode] = useState<ScanMode>("quick");
  const [pageState, setPageState] = useState<PageState>("camera");
  const [photos, setPhotos] = useState<string[]>([]);
  const [identifyResults, setIdentifyResults] = useState<IdentifyResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [correctionIndex, setCorrectionIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    startCamera();
  }, [startCamera]);

  // Show toast briefly
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  // Convert canvas ImageData to base64
  const imageDataToBase64 = useCallback((imageData: ImageData): string => {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  }, []);

  // Capture a photo
  const handleCapture = useCallback(() => {
    const imageData = capturePhoto();
    if (!imageData) return;

    const quality = checkPhotoQuality(imageData);
    if (!quality.ok) {
      showToast(quality.reason!);
      retake();
      return;
    }

    const base64 = imageDataToBase64(imageData);

    if (mode === "single") {
      setPhotos([base64]);
      setPageState("identifying");
      identifyCards([base64]);
    } else {
      setPhotos((prev) => [...prev, base64]);
      retake();
    }
  }, [capturePhoto, mode, retake, showToast, imageDataToBase64]);

  // Call the identify API
  const identifyCards = useCallback(async (images: string[]) => {
    setPageState("identifying");
    setProgress(0);

    const batchSize = 10;
    const allResults: IdentifyResult[] = [];

    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      try {
        const res = await fetch("/api/scan/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: batch, mode: mode === "quick" ? "quick_scan" : "single_scan" }),
        });
        const data = await res.json();
        if (data.results) {
          allResults.push(...data.results);
        }
      } catch {
        batch.forEach(() =>
          allResults.push({
            scan: { card_name: null, set_name: null, card_number: null, hp: null, rarity: null, card_type: null, subtypes: null, regulation_mark: null, confidence: "low", is_graded: false, grading_company: null, grade: null, subgrades: null, cert_number: null },
            match: { match: null, confidence: "none" },
            latency_ms: 0,
          })
        );
      }
      setProgress(Math.round((allResults.length / images.length) * 100));
    }

    setIdentifyResults(allResults);
    setPageState("results");
  }, [mode]);

  // Handle "Identify All" button in quick scan
  const handleIdentifyAll = useCallback(() => {
    if (photos.length === 0) return;
    identifyCards(photos);
  }, [photos, identifyCards]);

  // Handle bulk add
  const handleAddAll = useCallback(async () => {
    setSaving(true);
    const matched = identifyResults
      .filter((r) => r.match.match && r.match.confidence !== "none")
      .map((r) => ({
        cardId: r.match.match!.id,
        condition: "NM" as const,
        scanSource: "quick_scan",
      }));

    if (matched.length > 0) {
      await addBulkToInventory(matched);
    }
    setSaving(false);
    router.push("/inventory");
  }, [identifyResults, addBulkToInventory, router]);

  // Handle single scan add
  const handleSingleAdd = useCallback(
    async (card: Card) => {
      setSelectedCard(card);
    },
    []
  );

  // Handle correction from search
  const handleCorrection = useCallback(
    (card: Card) => {
      if (correctionIndex !== null) {
        setIdentifyResults((prev) => {
          const updated = [...prev];
          updated[correctionIndex] = {
            ...updated[correctionIndex],
            match: { match: card, confidence: "high" },
          };
          return updated;
        });
        setCorrectionIndex(null);
        clearSearch();
      }
    },
    [correctionIndex, clearSearch]
  );

  // Reset to camera
  const handleReset = useCallback(() => {
    setPhotos([]);
    setIdentifyResults([]);
    setPageState("camera");
    setProgress(0);
    retake();
  }, [retake]);

  // -- RENDER --

  // Camera view
  if (pageState === "camera") {
    return (
      <div className="flex flex-col h-[100dvh] bg-bg-primary">
        {/* Mode toggle */}
        <div className="flex items-center justify-center gap-2 pt-4 pb-2 px-4">
          <button onClick={() => router.back()} className="absolute left-4 top-4 w-10 h-10 flex items-center justify-center rounded-full bg-bg-surface/80">
            <svg className="w-5 h-5 text-text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
          </button>
          <div className="flex bg-bg-surface rounded-lg p-1">
            <button onClick={() => setMode("single")} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === "single" ? "bg-primary-400 text-text-on-primary" : "text-text-secondary"}`}>Single</button>
            <button onClick={() => setMode("quick")} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === "quick" ? "bg-primary-400 text-text-on-primary" : "text-text-secondary"}`}>Quick Scan</button>
          </div>
        </div>

        {/* Camera */}
        <div className="flex-1 relative overflow-hidden mx-4 rounded-2xl bg-black">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline autoPlay muted />
          <canvas ref={canvasRef} className="hidden" />
          {cameraError && <div className="absolute inset-0 flex items-center justify-center p-6"><p className="text-danger text-sm text-center">{cameraError}</p></div>}
        </div>

        {/* Quick scan thumbnail strip */}
        {mode === "quick" && photos.length > 0 && (
          <div className="px-4 py-2">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((_, i) => (
                <div key={i} className="w-10 h-14 rounded-lg bg-bg-surface-2 flex items-center justify-center text-text-secondary text-xs font-medium shrink-0">
                  {i + 1}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom controls */}
        <div className="px-4 py-4 flex items-center justify-center gap-4">
          {mode === "quick" && photos.length > 0 && (
            <button onClick={handleIdentifyAll} className="px-5 py-3 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl">
              Identify All ({photos.length})
            </button>
          )}
          <button onClick={handleCapture} disabled={cameraStatus !== "streaming"} className="w-16 h-16 rounded-full border-4 border-primary-400 flex items-center justify-center disabled:opacity-50">
            <div className="w-12 h-12 rounded-full bg-primary-400" />
          </button>
        </div>

        {toast && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-danger/90 text-white px-4 py-2 rounded-lg text-xs font-medium">
            {toast}
          </div>
        )}
      </div>
    );
  }

  // Identifying state
  if (pageState === "identifying") {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-bg-primary px-4">
        <div className="w-16 h-16 rounded-full border-4 border-primary-400 border-t-transparent animate-spin mb-6" />
        <p className="text-text-primary font-medium mb-2">
          Identifying {photos.length} {photos.length === 1 ? "card" : "cards"}...
        </p>
        <div className="w-full max-w-xs h-2 bg-bg-surface-2 rounded-full overflow-hidden">
          <div className="h-full bg-primary-400 transition-all duration-300 rounded-full" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-text-muted text-xs mt-2">{progress}%</p>
      </div>
    );
  }

  // Results state
  return (
    <div className="flex flex-col h-[100dvh] bg-bg-primary">
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <button onClick={handleReset} className="text-text-secondary text-sm">Scan more</button>
        <h2 className="text-text-primary font-semibold text-sm">
          {identifyResults.filter((r) => r.match.match).length}/{identifyResults.length} matched
        </h2>
        <div />
      </header>

      {/* Correction search */}
      {correctionIndex !== null && (
        <div className="px-4 pb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Search for correct card..."
            className="w-full h-10 bg-bg-surface-2 text-text-primary rounded-xl px-3 text-sm border border-border-default focus:border-border-focus focus:outline-none"
            autoFocus
          />
          {searchResults.length > 0 && (
            <div className="mt-1 max-h-48 overflow-y-auto bg-bg-surface rounded-xl border border-border-default">
              {searchResults.map((card) => (
                <button key={card.id} onClick={() => handleCorrection(card)} className="w-full text-left px-3 py-2 hover:bg-bg-hover flex items-center gap-2">
                  {card.image_small && <img src={card.image_small} className="w-8 h-11 rounded object-cover" alt="" />}
                  <div>
                    <p className="text-text-primary text-xs font-medium">{card.name}</p>
                    <p className="text-text-muted text-[10px]">{card.set_name} · {card.number}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => { setCorrectionIndex(null); clearSearch(); }} className="text-text-muted text-xs mt-1">Cancel</button>
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 overflow-y-auto px-4">
        {identifyResults.map((result, i) => {
          const card = result.match.match;
          const isMatched = card && result.match.confidence !== "none";
          return (
            <div key={i} className={`flex items-center gap-3 py-3 border-b border-border-default ${!isMatched ? "opacity-70" : ""}`}>
              <div className="w-10 h-14 rounded-lg bg-bg-surface-2 flex items-center justify-center shrink-0 overflow-hidden">
                {card?.image_small ? (
                  <img src={card.image_small} className="w-full h-full object-cover" alt="" />
                ) : (
                  <span className="text-text-muted text-xs">?</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {isMatched ? (
                  <>
                    <p className="text-text-primary text-sm font-medium truncate">{card.name}</p>
                    <p className="text-text-muted text-[11px]">{card.set_name} · {card.number}</p>
                  </>
                ) : (
                  <p className="text-warning text-sm font-medium">Not identified</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isMatched ? (
                  <span className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center">
                    <svg className="w-3 h-3 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                  </span>
                ) : (
                  <button onClick={() => setCorrectionIndex(i)} className="text-warning text-xs font-medium">Fix</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom action */}
      <div className="px-4 py-4 border-t border-border-default">
        {mode === "single" && identifyResults[0]?.match.match ? (
          <button onClick={() => handleSingleAdd(identifyResults[0].match.match!)} className="w-full h-12 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl">
            Add to inventory
          </button>
        ) : (
          <button onClick={handleAddAll} disabled={saving || identifyResults.filter((r) => r.match.match).length === 0} className="w-full h-12 bg-primary-400 text-text-on-primary text-sm font-medium rounded-xl disabled:opacity-50">
            {saving ? "Adding..." : `Add ${identifyResults.filter((r) => r.match.match).length} cards to inventory`}
          </button>
        )}
      </div>

      {/* Add card modal for single scan */}
      {selectedCard && (
        <AddCardModal
          card={selectedCard}
          onAdd={async (params) => {
            await addToInventory({ ...params, scanSource: "single_scan" });
            router.push("/inventory");
          }}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(vendor\)/scan/page.tsx
git commit -m "feat: rewrite scan page with Quick Scan + Single Scan vision AI modes"
```

---

## Task 14: Update Inventory Page for New Schema

**Files:**
- Modify: `src/app/(vendor)/inventory/page.tsx`

- [ ] **Step 1: Update inventory page to use new schema fields**

Key changes needed in `src/app/(vendor)/inventory/page.tsx`:
- `item.sell_price_rm` → `item.price_myr` (display as RM by dividing by 100)
- `item.card.card_number` → `item.card?.number` (card is nullable)
- `item.card.market_price_rm` → removed (no market price in new schema)
- `item.card_id` → nullable, fallback to `manual_card_name`
- CSV export needs to use new field names

Replace the `handleExportCSV` and the `filtered` display logic. The card reference uses `item.card?.name ?? item.manual_card_name ?? "Unknown"` pattern:

In the inventory page, make these targeted edits:
- Change all `item.card.name` to `item.card?.name ?? item.manual_card_name ?? "Unknown"`
- Change all `item.card.set_name` to `item.card?.set_name ?? item.manual_card_set ?? ""`
- Change all `item.card.card_number` to `item.card?.number ?? item.manual_card_number ?? ""`
- Change all `item.sell_price_rm` to `item.price_myr != null ? item.price_myr / 100 : null`
- Change all `item.card.image_small` to `item.card?.image_small`
- Remove `totalMarketValue`, `totalAskingPrice`, `potentialProfit` references (no market price in new schema)
- Remove `item.card.market_price_rm` references
- Update the filter to use the nullable card pattern
- Update CSV export to use new fields

- [ ] **Step 2: Commit**

```bash
git add src/app/\(vendor\)/inventory/page.tsx
git commit -m "feat: update inventory page for new schema (nullable card, price in sen)"
```

---

## Task 15: Update Grading Selector

**Files:**
- Modify: `src/components/grading-selector.tsx`

- [ ] **Step 1: Add SGC and TAG to grading companies**

The cardScan.md spec lists 6 companies: PSA, BGS, CGC, SGC, TAG, ACE. Current code only has PSA, BGS, CGC, ACE.

In `src/components/grading-selector.tsx`, update:

```typescript
const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "TAG", "ACE"] as const;
export type GradingCompany = (typeof GRADING_COMPANIES)[number];

const HAS_HALF_GRADES: Record<GradingCompany, boolean> = {
  PSA: false,
  BGS: true,
  CGC: true,
  SGC: false,
  TAG: false,
  ACE: false,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/grading-selector.tsx
git commit -m "feat: add SGC and TAG to grading companies"
```

---

## Task 16: Fix Build Errors & Verify

**Files:**
- Various files that may have remaining type errors

- [ ] **Step 1: Run type check**

```bash
npx tsc --noEmit
```

Fix any remaining type errors. Common issues:
- Dashboard hook referencing `totalMarketValue` / `totalAskingPrice` (removed from use-inventory)
- Storefront pages referencing `sell_price_rm` or `card_number`
- Any import of deleted files

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Fix any lint errors.

- [ ] **Step 3: Run tests**

```bash
npm run test
```

Fix any failing tests related to the old schema.

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve type and lint errors from schema migration"
```

---

## Task 17: Add .env.example with New Variables

**Files:**
- Modify or create: `.env.example`

- [ ] **Step 1: Add vision AI env vars to example**

Add these to `.env.example` (or `.env.local.example`):

```
# Vision AI (card scanning)
VISION_PROVIDER=gemini
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add vision AI env vars to .env.example"
```
