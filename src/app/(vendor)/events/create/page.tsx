"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useVendor } from "@/hooks/use-vendor";
import { useEventActions, CITIES, type City } from "@/hooks/use-events";

export default function CreateEventPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { vendor } = useVendor(user?.id);
  const { createEvent, findSimilarEvents, joinEvent } = useEventActions();

  const [name, setName] = useState("");
  const [city, setCity] = useState<City>("KL");
  const [venue, setVenue] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [duplicates, setDuplicates] = useState<{
    id: string;
    name: string;
    city: string;
    date: string;
    venue: string | null;
    score: number;
  }[] | null>(null);

  const canSubmit = name.trim() && date && vendor;

  const handleSubmit = async () => {
    if (!canSubmit || !vendor) return;
    setSubmitting(true);
    setError(null);

    try {
      // Check for duplicates first
      if (!duplicates) {
        const similar = await findSimilarEvents(name.trim(), city, date);
        if (similar.length > 0) {
          setDuplicates(similar);
          setSubmitting(false);
          return;
        }
      }

      // No duplicates or user confirmed creation
      const event = await createEvent({
        name: name.trim(),
        city,
        venue: venue.trim() || undefined,
        date,
        endDate: endDate || undefined,
        createdBy: vendor.id,
      });

      // Auto-join the event
      await joinEvent(event.id, vendor.id);
      router.push("/events");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinExisting = async (eventId: string) => {
    if (!vendor) return;
    setSubmitting(true);
    try {
      await joinEvent(eventId, vendor.id);
      router.push("/events");
    } catch {
      setError("Failed to join event.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/events" className="text-text-secondary">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">Create Event</h1>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-text-secondary text-xs mb-1.5 block">Event name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setDuplicates(null); }}
            placeholder="e.g. Comic Fiesta 2026"
            className="w-full bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-4 py-2.5 text-sm border border-border-default focus:border-border-focus focus:outline-none"
          />
        </div>

        <div>
          <label className="text-text-secondary text-xs mb-1.5 block">City</label>
          <select
            value={city}
            onChange={(e) => { setCity(e.target.value as City); setDuplicates(null); }}
            className="w-full bg-bg-surface-2 text-text-primary rounded-xl px-4 py-2.5 text-sm border border-border-default focus:border-border-focus focus:outline-none"
          >
            {CITIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-text-secondary text-xs mb-1.5 block">Venue (optional)</label>
          <input
            type="text"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="e.g. KLCC Convention Centre"
            className="w-full bg-bg-surface-2 text-text-primary placeholder:text-text-muted rounded-xl px-4 py-2.5 text-sm border border-border-default focus:border-border-focus focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-text-secondary text-xs mb-1.5 block">Start date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setDuplicates(null); }}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full bg-bg-surface-2 text-text-primary rounded-xl px-4 py-2.5 text-sm border border-border-default focus:border-border-focus focus:outline-none"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs mb-1.5 block">End date (optional)</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={date || new Date().toISOString().slice(0, 10)}
              className="w-full bg-bg-surface-2 text-text-primary rounded-xl px-4 py-2.5 text-sm border border-border-default focus:border-border-focus focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Duplicate detection */}
      {duplicates && duplicates.length > 0 && (
        <div className="mt-6">
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
            <p className="text-warning text-sm font-medium mb-3">Similar events found</p>
            <div className="space-y-2">
              {duplicates.map((d) => (
                <div key={d.id} className="flex items-center justify-between bg-bg-surface rounded-lg p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-text-primary text-sm font-medium truncate">{d.name}</p>
                    <p className="text-text-secondary text-xs">
                      {new Date(d.date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })} · {d.city}
                      {d.venue ? ` · ${d.venue}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => handleJoinExisting(d.id)}
                    disabled={submitting}
                    className="ml-3 flex-shrink-0 px-3 py-1.5 bg-success text-white text-xs font-medium rounded-lg disabled:opacity-40"
                  >
                    Join this
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="mt-3 w-full py-2.5 border border-border-default text-text-secondary text-sm font-medium rounded-xl disabled:opacity-40"
            >
              {submitting ? "Creating..." : "Create anyway"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!duplicates && (
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="mt-6 w-full py-3 bg-primary-400 text-text-on-primary font-medium text-sm rounded-xl disabled:opacity-40"
        >
          {submitting ? "Checking..." : "Create event"}
        </button>
      )}
    </div>
  );
}
