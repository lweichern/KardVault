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

  async function updateVendor(params: {
    displayName?: string;
    whatsappNumber?: string;
    bio?: string | null;
    profileImageUrl?: string | null;
    bannerImageUrl?: string | null;
  }) {
    if (!userId) throw new Error("Not authenticated");

    const updates: Record<string, unknown> = {};
    if (params.displayName !== undefined) updates.display_name = params.displayName;
    if (params.whatsappNumber !== undefined) updates.whatsapp_number = params.whatsappNumber;
    if (params.bio !== undefined) updates.bio = params.bio;
    if (params.profileImageUrl !== undefined) updates.profile_image_url = params.profileImageUrl;
    if (params.bannerImageUrl !== undefined) updates.banner_image_url = params.bannerImageUrl;

    const { error } = await db
      .from("vendors")
      .update(updates)
      .eq("id", userId);

    if (error) throw error;
    await fetchVendor();
  }

  async function uploadImage(file: File, type: "profile" | "banner"): Promise<string> {
    if (!userId) throw new Error("Not authenticated");

    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${userId}/${type}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("vendor-assets")
      .upload(path, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from("vendor-assets")
      .getPublicUrl(path);

    return data.publicUrl;
  }

  return { vendor, loading, createVendor, updateVendor, uploadImage, refresh: fetchVendor };
}
