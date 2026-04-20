"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];

// --- Types ---

export interface SaleRecord {
  id: string;
  card_id: string;
  quantity: number;
  price_rm: number;
  market_price_at_time: number | null;
  condition: string;
  created_at: string;
  card: Card;
}

export interface TopCard {
  card: Card;
  value: number;
  label: string;
}

export interface ChartPoint {
  date: string; // "Apr 1", "Apr 2", etc.
  revenue: number;
}

export interface AgingBucket {
  label: string;
  count: number;
  color: string;
}

export interface DashboardData {
  // Stats row — with week-over-week deltas
  inventoryCount: number;
  inventoryDelta: number | null; // week-over-week change
  marketValue: number;
  marketValueDelta: number | null;
  cardsSoldThisMonth: number;
  cardsSoldDelta: number | null;

  // Revenue chart
  revenueThisMonth: number;
  chartData7d: ChartPoint[];
  chartData30d: ChartPoint[];
  chartData90d: ChartPoint[];

  // Profit row
  totalProfit: number;
  avgMarginPct: number | null;
  avgSellPrice: number | null;

  // Recent sales
  recentSales: SaleRecord[];

  // Inventory aging
  agingBuckets: AgingBucket[];

  // Best performers (2×2)
  highestMarginCard: TopCard | null;
  mostSoldCard: TopCard | null;
  longestHeldCard: TopCard | null;
  biggestPriceRise: TopCard | null;

  // Buyer Interest Signals
  mostViewedCards: { card: Card; viewCount: number }[];
  viewedButUnsold: { card: Card; viewCount: number }[];
  searchMisses: { query: string; searchCount: number }[];

  // Today's sales (for report)
  todaySalesCount: number;
  todayRevenue: number;
  todayAvgMarginPct: number | null;
  todayBestSeller: { card: Card; quantity: number } | null;

  loading: boolean;
}

// --- Helpers ---

export function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildChartData(
  sells: { price_rm: number; quantity: number; created_at: string }[],
  days: number
): ChartPoint[] {
  const points: ChartPoint[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const dayRevenue = sells
      .filter((s) => {
        const t = new Date(s.created_at).getTime();
        return t >= date.getTime() && t < nextDate.getTime();
      })
      .reduce((sum, s) => sum + s.price_rm * s.quantity, 0);

    points.push({
      date: formatShortDate(date),
      revenue: Math.round(dayRevenue * 100) / 100,
    });
  }
  return points;
}

// --- Hook ---

export function useDashboard(vendorId: string | undefined): DashboardData {
  const [data, setData] = useState<Omit<DashboardData, "loading">>({
    inventoryCount: 0,
    inventoryDelta: null,
    marketValue: 0,
    marketValueDelta: null,
    cardsSoldThisMonth: 0,
    cardsSoldDelta: null,
    revenueThisMonth: 0,
    chartData7d: [],
    chartData30d: [],
    chartData90d: [],
    totalProfit: 0,
    avgMarginPct: null,
    avgSellPrice: null,
    recentSales: [],
    agingBuckets: [],
    highestMarginCard: null,
    mostSoldCard: null,
    longestHeldCard: null,
    biggestPriceRise: null,
    mostViewedCards: [],
    viewedButUnsold: [],
    searchMisses: [],
    todaySalesCount: 0,
    todayRevenue: 0,
    todayAvgMarginPct: null,
    todayBestSeller: null,
  });
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchDashboard = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const weekAgo = daysAgo(7).toISOString();
    const twoWeeksAgo = daysAgo(14).toISOString();
    const ninetyDaysAgo = daysAgo(90).toISOString();

    const [invRes, sellsAllRes, buysAllRes, recentRes, sells90dRes, sellsThisWeekRes, sellsLastWeekRes] =
      await Promise.all([
        // Inventory with card join
        supabase
          .from("inventory")
          .select("quantity, sell_price_rm, listed_at, card:cards(id, name, image_small, set_name, market_price_rm, tcgplayer_market_price)")
          .eq("vendor_id", vendorId),
        // All sell transactions
        supabase
          .from("transactions")
          .select("*, card:cards(*)")
          .eq("vendor_id", vendorId)
          .eq("type", "sell"),
        // All buy transactions
        supabase
          .from("transactions")
          .select("price_rm, quantity, card_id")
          .eq("vendor_id", vendorId)
          .eq("type", "buy"),
        // Recent 10 sales
        supabase
          .from("transactions")
          .select("*, card:cards(*)")
          .eq("vendor_id", vendorId)
          .eq("type", "sell")
          .order("created_at", { ascending: false })
          .limit(10),
        // Sells in last 90 days (for charts)
        supabase
          .from("transactions")
          .select("price_rm, quantity, created_at")
          .eq("vendor_id", vendorId)
          .eq("type", "sell")
          .gte("created_at", ninetyDaysAgo),
        // This week's sells (for delta)
        supabase
          .from("transactions")
          .select("price_rm, quantity")
          .eq("vendor_id", vendorId)
          .eq("type", "sell")
          .gte("created_at", weekAgo),
        // Last week's sells (for delta)
        supabase
          .from("transactions")
          .select("price_rm, quantity")
          .eq("vendor_id", vendorId)
          .eq("type", "sell")
          .gte("created_at", twoWeeksAgo)
          .lt("created_at", weekAgo),
      ]);

    // --- Inventory stats ---
    type InvRow = { quantity: number; sell_price_rm: number; listed_at: string; card: { id: string; name: string; image_small: string | null; set_name: string; market_price_rm: number | null; tcgplayer_market_price: number | null } | null };
    const invRows = (invRes.data ?? []) as unknown as InvRow[];
    const inventoryCount = invRows.reduce((s, r) => s + r.quantity, 0);
    const marketValue = invRows.reduce(
      (s, r) => s + (r.card?.market_price_rm ?? 0) * r.quantity, 0
    );

    // --- Buy cost map ---
    type BuyRow = { price_rm: number; quantity: number; card_id: string };
    const buyRows = (buysAllRes.data ?? []) as unknown as BuyRow[];
    const buyCostByCard = new Map<string, number>();
    let totalBuyCost = 0;
    for (const b of buyRows) {
      const cost = b.price_rm * b.quantity;
      buyCostByCard.set(b.card_id, (buyCostByCard.get(b.card_id) ?? 0) + cost);
      totalBuyCost += cost;
    }

    // --- All sells ---
    type SellRow = { id: string; card_id: string; price_rm: number; quantity: number; market_price_at_time: number | null; condition: string; created_at: string; card: Card };
    const sellRows = (sellsAllRes.data ?? []) as unknown as SellRow[];
    const totalRevenue = sellRows.reduce((s, r) => s + r.price_rm * r.quantity, 0);
    const totalSoldQty = sellRows.reduce((s, r) => s + r.quantity, 0);
    const totalProfit = totalRevenue - totalBuyCost;
    const avgMarginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : null;
    const avgSellPrice = totalSoldQty > 0 ? totalRevenue / totalSoldQty : null;

    // --- This month ---
    const monthSells = sellRows.filter((s) => s.created_at >= monthStart);
    const revenueThisMonth = monthSells.reduce((s, r) => s + r.price_rm * r.quantity, 0);
    const cardsSoldThisMonth = monthSells.reduce((s, r) => s + r.quantity, 0);

    // --- Week-over-week deltas ---
    type WkRow = { price_rm: number; quantity: number };
    const thisWeekSells = (sellsThisWeekRes.data ?? []) as unknown as WkRow[];
    const lastWeekSells = (sellsLastWeekRes.data ?? []) as unknown as WkRow[];
    const thisWeekQty = thisWeekSells.reduce((s, r) => s + r.quantity, 0);
    const lastWeekQty = lastWeekSells.reduce((s, r) => s + r.quantity, 0);
    const cardsSoldDelta = thisWeekQty - lastWeekQty;

    // --- Chart data ---
    type ChartSell = { price_rm: number; quantity: number; created_at: string };
    const sells90d = (sells90dRes.data ?? []) as unknown as ChartSell[];
    const chartData7d = buildChartData(sells90d, 7);
    const chartData30d = buildChartData(sells90d, 30);
    const chartData90d = buildChartData(sells90d, 90);

    // --- Recent sales ---
    const recentSales = ((recentRes.data ?? []) as unknown as SellRow[]).map((r) => ({
      id: r.id,
      card_id: r.card_id,
      quantity: r.quantity,
      price_rm: r.price_rm,
      market_price_at_time: r.market_price_at_time,
      condition: r.condition,
      created_at: r.created_at,
      card: r.card,
    }));

    // --- Inventory aging ---
    const agingBuckets: AgingBucket[] = [
      { label: "<30d", count: 0, color: "#7C6BB5" },   // primary-400 violet
      { label: "30-60d", count: 0, color: "#E5C05C" },  // warning yellow
      { label: "60-90d", count: 0, color: "#D4884B" },  // orange
      { label: "90d+", count: 0, color: "#D96B7A" },    // danger red
    ];
    for (const inv of invRows) {
      const ageDays = Math.floor(
        (Date.now() - new Date(inv.listed_at).getTime()) / 86400000
      );
      if (ageDays < 30) agingBuckets[0].count += inv.quantity;
      else if (ageDays < 60) agingBuckets[1].count += inv.quantity;
      else if (ageDays < 90) agingBuckets[2].count += inv.quantity;
      else agingBuckets[3].count += inv.quantity;
    }

    // --- Best performers (2×2) ---
    // Aggregate sells by card
    const cardSellStats = new Map<string, { card: Card; totalRevenue: number; totalQuantity: number; totalCost: number }>();
    for (const s of sellRows) {
      const existing = cardSellStats.get(s.card_id);
      if (existing) {
        existing.totalRevenue += s.price_rm * s.quantity;
        existing.totalQuantity += s.quantity;
      } else {
        cardSellStats.set(s.card_id, {
          card: s.card,
          totalRevenue: s.price_rm * s.quantity,
          totalQuantity: s.quantity,
          totalCost: buyCostByCard.get(s.card_id) ?? 0,
        });
      }
    }
    const cardArr = [...cardSellStats.values()];

    // Highest margin
    const highestMarginCard = cardArr.length > 0
      ? (() => {
          const best = cardArr.reduce((a, b) =>
            (a.totalRevenue - a.totalCost) > (b.totalRevenue - b.totalCost) ? a : b
          );
          const profit = best.totalRevenue - best.totalCost;
          return { card: best.card, value: profit, label: `+RM ${profit.toFixed(0)}` };
        })()
      : null;

    // Most sold
    const mostSoldCard = cardArr.length > 0
      ? (() => {
          const best = cardArr.reduce((a, b) => a.totalQuantity > b.totalQuantity ? a : b);
          return { card: best.card, value: best.totalQuantity, label: `${best.totalQuantity} sold` };
        })()
      : null;

    // Longest held (from inventory)
    const longestHeldCard = invRows.length > 0
      ? (() => {
          const oldest = invRows.reduce((a, b) =>
            new Date(a.listed_at) < new Date(b.listed_at) ? a : b
          );
          const ageDays = Math.floor((Date.now() - new Date(oldest.listed_at).getTime()) / 86400000);
          return oldest.card
            ? { card: oldest.card as unknown as Card, value: ageDays, label: `${ageDays} days` }
            : null;
        })()
      : null;

    // Biggest price rise — cards where market > sell price (appreciation)
    const biggestPriceRise = invRows.length > 0
      ? (() => {
          let best: { card: InvRow["card"]; rise: number } | null = null;
          for (const inv of invRows) {
            if (!inv.card?.market_price_rm) continue;
            const rise = inv.card.market_price_rm - inv.sell_price_rm;
            if (!best || rise > best.rise) {
              best = { card: inv.card, rise };
            }
          }
          return best && best.rise > 0
            ? { card: best.card as unknown as Card, value: best.rise, label: `+RM ${best.rise.toFixed(0)}` }
            : null;
        })()
      : null;

    // --- Buyer Interest Signals ---
    const weekAgoISO = weekAgo;

    // Most viewed cards (top 5)
    const { data: viewsRaw } = await supabase
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

    // Viewed but unsold
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

    // Search misses
    const { data: searchesRaw } = await supabase
      .from("storefront_searches")
      .select("query")
      .eq("vendor_id", vendorId)
      .eq("results_count", 0)
      .gte("searched_at", weekAgoISO);

    type SearchRow = { query: string };
    const searchRows2 = (searchesRaw ?? []) as SearchRow[];
    const searchCountMap = new Map<string, number>();
    for (const s of searchRows2) {
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
    const todayAvgMarginPct =
      todayRevenue > 0 && totalRevenue > 0 ? avgMarginPct : null;

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

    setData({
      inventoryCount,
      inventoryDelta: null, // would need historical snapshots
      marketValue,
      marketValueDelta: null,
      cardsSoldThisMonth,
      cardsSoldDelta,
      revenueThisMonth,
      chartData7d,
      chartData30d,
      chartData90d,
      totalProfit,
      avgMarginPct,
      avgSellPrice,
      recentSales,
      agingBuckets,
      highestMarginCard,
      mostSoldCard,
      longestHeldCard,
      biggestPriceRise,
      mostViewedCards,
      viewedButUnsold,
      searchMisses,
      todaySalesCount,
      todayRevenue,
      todayAvgMarginPct,
      todayBestSeller,
    });
    setLoading(false);
  }, [vendorId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchDashboard();
  }, [fetchDashboard]);

  return { ...data, loading };
}
