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
      card_sets: {
        Row: {
          id: string;
          name: string;
          series: string;
          printed_total: number;
          total: number;
          ptcgo_code: string | null;
          release_date: string;
          image_symbol: string | null;
          image_logo: string | null;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          series: string;
          printed_total: number;
          total: number;
          ptcgo_code?: string | null;
          release_date: string;
          image_symbol?: string | null;
          image_logo?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          series?: string;
          printed_total?: number;
          total?: number;
          ptcgo_code?: string | null;
          release_date?: string;
          image_symbol?: string | null;
          image_logo?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      cards: {
        Row: {
          id: string;
          name: string;
          supertype: string | null;
          subtypes: string[] | null;
          hp: string | null;
          types: string[] | null;
          evolves_from: string | null;
          evolves_to: string[] | null;
          set_id: string;
          set_name: string;
          set_series: string | null;
          number: string;
          rarity: string | null;
          artist: string | null;
          attacks: Json | null;
          weaknesses: Json | null;
          resistances: Json | null;
          retreat_cost: string[] | null;
          converted_retreat_cost: number | null;
          rules: string[] | null;
          abilities: Json | null;
          flavor_text: string | null;
          image_small: string | null;
          image_large: string | null;
          national_pokedex_numbers: number[] | null;
          legality_standard: string | null;
          legality_expanded: string | null;
          legality_unlimited: string | null;
          regulation_mark: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          supertype?: string | null;
          subtypes?: string[] | null;
          hp?: string | null;
          types?: string[] | null;
          evolves_from?: string | null;
          evolves_to?: string[] | null;
          set_id: string;
          set_name: string;
          set_series?: string | null;
          number: string;
          rarity?: string | null;
          artist?: string | null;
          attacks?: Json | null;
          weaknesses?: Json | null;
          resistances?: Json | null;
          retreat_cost?: string[] | null;
          converted_retreat_cost?: number | null;
          rules?: string[] | null;
          abilities?: Json | null;
          flavor_text?: string | null;
          image_small?: string | null;
          image_large?: string | null;
          national_pokedex_numbers?: number[] | null;
          legality_standard?: string | null;
          legality_expanded?: string | null;
          legality_unlimited?: string | null;
          regulation_mark?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          supertype?: string | null;
          subtypes?: string[] | null;
          hp?: string | null;
          types?: string[] | null;
          evolves_from?: string | null;
          evolves_to?: string[] | null;
          set_id?: string;
          set_name?: string;
          set_series?: string | null;
          number?: string;
          rarity?: string | null;
          artist?: string | null;
          attacks?: Json | null;
          weaknesses?: Json | null;
          resistances?: Json | null;
          retreat_cost?: string[] | null;
          converted_retreat_cost?: number | null;
          rules?: string[] | null;
          abilities?: Json | null;
          flavor_text?: string | null;
          image_small?: string | null;
          image_large?: string | null;
          national_pokedex_numbers?: number[] | null;
          legality_standard?: string | null;
          legality_expanded?: string | null;
          legality_unlimited?: string | null;
          regulation_mark?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cards_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "card_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory: {
        Row: {
          id: string;
          vendor_id: string;
          card_id: string | null;
          manual_card_name: string | null;
          manual_card_set: string | null;
          manual_card_number: string | null;
          condition: "NM" | "LP" | "MP" | "HP" | "DMG";
          price_myr: number | null;
          quantity: number;
          photos: string[] | null;
          is_graded: boolean;
          grading_company: string | null;
          grade: string | null;
          subgrades: Json | null;
          cert_number: string | null;
          deal_method: "COD" | "SHIPPING" | "BOTH";
          cod_location: string | null;
          status: "ACTIVE" | "SOLD" | "REMOVED" | "RESERVED";
          scan_source: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          card_id?: string | null;
          manual_card_name?: string | null;
          manual_card_set?: string | null;
          manual_card_number?: string | null;
          condition?: "NM" | "LP" | "MP" | "HP" | "DMG";
          price_myr?: number | null;
          quantity?: number;
          photos?: string[] | null;
          is_graded?: boolean;
          grading_company?: string | null;
          grade?: string | null;
          subgrades?: Json | null;
          cert_number?: string | null;
          deal_method?: "COD" | "SHIPPING" | "BOTH";
          cod_location?: string | null;
          status?: "ACTIVE" | "SOLD" | "REMOVED" | "RESERVED";
          scan_source?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          card_id?: string | null;
          manual_card_name?: string | null;
          manual_card_set?: string | null;
          manual_card_number?: string | null;
          condition?: "NM" | "LP" | "MP" | "HP" | "DMG";
          price_myr?: number | null;
          quantity?: number;
          photos?: string[] | null;
          is_graded?: boolean;
          grading_company?: string | null;
          grade?: string | null;
          subgrades?: Json | null;
          cert_number?: string | null;
          deal_method?: "COD" | "SHIPPING" | "BOTH";
          cod_location?: string | null;
          status?: "ACTIVE" | "SOLD" | "REMOVED" | "RESERVED";
          scan_source?: string | null;
          created_at?: string;
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
          card_id: string | null;
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
          card_id?: string | null;
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
          card_id?: string | null;
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
      scan_logs: {
        Row: {
          id: string;
          vendor_id: string;
          scan_mode: string | null;
          vision_model: string | null;
          api_response: Json | null;
          matched_card_id: string | null;
          vendor_corrected: boolean | null;
          corrected_card_id: string | null;
          confidence: number | null;
          photo_quality_score: number | null;
          latency_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          scan_mode?: string | null;
          vision_model?: string | null;
          api_response?: Json | null;
          matched_card_id?: string | null;
          vendor_corrected?: boolean | null;
          corrected_card_id?: string | null;
          confidence?: number | null;
          photo_quality_score?: number | null;
          latency_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          scan_mode?: string | null;
          vision_model?: string | null;
          api_response?: Json | null;
          matched_card_id?: string | null;
          vendor_corrected?: boolean | null;
          corrected_card_id?: string | null;
          confidence?: number | null;
          photo_quality_score?: number | null;
          latency_ms?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scan_logs_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scan_logs_matched_card_id_fkey";
            columns: ["matched_card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scan_logs_corrected_card_id_fkey";
            columns: ["corrected_card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          id: string;
          name: string;
          city: string;
          venue: string | null;
          date: string;
          end_date: string | null;
          source: "official" | "community";
          created_by: string | null;
          flagged_count: number;
          deleted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          city: string;
          venue?: string | null;
          date: string;
          end_date?: string | null;
          source?: "official" | "community";
          created_by?: string | null;
          flagged_count?: number;
          deleted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          city?: string;
          venue?: string | null;
          date?: string;
          end_date?: string | null;
          source?: "official" | "community";
          created_by?: string | null;
          flagged_count?: number;
          deleted_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      event_vendors: {
        Row: {
          event_id: string;
          vendor_id: string;
          booth_info: string | null;
          joined_at: string;
        };
        Insert: {
          event_id: string;
          vendor_id: string;
          booth_info?: string | null;
          joined_at?: string;
        };
        Update: {
          event_id?: string;
          vendor_id?: string;
          booth_info?: string | null;
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_vendors_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_vendors_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      event_flags: {
        Row: {
          id: string;
          event_id: string;
          flagged_by: string;
          reason: string | null;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          flagged_by: string;
          reason?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          flagged_by?: string;
          reason?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_flags_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_flags_flagged_by_fkey";
            columns: ["flagged_by"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      storefront_views: {
        Row: {
          id: string;
          vendor_id: string;
          card_id: string;
          viewed_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          card_id: string;
          viewed_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          card_id?: string;
          viewed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "storefront_views_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "storefront_views_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      storefront_searches: {
        Row: {
          id: string;
          vendor_id: string;
          query: string;
          results_count: number;
          searched_at: string;
        };
        Insert: {
          id?: string;
          vendor_id: string;
          query: string;
          results_count?: number;
          searched_at?: string;
        };
        Update: {
          id?: string;
          vendor_id?: string;
          query?: string;
          results_count?: number;
          searched_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "storefront_searches_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
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
        Relationships: [];
      };
    };
    Functions: {
      search_cards: {
        Args: {
          search_query: string;
          result_limit?: number;
          result_offset?: number;
        };
        Returns: Database["public"]["Tables"]["cards"]["Row"][];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
