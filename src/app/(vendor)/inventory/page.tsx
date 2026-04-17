"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useInventory, type InventoryItem } from "@/hooks/use-inventory";
import { CardSearch } from "@/components/card-search";
import { AddCardModal } from "@/components/add-card-modal";
import { SellModal } from "@/components/sell-modal";
import Link from "next/link";
import type { Database } from "@/types/database";

type Card = Database["public"]["Tables"]["cards"]["Row"];

export default function InventoryPage() {
  const { user } = useAuth();
  const {
    items,
    loading,
    addToInventory,
    sellFromInventory,
    totalCards,
    totalMarketValue,
    totalAskingPrice,
    totalProfit,
  } = useInventory(user?.id);

  const [addCard, setAddCard] = useState<Card | null>(null);
  const [sellItem, setSellItem] = useState<InventoryItem | null>(null);
  const [filter, setFilter] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("grid");

  const filtered = filter
    ? items.filter(
        (i) =>
          i.card.name.toLowerCase().includes(filter.toLowerCase()) ||
          i.card.set_name.toLowerCase().includes(filter.toLowerCase()) ||
          i.card.card_number.toLowerCase().includes(filter.toLowerCase())
      )
    : items;

  const setNames = [...new Set(items.map((i) => i.card.set_name))].sort();
  const potentialProfit = totalAskingPrice - totalMarketValue;

  return (
    <div className="px-4 pt-6">
      {/* 1. Header: KardVault logo + card count */}
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">
          <span className="text-text-primary">Kad</span>
          <span className="text-primary-400">Vault</span>
        </h1>
        <span className="text-text-secondary text-sm">
          {totalCards} {totalCards === 1 ? "card" : "cards"}
        </span>
      </header>

      {/* 2. Summary row (3 columns): Total value, Your price, Potential */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-bg-surface rounded-xl p-2.5">
          <p className="text-text-muted text-[9px] uppercase tracking-wider">
            Total Value
          </p>
          <p className="text-text-primary text-[15px] font-bold mt-0.5">
            RM {totalMarketValue.toLocaleString("en", { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="bg-bg-surface rounded-xl p-2.5">
          <p className="text-text-muted text-[9px] uppercase tracking-wider">
            Your Price
          </p>
          <p className="text-text-primary text-[15px] font-bold mt-0.5">
            RM {totalAskingPrice.toLocaleString("en", { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="bg-bg-surface rounded-xl p-2.5">
          <p className="text-text-muted text-[9px] uppercase tracking-wider">
            Potential
          </p>
          <p
            className={`text-[15px] font-bold mt-0.5 ${
              potentialProfit >= 0 ? "text-success" : "text-danger"
            }`}
          >
            {potentialProfit >= 0 ? "+" : ""}RM{" "}
            {Math.abs(potentialProfit).toLocaleString("en", { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {/* Add card search */}
      <div className="mb-4">
        <CardSearch
          onSelect={(card) => setAddCard(card)}
          placeholder="Search to add a card..."
        />
      </div>

      {/* 3. Action buttons row (3 buttons, equal width) */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Link href="/import" className="flex items-center justify-center gap-1.5 h-10 bg-primary-800 text-primary-50 text-xs font-medium rounded-xl border border-primary-600">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          Import CSV
        </Link>
        <button className="flex items-center justify-center gap-1.5 h-10 bg-bg-surface text-text-secondary text-xs font-medium rounded-xl border border-border-default">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12M12 16.5V3" />
          </svg>
          Export CSV
        </button>
        <button className="flex items-center justify-center gap-1.5 h-10 bg-bg-surface text-text-secondary text-xs font-medium rounded-xl border border-border-default">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
          </svg>
          Filter
        </button>
      </div>

      {/* 4. Search bar with view toggle */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
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
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search cards..."
            className="w-full bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl pl-10 pr-4 py-2.5 text-sm border border-border-default focus:border-border-focus focus:outline-none"
          />
        </div>
        <div className="flex bg-bg-surface rounded-lg border border-border-default p-0.5">
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 rounded transition-colors ${
              viewMode === "list"
                ? "bg-primary-800 text-primary-50"
                : "text-text-muted"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 rounded transition-colors ${
              viewMode === "grid"
                ? "bg-primary-800 text-primary-50"
                : "text-text-muted"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 5. Filter chips */}
      {setNames.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-3 mb-1 -mx-4 px-4 scrollbar-hide">
          <button
            onClick={() => setFilter("")}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              !filter
                ? "bg-primary-400 text-text-on-primary"
                : "bg-bg-surface text-text-secondary border border-border-default"
            }`}
          >
            All
          </button>
          {setNames.map((name) => (
            <button
              key={name}
              onClick={() => setFilter(name)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                filter === name
                  ? "bg-primary-400 text-text-on-primary"
                  : "bg-bg-surface text-text-secondary border border-border-default"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* 6 & 7. Card list / grid */}
      {loading ? (
        <div className="bg-bg-surface rounded-xl p-4">
          <p className="text-text-muted text-sm text-center py-8">
            Loading inventory...
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-surface rounded-xl p-4">
          <p className="text-text-secondary text-sm text-center py-12">
            {totalCards === 0
              ? "Your inventory is empty. Tap + to scan your first card."
              : "No cards match your filter."}
          </p>
        </div>
      ) : viewMode === "list" ? (
        <div className="space-y-1.5">
          {filtered.map((item) => (
            <InventoryListCard
              key={item.id}
              item={item}
              onTap={() => setSellItem(item)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((item) => (
            <InventoryGridCard
              key={item.id}
              item={item}
              onTap={() => setSellItem(item)}
            />
          ))}
        </div>
      )}


      {/* Modals */}
      {addCard && (
        <AddCardModal
          card={addCard}
          onAdd={addToInventory}
          onClose={() => setAddCard(null)}
        />
      )}
      {sellItem && (
        <SellModal
          item={sellItem}
          onSell={sellFromInventory}
          onClose={() => setSellItem(null)}
        />
      )}
    </div>
  );
}

// ─── Grading Badge ─────────────────────────────────────────

function GradingBadge({ item }: { item: InventoryItem }) {
  if (!item.grading_company || !item.grade) return null;
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary-400/15 text-primary-400">
      {item.grading_company} {item.grade}
    </span>
  );
}

// ─── Grid Card ──────────────────────────────────────────────

function InventoryGridCard({
  item,
  onTap,
}: {
  item: InventoryItem;
  onTap: () => void;
}) {
  const card = item.card;
  const marketPrice = card.market_price_rm ?? 0;
  const delta =
    marketPrice > 0
      ? ((item.sell_price_rm - marketPrice) / marketPrice) * 100
      : 0;

  return (
    <button
      onClick={onTap}
      className="group relative bg-bg-surface rounded-2xl overflow-hidden text-left border border-border-default hover:border-primary-600 transition-all"
    >
      {/* Image */}
      <div className="relative p-3 pb-2">
        {card.image_small ? (
          <img
            src={card.image_small}
            alt={card.name}
            className="w-full rounded-xl group-hover:scale-[1.02] transition-transform"
          />
        ) : (
          <div className="w-full aspect-[2/3] rounded-xl bg-bg-surface-2" />
        )}

        {/* Grading or condition badge — top right on image */}
        <span
          className={`absolute top-4 right-4 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${
            item.grading_company
              ? "bg-primary-400/90 text-white"
              : item.condition === "NM"
              ? "bg-success/90 text-white"
              : item.condition === "LP"
              ? "bg-info/90 text-white"
              : item.condition === "MP"
              ? "bg-warning/90 text-white"
              : "bg-danger/90 text-white"
          }`}
        >
          {item.grading_company ? `${item.grading_company} ${item.grade}` : item.condition}
        </span>

        {/* Quantity badge — top left on image */}
        {item.quantity > 1 && (
          <span className="absolute top-4 left-4 min-w-[22px] h-[22px] flex items-center justify-center bg-primary-400 text-text-on-primary text-[10px] font-bold rounded-lg px-1">
            +{item.quantity}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="px-3 pb-3">
        <p className="text-text-primary text-[13px] font-semibold truncate">
          {card.name}
        </p>
        <p className="text-text-muted text-[11px] truncate">
          {card.set_name} · {card.card_number}
        </p>

        <div className="flex items-baseline justify-between mt-2">
          <p className="text-text-primary text-[15px] font-bold">
            RM {item.sell_price_rm.toLocaleString("en", { maximumFractionDigits: 0 })}
          </p>
        </div>

        {marketPrice > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-text-muted text-[10px]">
              Mkt: RM {marketPrice.toLocaleString("en", { maximumFractionDigits: 0 })}
            </span>
            {Math.abs(delta) >= 1 && (
              <span
                className={`text-[10px] font-semibold ${
                  delta > 0 ? "text-success" : "text-danger"
                }`}
              >
                {delta > 0 ? "▲" : "▼"} {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── List Card ──────────────────────────────────────────────

function InventoryListCard({
  item,
  onTap,
}: {
  item: InventoryItem;
  onTap: () => void;
}) {
  const card = item.card;
  const marketPrice = card.market_price_rm ?? 0;
  const delta =
    marketPrice > 0
      ? ((item.sell_price_rm - marketPrice) / marketPrice) * 100
      : 0;

  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-3 bg-bg-surface rounded-xl p-3 text-left hover:bg-bg-hover transition-colors"
    >
      {/* Card image + quantity badge */}
      <div className="relative shrink-0">
        {card.image_small ? (
          <img
            src={card.image_small}
            alt={card.name}
            className="w-[42px] h-[58px] rounded object-cover bg-bg-surface-2"
          />
        ) : (
          <div className="w-[42px] h-[58px] rounded bg-bg-surface-2" />
        )}
        {item.quantity > 1 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-primary-400 text-text-on-primary text-[10px] font-bold rounded-full px-1">
            ×{item.quantity}
          </span>
        )}
      </div>

      {/* Card info */}
      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-sm font-medium truncate">
          {card.name}
        </p>
        <p className="text-text-secondary text-xs truncate">
          {card.set_name} · {card.card_number}
        </p>
        {item.grading_company ? (
          <GradingBadge item={item} />
        ) : (
          <span
            className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
              item.condition === "NM"
                ? "bg-success/15 text-success"
                : item.condition === "LP"
                ? "bg-info/15 text-info"
                : item.condition === "MP"
                ? "bg-warning/15 text-warning"
                : "bg-danger/15 text-danger"
            }`}
          >
            {item.condition}
          </span>
        )}
      </div>

      {/* Prices */}
      <div className="text-right shrink-0">
        <p className="text-text-primary text-sm font-medium">
          RM {item.sell_price_rm.toFixed(2)}
        </p>
        {marketPrice > 0 && (
          <div className="flex items-center justify-end gap-1 mt-0.5">
            <span className="text-text-muted text-[10px]">
              RM {marketPrice.toFixed(2)}
            </span>
            {Math.abs(delta) >= 1 && (
              <span
                className={`text-[10px] font-medium ${
                  delta > 0 ? "text-success" : "text-danger"
                }`}
              >
                {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
