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
      .select("vendor_id, booth_info")
      .eq("event_id", eventId);

    if (!vendorRows || vendorRows.length === 0) return [];

    type EVRow = { vendor_id: string; booth_info: string | null };
    const evRows = vendorRows as EVRow[];
    const vendorIds = evRows.map((v) => v.vendor_id);
    const boothMap = new Map(evRows.map((v) => [v.vendor_id, v.booth_info]));

    const { data, error } = await db
      .from("inventory")
      .select(
        "card_id, vendor_id, quantity, card:cards(name, set_name, card_number, image_small, market_price_rm), vendor:vendors(display_name, slug, profile_image_url)"
      )
      .in("vendor_id", vendorIds)
      .ilike("card.name", `%${query}%`)
      .not("card", "is", null)
      .limit(50);

    if (error) return [];

    type RawRow = {
      card_id: string;
      vendor_id: string;
      quantity: number;
      card: {
        name: string;
        set_name: string;
        card_number: string;
        image_small: string | null;
        market_price_rm: number | null;
      };
      vendor: {
        display_name: string;
        slug: string;
        profile_image_url: string | null;
      };
    };

    const grouped = new Map<
      string,
      {
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
      }
    >();

    for (const row of (data ?? []) as RawRow[]) {
      if (!row.card) continue;
      const existing = grouped.get(row.card_id);
      const vendorEntry = {
        displayName: row.vendor.display_name,
        slug: row.vendor.slug,
        profileImageUrl: row.vendor.profile_image_url,
        boothInfo: boothMap.get(row.vendor_id) ?? null,
      };
      if (existing) {
        if (!existing.vendors.some((v) => v.slug === row.vendor.slug)) {
          existing.vendors.push(vendorEntry);
        }
      } else {
        grouped.set(row.card_id, {
          cardName: row.card.name,
          setName: row.card.set_name,
          cardNumber: row.card.card_number,
          imageSmall: row.card.image_small,
          marketPriceRm: row.card.market_price_rm,
          vendors: [vendorEntry],
        });
      }
    }

    return Array.from(grouped.values());
  }

  async function searchCardAcrossEvents(cardName: string) {
    const today = new Date().toISOString().slice(0, 10);

    const { data: events } = await db
      .from("events")
      .select("id, name, date, city, end_date")
      .is("deleted_at", null)
      .gte("date", today)
      .order("date", { ascending: true });

    if (!events || events.length === 0) return [];

    type EventRow = {
      id: string;
      name: string;
      date: string;
      city: string;
      end_date: string | null;
    };
    const eventRows = events as EventRow[];
    const eventIds = eventRows.map((e) => e.id);

    const { data: evVendors } = await db
      .from("event_vendors")
      .select("event_id, vendor_id")
      .in("event_id", eventIds);

    if (!evVendors || evVendors.length === 0) return [];

    type EVRow2 = { event_id: string; vendor_id: string };
    const evVendorRows = evVendors as EVRow2[];
    const allVendorIds = [...new Set(evVendorRows.map((v) => v.vendor_id))];

    const { data: invData } = await db
      .from("inventory")
      .select("vendor_id, card:cards(name)")
      .in("vendor_id", allVendorIds)
      .ilike("card.name", `%${cardName}%`)
      .not("card", "is", null);

    if (!invData) return [];

    type InvRow = { vendor_id: string; card: { name: string } };
    const vendorsWithCard = new Set(
      (invData as InvRow[]).map((r) => r.vendor_id)
    );

    const vendorsByEvent = new Map<string, number>();
    for (const ev of evVendorRows) {
      if (vendorsWithCard.has(ev.vendor_id)) {
        vendorsByEvent.set(
          ev.event_id,
          (vendorsByEvent.get(ev.event_id) ?? 0) + 1
        );
      }
    }

    return eventRows
      .filter((e) => vendorsByEvent.has(e.id))
      .map((e) => ({
        event: { id: e.id, name: e.name, date: e.date, city: e.city },
        vendorCount: vendorsByEvent.get(e.id)!,
      }));
  }

  return { createEvent, findSimilarEvents, joinEvent, leaveEvent, updateBoothInfo, flagEvent, searchCardsAtEvent, searchCardAcrossEvents };
}
