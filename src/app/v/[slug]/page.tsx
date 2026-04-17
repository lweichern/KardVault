import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { StorefrontClient } from "./storefront-client";
import type { Metadata } from "next";
import type { Database } from "@/types/database";

type Vendor = Database["public"]["Tables"]["vendors"]["Row"];
type Card = Database["public"]["Tables"]["cards"]["Row"];
type InventoryRow = Database["public"]["Tables"]["inventory"]["Row"];

export interface StorefrontItem extends InventoryRow {
  card: Card;
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: vendor } = await supabase
    .from("vendors")
    .select("display_name")
    .eq("slug", slug)
    .single<Pick<Vendor, "display_name">>();

  if (!vendor) {
    return { title: "Store Not Found | KardVault" };
  }

  return {
    title: `${vendor.display_name}'s Store | KardVault`,
    description: `Browse Pokémon TCG cards from ${vendor.display_name} on KardVault`,
    openGraph: {
      title: `${vendor.display_name}'s Store | KardVault`,
      description: `Browse Pokémon TCG cards from ${vendor.display_name}`,
      type: "website",
    },
  };
}

export default async function StorefrontPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("*")
    .eq("slug", slug)
    .single<Vendor>();

  if (vendorError || !vendor) {
    notFound();
  }

  const { data: rawItems } = await supabase
    .from("inventory")
    .select("*, card:cards(*)")
    .eq("vendor_id", vendor.id)
    .order("listed_at", { ascending: false });

  const items: StorefrontItem[] = (rawItems ?? []).map((row) => {
    const { card, ...rest } = row as Record<string, unknown>;
    return {
      ...(rest as InventoryRow),
      card: card as Card,
    };
  });

  const whatsappNumber = vendor.whatsapp_number.replace(/^\+/, "");

  return (
    <StorefrontClient
      vendor={{
        displayName: vendor.display_name,
        bio: vendor.bio,
        profileImageUrl: vendor.profile_image_url,
        bannerImageUrl: vendor.banner_image_url,
        tier: vendor.tier,
        whatsappNumber,
      }}
      items={items}
    />
  );
}
