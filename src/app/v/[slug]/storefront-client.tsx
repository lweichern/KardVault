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
  const [layout, setLayout] = useState<"list" | "grid">("list");

  const setNames = useMemo(() => {
    const sets = new Set(items.map((item) => item.card.set_name));
    return Array.from(sets).sort();
  }, [items]);

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

  const initials = vendor.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const generalWhatsAppUrl = `https://wa.me/${vendor.whatsappNumber}?text=${encodeURIComponent("Hi, I found your store on KardVault!")}`;

  function cardWhatsAppUrl(cardName: string) {
    return `https://wa.me/${vendor.whatsappNumber}?text=${encodeURIComponent(`I'm interested in ${cardName} from your KardVault store`)}`;
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

        {/* Filter chips + layout toggle */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
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

          {/* Layout toggle */}
          <div className="flex flex-shrink-0 bg-storefront-surface border border-storefront-border rounded-lg p-0.5">
            <button
              onClick={() => setLayout("list")}
              className={`p-1.5 rounded-md transition-colors ${
                layout === "list" ? "bg-storefront-chip-active text-white" : "text-storefront-text2"
              }`}
              aria-label="List view"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <button
              onClick={() => setLayout("grid")}
              className={`p-1.5 rounded-md transition-colors ${
                layout === "grid" ? "bg-storefront-chip-active text-white" : "text-storefront-text2"
              }`}
              aria-label="Grid view"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
              </svg>
            </button>
          </div>
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

        {/* List view */}
        {layout === "list" && (
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
                      item.grading_company
                        ? "bg-purple-100 text-purple-800"
                        : CONDITION_COLORS[item.condition] ?? "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {item.grading_company ? `${item.grading_company} ${item.grade}` : item.condition}
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
        )}

        {/* Grid view */}
        {layout === "grid" && (
          <div className="grid grid-cols-2 gap-2">
            {filteredItems.map((item) => (
              <a
                key={item.id}
                href={cardWhatsAppUrl(item.card.name)}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-storefront-surface rounded-xl border border-storefront-border hover:border-primary-400/30 transition-colors overflow-hidden"
              >
                {item.card.image_small ? (
                  <img
                    src={item.card.image_small}
                    alt={item.card.name}
                    className="w-full aspect-[5/7] object-cover bg-storefront-input"
                  />
                ) : (
                  <div className="w-full aspect-[5/7] bg-storefront-input" />
                )}
                <div className="p-2.5">
                  <p className="text-storefront-text text-[12px] font-medium truncate">
                    {item.card.name}
                  </p>
                  <p className="text-storefront-text2 text-[10px] truncate">
                    {item.card.set_name}
                  </p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${
                        item.grading_company
                          ? "bg-purple-100 text-purple-800"
                          : CONDITION_COLORS[item.condition] ?? "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {item.grading_company ? `${item.grading_company} ${item.grade}` : item.condition}
                    </span>
                    {item.card.market_price_rm != null && (
                      <p className="text-storefront-text text-[12px] font-bold">
                        RM {item.card.market_price_rm.toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 pb-4">
          <p className="text-storefront-powered-by text-[11px]">
            Powered by KardVault
          </p>
        </div>
      </div>
    </div>
  );
}
