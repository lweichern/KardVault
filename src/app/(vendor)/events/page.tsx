"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { useEvents, useEventActions, CITIES, type City, type EventWithVendors } from "@/hooks/use-events";
import { createClient } from "@/lib/supabase";

export default function VendorEventsPage() {
  const { user } = useAuth();
  const { vendor } = useVendor(user?.id);
  const [cityFilter, setCityFilter] = useState<City | null>(null);
  const { events, loading, refresh } = useEvents(cityFilter);
  const { joinEvent, leaveEvent } = useEventActions();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [boothInput, setBoothInput] = useState("");
  const [showBoothFor, setShowBoothFor] = useState<string | null>(null);
  const [myEventIds, setMyEventIds] = useState<Set<string>>(new Set());

  const supabase = createClient();

  const fetchMyEvents = useCallback(async () => {
    if (!vendor) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("event_vendors")
      .select("event_id")
      .eq("vendor_id", vendor.id);
    if (data) {
      setMyEventIds(new Set((data as { event_id: string }[]).map((r) => r.event_id)));
    }
  }, [vendor, supabase]);

  useEffect(() => {
    fetchMyEvents();
  }, [fetchMyEvents]);

  const handleJoin = async (eventId: string) => {
    if (!vendor) return;
    setJoiningId(eventId);
    try {
      await joinEvent(eventId, vendor.id, boothInput || undefined);
      setBoothInput("");
      setShowBoothFor(null);
      await fetchMyEvents();
      await refresh();
    } catch {
      // already joined or error
    } finally {
      setJoiningId(null);
    }
  };

  const handleLeave = async (eventId: string) => {
    if (!vendor) return;
    setJoiningId(eventId);
    try {
      await leaveEvent(eventId, vendor.id);
      await fetchMyEvents();
      await refresh();
    } catch {
      // error
    } finally {
      setJoiningId(null);
    }
  };

  const myEvents = events.filter((e) => myEventIds.has(e.id));
  const otherEvents = events.filter((e) => !myEventIds.has(e.id));

  return (
    <div className="px-4 pt-6 pb-24">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">
            <span className="text-text-primary">Kard</span>
            <span className="text-primary-400">Vault</span>
          </h1>
          <p className="text-text-secondary text-sm mt-1">Events</p>
        </div>
        <Link
          href="/events/create"
          className="flex items-center gap-1.5 px-3 py-2 bg-primary-400 text-text-on-primary text-xs font-medium rounded-xl"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Create
        </Link>
      </header>

      {/* City filter */}
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4 -mx-4 px-4 scrollbar-hide">
        <button
          onClick={() => setCityFilter(null)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            !cityFilter
              ? "bg-primary-400 text-text-on-primary"
              : "bg-bg-surface text-text-secondary border border-border-default"
          }`}
        >
          All
        </button>
        {CITIES.map((city) => (
          <button
            key={city}
            onClick={() => setCityFilter(cityFilter === city ? null : city)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              cityFilter === city
                ? "bg-primary-400 text-text-on-primary"
                : "bg-bg-surface text-text-secondary border border-border-default"
            }`}
          >
            {city}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-text-muted text-sm text-center py-12">Loading events...</p>
      ) : (
        <>
          {/* My events */}
          {myEvents.length > 0 && (
            <div className="mb-6">
              <h2 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-2">
                My Events
              </h2>
              <div className="space-y-2">
                {myEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    joined
                    joiningId={joiningId}
                    onLeave={() => handleLeave(event.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Other events */}
          <div>
            <h2 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-2">
              {myEvents.length > 0 ? "Other Events" : "Upcoming Events"}
            </h2>
            {otherEvents.length === 0 ? (
              <div className="bg-bg-surface rounded-xl p-4 text-center">
                <p className="text-text-muted text-sm py-6">
                  {events.length === 0 ? "No upcoming events." : "You've joined all upcoming events!"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {otherEvents.map((event) => (
                  <div key={event.id}>
                    <EventCard
                      event={event}
                      joined={false}
                      joiningId={joiningId}
                      onJoin={() => {
                        if (showBoothFor === event.id) {
                          handleJoin(event.id);
                        } else {
                          setShowBoothFor(event.id);
                        }
                      }}
                    />
                    {showBoothFor === event.id && (
                      <div className="mt-1 ml-4 flex gap-2">
                        <input
                          type="text"
                          value={boothInput}
                          onChange={(e) => setBoothInput(e.target.value)}
                          placeholder="Booth info (optional)"
                          className="flex-1 bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-lg px-3 py-2 text-xs border border-border-default focus:border-border-focus focus:outline-none"
                        />
                        <button
                          onClick={() => handleJoin(event.id)}
                          disabled={joiningId === event.id}
                          className="px-3 py-2 bg-success text-white text-xs font-medium rounded-lg disabled:opacity-40"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => { setShowBoothFor(null); setBoothInput(""); }}
                          className="px-3 py-2 text-text-muted text-xs rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EventCard({
  event,
  joined,
  joiningId,
  onJoin,
  onLeave,
}: {
  event: EventWithVendors;
  joined: boolean;
  joiningId: string | null;
  onJoin?: () => void;
  onLeave?: () => void;
}) {
  const dateStr = new Date(event.date).toLocaleDateString("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const endStr = event.end_date
    ? ` – ${new Date(event.end_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}`
    : "";

  return (
    <div className={`bg-bg-surface rounded-xl p-3 border ${joined ? "border-success/30" : "border-border-default"}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-text-primary text-sm font-medium truncate">{event.name}</h3>
            {event.source === "official" && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary-400/15 text-primary-400">
                Official
              </span>
            )}
          </div>
          <p className="text-text-secondary text-xs mt-0.5">
            {dateStr}{endStr} · {event.city}
          </p>
          {event.venue && (
            <p className="text-text-muted text-xs truncate">{event.venue}</p>
          )}
          <p className="text-text-muted text-[10px] mt-1">
            {event.vendor_count} {event.vendor_count === 1 ? "vendor" : "vendors"}
          </p>
        </div>
        <div className="flex-shrink-0 ml-3">
          {joined ? (
            <button
              onClick={onLeave}
              disabled={joiningId === event.id}
              className="px-3 py-1.5 border border-danger/30 text-danger text-xs font-medium rounded-lg disabled:opacity-40"
            >
              Leave
            </button>
          ) : (
            <button
              onClick={onJoin}
              disabled={joiningId === event.id}
              className="px-3 py-1.5 bg-success text-white text-xs font-medium rounded-lg disabled:opacity-40"
            >
              {joiningId === event.id ? "..." : "I'm going"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
