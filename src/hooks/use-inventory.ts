"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];
type InventoryRow = Database["public"]["Tables"]["inventory"]["Row"];
type Condition = InventoryRow["condition"];

export interface InventoryItem extends InventoryRow {
  card: Card;
}

export function useInventory(vendorId: string | undefined) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalProfit, setTotalProfit] = useState<number | null>(null);
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const fetchInventory = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("inventory")
      .select("*, card:cards(*)")
      .eq("vendor_id", vendorId)
      .order("updated_at", { ascending: false });

    if (!error && data) {
      const mapped: InventoryItem[] = data.map((row) => {
        const { card, ...rest } = row as Record<string, unknown>;
        return {
          ...(rest as InventoryRow),
          card: card as Card,
        };
      });
      setItems(mapped);
    }
    setLoading(false);
  }, [vendorId, supabase]);

  const fetchProfit = useCallback(async () => {
    if (!vendorId) return;

    const { data: sells } = await supabase
      .from("transactions")
      .select("price_rm, quantity")
      .eq("vendor_id", vendorId)
      .eq("type", "sell");

    const { data: buys } = await supabase
      .from("transactions")
      .select("price_rm, quantity")
      .eq("vendor_id", vendorId)
      .eq("type", "buy");

    type TxRow = { price_rm: number; quantity: number };
    const totalRevenue = (sells ?? []).reduce(
      (sum, t) => sum + (t as TxRow).price_rm * (t as TxRow).quantity,
      0
    );
    const totalCost = (buys ?? []).reduce(
      (sum, t) => sum + (t as TxRow).price_rm * (t as TxRow).quantity,
      0
    );

    setTotalProfit(totalRevenue - totalCost);
  }, [vendorId, supabase]);

  useEffect(() => {
    fetchInventory();
    fetchProfit();
  }, [fetchInventory, fetchProfit]);

  async function addToInventory(params: {
    cardId: string;
    sellPriceRm: number;
    buyPriceRm?: number;
    condition: Condition;
    quantity: number;
    gradingCompany?: string;
    grade?: string;
  }) {
    if (!vendorId) throw new Error("Not authenticated");

    const existing = items.find(
      (i) =>
        i.card_id === params.cardId &&
        i.condition === params.condition &&
        (i.grading_company ?? "") === (params.gradingCompany ?? "") &&
        (i.grade ?? "") === (params.grade ?? "")
    );

    if (existing) {
      const { error } = await db
        .from("inventory")
        .update({
          quantity: existing.quantity + params.quantity,
          sell_price_rm: params.sellPriceRm,
          buy_price_rm: params.buyPriceRm ?? existing.buy_price_rm,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (error) throw error;
    } else {
      const { error } = await db.from("inventory").insert({
        vendor_id: vendorId,
        card_id: params.cardId,
        sell_price_rm: params.sellPriceRm,
        buy_price_rm: params.buyPriceRm,
        condition: params.condition,
        quantity: params.quantity,
        grading_company: params.gradingCompany ?? null,
        grade: params.grade ?? null,
      });

      if (error) throw error;
    }

    if (params.buyPriceRm != null) {
      await db.from("transactions").insert({
        vendor_id: vendorId,
        card_id: params.cardId,
        type: "buy",
        quantity: params.quantity,
        price_rm: params.buyPriceRm,
        condition: params.condition,
      });
    }

    await fetchInventory();
    await fetchProfit();
  }

  async function sellFromInventory(params: {
    inventoryId: string;
    cardId: string;
    salePriceRm: number;
    condition: string;
    quantity: number;
  }) {
    if (!vendorId) throw new Error("Not authenticated");

    const item = items.find((i) => i.id === params.inventoryId);
    if (!item) throw new Error("Item not found");

    if (item.quantity <= params.quantity) {
      const { error } = await db
        .from("inventory")
        .delete()
        .eq("id", params.inventoryId);
      if (error) throw error;
    } else {
      const { error } = await db
        .from("inventory")
        .update({
          quantity: item.quantity - params.quantity,
          updated_at: new Date().toISOString(),
        })
        .eq("id", params.inventoryId);
      if (error) throw error;
    }

    await db.from("transactions").insert({
      vendor_id: vendorId,
      card_id: params.cardId,
      type: "sell",
      quantity: params.quantity,
      price_rm: params.salePriceRm,
      market_price_at_time: item.card.market_price_rm,
      condition: params.condition,
    });

    await fetchInventory();
    await fetchProfit();
  }

  const totalCards = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalMarketValue = items.reduce(
    (sum, i) => sum + (i.card.market_price_rm ?? 0) * i.quantity,
    0
  );
  const totalAskingPrice = items.reduce(
    (sum, i) => sum + i.sell_price_rm * i.quantity,
    0
  );

  return {
    items,
    loading,
    addToInventory,
    sellFromInventory,
    refresh: fetchInventory,
    totalCards,
    totalMarketValue,
    totalAskingPrice,
    totalProfit,
  };
}
