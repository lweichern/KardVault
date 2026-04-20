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
        return { ...(rest as InventoryRow), card: (card as Card) ?? null };
      });
      setItems(mapped);
    }
    setLoading(false);
  }, [vendorId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInventory();
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
    cards: { cardId: string; condition?: Condition; scanSource?: string }[]
  ) {
    if (!vendorId) throw new Error("Not authenticated");
    const rows = cards.map((c) => ({
      vendor_id: vendorId,
      card_id: c.cardId,
      condition: c.condition ?? ("NM" as Condition),
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
