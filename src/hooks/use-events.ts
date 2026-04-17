"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];
type EventVendor = Database["public"]["Tables"]["event_vendors"]["Row"];
type Vendor = Database["public"]["Tables"]["vendors"]["Row"];

export const CITIES = [
  "KL",
  "PJ",
  "Penang",
  "JB",
  "Ipoh",
  "Kuching",
  "Kota Kinabalu",
  "Melaka",
] as const;

export type City = (typeof CITIES)[number];

export interface EventWithVendors extends Event {
  vendor_count: number;
  vendors: (EventVendor & { vendor: Pick<Vendor, "id" | "display_name" | "slug" | "profile_image_url"> })[];
}

export function useEvents(cityFilter?: City | null) {
  const [events, setEvents] = useState<EventWithVendors[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    let query = db
      .from("events")
      .select("*, vendors:event_vendors(*, vendor:vendors(id, display_name, slug, profile_image_url))")
      .is("deleted_at", null)
      .gte("date", new Date().toISOString().slice(0, 10))
      .order("date", { ascending: true });

    if (cityFilter) {
      query = query.eq("city", cityFilter);
    }

    const { data, error } = await query;
    if (!error && data) {
      const mapped = (data as (Event & { vendors: (EventVendor & { vendor: Pick<Vendor, "id" | "display_name" | "slug" | "profile_image_url"> })[] })[]).map((e) => ({
        ...e,
        vendor_count: e.vendors?.length ?? 0,
      }));
      setEvents(mapped);
    }
    setLoading(false);
  }, [db, cityFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, refresh: fetchEvents };
}

export function useEvent(eventId: string | null) {
  const [event, setEvent] = useState<EventWithVendors | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await db
        .from("events")
        .select("*, vendors:event_vendors(*, vendor:vendors(id, display_name, slug, profile_image_url))")
        .eq("id", eventId)
        .is("deleted_at", null)
        .single();

      if (!error && data) {
        const e = data as Event & { vendors: (EventVendor & { vendor: Pick<Vendor, "id" | "display_name" | "slug" | "profile_image_url"> })[] };
        setEvent({ ...e, vendor_count: e.vendors?.length ?? 0 });
      }
      setLoading(false);
    })();
  }, [eventId, db]);

  return { event, loading };
}

export function useEventActions() {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  async function createEvent(params: {
    name: string;
    city: City;
    venue?: string;
    date: string;
    endDate?: string;
    createdBy: string;
  }) {
    const { data, error } = await db
      .from("events")
      .insert({
        name: params.name,
        city: params.city,
        venue: params.venue || null,
        date: params.date,
        end_date: params.endDate || null,
        source: "community",
        created_by: params.createdBy,
      })
      .select()
      .single();

    if (error) throw error;
    return data as Event;
  }

  async function findSimilarEvents(name: string, city: string, date: string) {
    const { data, error } = await db.rpc("find_similar_events", {
      p_name: name,
      p_city: city,
      p_date: date,
    });
    if (error) throw error;
    return (data ?? []) as { id: string; name: string; city: string; date: string; end_date: string | null; venue: string | null; source: string; score: number }[];
  }

  async function joinEvent(eventId: string, vendorId: string, boothInfo?: string) {
    const { error } = await db.from("event_vendors").insert({
      event_id: eventId,
      vendor_id: vendorId,
      booth_info: boothInfo || null,
    });
    if (error) throw error;
  }

  async function leaveEvent(eventId: string, vendorId: string) {
    const { error } = await db
      .from("event_vendors")
      .delete()
      .eq("event_id", eventId)
      .eq("vendor_id", vendorId);
    if (error) throw error;
  }

  async function updateBoothInfo(eventId: string, vendorId: string, boothInfo: string) {
    const { error } = await db
      .from("event_vendors")
      .update({ booth_info: boothInfo || null })
      .eq("event_id", eventId)
      .eq("vendor_id", vendorId);
    if (error) throw error;
  }

  async function flagEvent(eventId: string, flaggedBy: string, reason: string) {
    const { error } = await db.from("event_flags").insert({
      event_id: eventId,
      flagged_by: flaggedBy,
      reason,
    });
    if (error) throw error;
  }

  async function searchCardsAtEvent(eventId: string, query: string) {
    const { data: vendorRows } = await db
      .from("event_vendors")
      .select("vendor_id")
      .eq("event_id", eventId);

    if (!vendorRows || vendorRows.length === 0) return [];

    const vendorIds = (vendorRows as { vendor_id: string }[]).map((v) => v.vendor_id);

    const { data, error } = await db
      .from("inventory")
      .select("card_id, vendor_id, quantity, card:cards(name, set_name, card_number, image_small), vendor:vendors(display_name, slug)")
      .in("vendor_id", vendorIds)
      .ilike("card.name", `%${query}%`)
      .not("card", "is", null)
      .limit(50);

    if (error) return [];

    type RawRow = {
      card_id: string;
      vendor_id: string;
      quantity: number;
      card: { name: string; set_name: string; card_number: string; image_small: string | null };
      vendor: { display_name: string; slug: string };
    };

    const grouped = new Map<string, {
      cardName: string;
      setName: string;
      cardNumber: string;
      imageSmall: string | null;
      vendors: { displayName: string; slug: string }[];
    }>();

    for (const row of (data ?? []) as RawRow[]) {
      if (!row.card) continue;
      const existing = grouped.get(row.card_id);
      if (existing) {
        if (!existing.vendors.some((v) => v.slug === row.vendor.slug)) {
          existing.vendors.push({ displayName: row.vendor.display_name, slug: row.vendor.slug });
        }
      } else {
        grouped.set(row.card_id, {
          cardName: row.card.name,
          setName: row.card.set_name,
          cardNumber: row.card.card_number,
          imageSmall: row.card.image_small,
          vendors: [{ displayName: row.vendor.display_name, slug: row.vendor.slug }],
        });
      }
    }

    return Array.from(grouped.values());
  }

  return { createEvent, findSimilarEvents, joinEvent, leaveEvent, updateBoothInfo, flagEvent, searchCardsAtEvent };
}
