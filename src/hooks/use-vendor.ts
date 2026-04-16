"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type Vendor = Database["public"]["Tables"]["vendors"]["Row"];

export function useVendor(userId: string | undefined) {
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const fetchVendor = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("vendors")
      .select("*")
      .eq("id", userId)
      .single();

    if (!error && data) {
      setVendor(data as Vendor);
    } else {
      setVendor(null);
    }
    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => {
    fetchVendor();
  }, [fetchVendor]);

  async function createVendor(params: {
    displayName: string;
    whatsappNumber: string;
  }) {
    if (!userId) throw new Error("Not authenticated");

    // Generate a slug from display name
    const slug = params.displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      + "-" + Math.random().toString(36).slice(2, 6);

    const { data, error } = await db
      .from("vendors")
      .insert({
        id: userId,
        display_name: params.displayName,
        whatsapp_number: params.whatsappNumber,
        slug,
      })
      .select()
      .single();

    if (error) throw error;
    setVendor(data as Vendor);
    return data as Vendor;
  }

  return { vendor, loading, createVendor, refresh: fetchVendor };
}
