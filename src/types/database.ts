export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      vendors: {
        Row: {
          id: string;
          display_name: string;
          whatsapp_number: string;
          profile_image_url: string | null;
          banner_image_url: string | null;
          bio: string | null;
          slug: string;
          tier: "free" | "pro";
          tier_expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          whatsapp_number: string;
          profile_image_url?: string | null;
          banner_image_url?: string | null;
          bio?: string | null;
          slug: string;
          tier?: "free" | "pro";
          tier_expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          whatsapp_number?: string;
          profile_image_url?: string | null;
          banner_image_url?: string | null;
          bio?: string | null;
          slug?: string;
          tier?: "free" | "pro";
          tier_expires_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      cards: {
        Row: {
          id: string;
          name: string;
          set_id: string;
          set_name: string;
          card_number: string;
          rarity: string | null;
          image_small: string | null;
          image_large: string | null;
          supertype: string | null;
          subtypes: string[] | null;
          tcgplayer_market_price: number | null;
          market_price_rm: number | null;
          price_updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          set_id: string;
          set_name: string;
          card_number: string;
          rarity?: string | null;
          image_small?: string | null;
          image_large?: string | null;
          supertype?: string | null;
          subtypes?: string[] | null;
          tcgplayer_market_price?: number | null;
          market_price_rm?: number | null;
          price_updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          set_id?: string;
          set_name?: string;
          card_number?: string;
          rarity?: string | null;
          image_small?: string | null;
          image_large?: string | null;
          supertype?: string | null;
          subtypes?: string[] | null;
          tcgplayer_market_price?: number | null;
          market_price_rm?: number | null;
          price_updated_at?: string;
        };
        Relationships: [];
      };
      inventory: {
        Row: {
          id: string;
          vendor_id: string;
          card_id: string;
          condition: "NM" | "LP" | "MP" | "HP" | "DMG";
          quantity: number;
          buy_price_rm: number | null;
          sell_price_rm: number;
          condition_photo_url: string | null;
          grading_company: string | null;
          grade: string | null;
          listed_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          card_id: string;
          condition?: "NM" | "LP" | "MP" | "HP" | "DMG";
          quantity?: number;
          buy_price_rm?: number | null;
          sell_price_rm: number;
          condition_photo_url?: string | null;
          grading_company?: string | null;
          grade?: string | null;
          listed_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          card_id?: string;
          condition?: "NM" | "LP" | "MP" | "HP" | "DMG";
          quantity?: number;
          buy_price_rm?: number | null;
          sell_price_rm?: number;
          condition_photo_url?: string | null;
          grading_company?: string | null;
          grade?: string | null;
          listed_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      transactions: {
        Row: {
          id: string;
          vendor_id: string;
          card_id: string;
          type: "buy" | "sell";
          quantity: number;
          price_rm: number;
          market_price_at_time: number | null;
          condition: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          card_id: string;
          type: "buy" | "sell";
          quantity?: number;
          price_rm: number;
          market_price_at_time?: number | null;
          condition: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          card_id?: string;
          type?: "buy" | "sell";
          quantity?: number;
          price_rm?: number;
          market_price_at_time?: number | null;
          condition?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transactions_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      public_vendors: {
        Row: {
          id: string;
          display_name: string;
          slug: string;
          profile_image_url: string | null;
          banner_image_url: string | null;
          bio: string | null;
        };
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
