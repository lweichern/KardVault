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
