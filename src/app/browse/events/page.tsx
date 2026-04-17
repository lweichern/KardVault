"use client";

import { useState } from "react";
import Link from "next/link";
import { useEvents, CITIES, type City } from "@/hooks/use-events";

export default function EventsPage() {
  const [cityFilter, setCityFilter] = useState<City | null>(null);
  const { events, loading } = useEvents(cityFilter);

  return (
    <div className="min-h-screen bg-storefront-bg">
      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-storefront-text font-bold text-lg">Upcoming Events</h1>
          <Link
            href="/"
            className="text-storefront-text2 text-xs"
          >
            KardVault
          </Link>
        </div>

        {/* City filter */}
        <div className="flex gap-2 overflow-x-auto pb-3 mb-4 scrollbar-none">
          <button
            onClick={() => setCityFilter(null)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              !cityFilter
                ? "bg-storefront-chip-active text-white"
                : "bg-storefront-surface text-storefront-text2 border border-storefront-border"
            }`}
          >
            All cities
          </button>
          {CITIES.map((city) => (
            <button
              key={city}
              onClick={() => setCityFilter(cityFilter === city ? null : city)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                cityFilter === city
                  ? "bg-storefront-chip-active text-white"
                  : "bg-storefront-surface text-storefront-text2 border border-storefront-border"
              }`}
            >
              {city}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-storefront-text2 text-sm">Loading events...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-12">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-storefront-input mx-auto mb-3">
              <svg className="w-7 h-7 text-storefront-text2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
              </svg>
            </div>
            <p className="text-storefront-text2 text-sm">No upcoming events</p>
            {cityFilter && (
              <p className="text-storefront-text2 text-xs mt-1">
                Try a different city or <button onClick={() => setCityFilter(null)} className="underline">view all</button>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => {
              const dateStr = new Date(event.date).toLocaleDateString("en-MY", {
                weekday: "short",
                day: "numeric",
                month: "short",
              });
              const endStr = event.end_date
                ? ` – ${new Date(event.end_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}`
                : "";

              return (
                <Link
                  key={event.id}
                  href={`/browse/events/${event.id}`}
                  className="block bg-storefront-surface rounded-xl border border-storefront-border p-4 hover:border-primary-400/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-storefront-text font-semibold text-sm truncate">
                          {event.name}
                        </h2>
                        {event.source === "official" && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary-400/15 text-primary-400">
                            Official
                          </span>
                        )}
                      </div>
                      <p className="text-storefront-text2 text-xs mt-0.5">
                        {dateStr}{endStr}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <p className="text-storefront-text font-bold text-sm">
                        {event.vendor_count}
                      </p>
                      <p className="text-storefront-text2 text-[10px]">
                        {event.vendor_count === 1 ? "vendor" : "vendors"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-storefront-text2 text-xs">
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                      </svg>
                      {event.city}
                    </span>
                    {event.venue && (
                      <span className="truncate">{event.venue}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="text-center mt-8 pb-4">
          <p className="text-storefront-powered-by text-[11px]">
            Powered by KardVault
          </p>
        </div>
      </div>
    </div>
  );
}
