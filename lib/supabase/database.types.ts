/**
 * Database types in the format produced by `supabase gen types typescript`.
 * Generated from supabase/migrations for Batch 1 without the Supabase CLI.
 * Regenerate with `npm run db:types` once the local Supabase stack runs,
 * and commit the result. Do not edit by hand.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13";
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: Json;
          entity_id: string | null;
          entity_type: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      corridors: {
        Row: {
          active: boolean;
          created_at: string;
          default_transit_days_max: number | null;
          default_transit_days_min: number | null;
          destination_country: string;
          id: string;
          name: string;
          origin_country: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          default_transit_days_max?: number | null;
          default_transit_days_min?: number | null;
          destination_country: string;
          id?: string;
          name: string;
          origin_country: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          default_transit_days_max?: number | null;
          default_transit_days_min?: number | null;
          destination_country?: string;
          id?: string;
          name?: string;
          origin_country?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "corridors_destination_country_fkey";
            columns: ["destination_country"];
            isOneToOne: false;
            referencedRelation: "countries";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "corridors_origin_country_fkey";
            columns: ["origin_country"];
            isOneToOne: false;
            referencedRelation: "countries";
            referencedColumns: ["code"];
          },
        ];
      };
      countries: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          currency_code: string;
          id: string;
          name: string;
          phone_prefix: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          currency_code: string;
          id?: string;
          name: string;
          phone_prefix: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          currency_code?: string;
          id?: string;
          name?: string;
          phone_prefix?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "countries_currency_code_fkey";
            columns: ["currency_code"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
        ];
      };
      currencies: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          minor_unit_digits: number;
          name: string;
          symbol: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          minor_unit_digits: number;
          name: string;
          symbol: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          id?: string;
          minor_unit_digits?: number;
          name?: string;
          symbol?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      disputes: {
        Row: {
          created_at: string;
          id: string;
          order_id: string;
          raised_by: string;
          reason: string;
          resolution_note: string | null;
          status: Database["public"]["Enums"]["dispute_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          order_id: string;
          raised_by?: string;
          reason: string;
          resolution_note?: string | null;
          status?: Database["public"]["Enums"]["dispute_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          order_id?: string;
          raised_by?: string;
          reason?: string;
          resolution_note?: string | null;
          status?: Database["public"]["Enums"]["dispute_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "disputes_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "disputes_raised_by_fkey";
            columns: ["raised_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_rules: {
        Row: {
          active: boolean;
          amount_minor: number | null;
          calc_method: string;
          corridor_id: string;
          created_at: string;
          currency: string;
          fee_type: string;
          id: string;
          min_amount_minor: number | null;
          percent: number | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          amount_minor?: number | null;
          calc_method: string;
          corridor_id: string;
          created_at?: string;
          currency: string;
          fee_type: string;
          id?: string;
          min_amount_minor?: number | null;
          percent?: number | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          amount_minor?: number | null;
          calc_method?: string;
          corridor_id?: string;
          created_at?: string;
          currency?: string;
          fee_type?: string;
          id?: string;
          min_amount_minor?: number | null;
          percent?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_rules_corridor_id_fkey";
            columns: ["corridor_id"];
            isOneToOne: false;
            referencedRelation: "corridors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_rules_currency_fkey";
            columns: ["currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
        ];
      };
      fx_rates: {
        Row: {
          base_currency: string;
          created_at: string;
          fetched_at: string;
          id: string;
          is_override: boolean;
          quote_currency: string;
          rate: number;
          source: string;
          updated_at: string;
        };
        Insert: {
          base_currency: string;
          created_at?: string;
          fetched_at?: string;
          id?: string;
          is_override?: boolean;
          quote_currency: string;
          rate: number;
          source: string;
          updated_at?: string;
        };
        Update: {
          base_currency?: string;
          created_at?: string;
          fetched_at?: string;
          id?: string;
          is_override?: boolean;
          quote_currency?: string;
          rate?: number;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fx_rates_base_currency_fkey";
            columns: ["base_currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "fx_rates_quote_currency_fkey";
            columns: ["quote_currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
        ];
      };
      inspection_media: {
        Row: {
          created_at: string;
          id: string;
          inspection_id: string;
          media_type: string;
          storage_path: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          inspection_id: string;
          media_type: string;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          inspection_id?: string;
          media_type?: string;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inspection_media_inspection_id_fkey";
            columns: ["inspection_id"];
            isOneToOne: false;
            referencedRelation: "inspections";
            referencedColumns: ["id"];
          },
        ];
      };
      inspections: {
        Row: {
          buyer_decision: string | null;
          created_at: string;
          decided_at: string | null;
          id: string;
          notes: string | null;
          order_id: string;
          serial_or_imei: string | null;
          submitted_by: string;
          updated_at: string;
        };
        Insert: {
          buyer_decision?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          notes?: string | null;
          order_id: string;
          serial_or_imei?: string | null;
          submitted_by: string;
          updated_at?: string;
        };
        Update: {
          buyer_decision?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          notes?: string | null;
          order_id?: string;
          serial_or_imei?: string | null;
          submitted_by?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inspections_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inspections_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_entries: {
        Row: {
          amount_minor: number;
          created_at: string;
          created_by: string | null;
          currency: string;
          entry_type: Database["public"]["Enums"]["ledger_entry_type"];
          id: string;
          note: string | null;
          order_id: string;
          payment_id: string | null;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          created_at?: string;
          created_by?: string | null;
          currency: string;
          entry_type: Database["public"]["Enums"]["ledger_entry_type"];
          id?: string;
          note?: string | null;
          order_id: string;
          payment_id?: string | null;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          entry_type?: Database["public"]["Enums"]["ledger_entry_type"];
          id?: string;
          note?: string | null;
          order_id?: string;
          payment_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_entries_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_currency_fkey";
            columns: ["currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "ledger_entries_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          channel: string;
          created_at: string;
          id: string;
          payload: Json;
          recipient_id: string | null;
          sent_at: string | null;
          status: string;
          template: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          channel: string;
          created_at?: string;
          id?: string;
          payload?: Json;
          recipient_id?: string | null;
          sent_at?: string | null;
          status?: string;
          template: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          channel?: string;
          created_at?: string;
          id?: string;
          payload?: Json;
          recipient_id?: string | null;
          sent_at?: string | null;
          status?: string;
          template?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "recipients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          created_at: string;
          currency: string;
          description: string;
          id: string;
          order_id: string;
          product_id: string | null;
          quantity: number;
          unit_price_minor: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency: string;
          description: string;
          id?: string;
          order_id: string;
          product_id?: string | null;
          quantity: number;
          unit_price_minor: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          description?: string;
          id?: string;
          order_id?: string;
          product_id?: string | null;
          quantity?: number;
          unit_price_minor?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_currency_fkey";
            columns: ["currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          buyer_currency: string;
          buyer_id: string;
          corridor_id: string | null;
          created_at: string;
          delivery_code_hash: string | null;
          id: string;
          link_preview_json: Json | null;
          order_type: Database["public"]["Enums"]["order_type"];
          public_tracking_token: string;
          recipient_id: string | null;
          source_url: string | null;
          status: Database["public"]["Enums"]["order_status"];
          updated_at: string;
          vendor_id: string | null;
        };
        Insert: {
          buyer_currency: string;
          buyer_id?: string;
          corridor_id?: string | null;
          created_at?: string;
          delivery_code_hash?: string | null;
          id?: string;
          link_preview_json?: Json | null;
          order_type: Database["public"]["Enums"]["order_type"];
          public_tracking_token?: string;
          recipient_id?: string | null;
          source_url?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          updated_at?: string;
          vendor_id?: string | null;
        };
        Update: {
          buyer_currency?: string;
          buyer_id?: string;
          corridor_id?: string | null;
          created_at?: string;
          delivery_code_hash?: string | null;
          id?: string;
          link_preview_json?: Json | null;
          order_type?: Database["public"]["Enums"]["order_type"];
          public_tracking_token?: string;
          recipient_id?: string | null;
          source_url?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          updated_at?: string;
          vendor_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_buyer_currency_fkey";
            columns: ["buyer_currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "orders_buyer_id_fkey";
            columns: ["buyer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_corridor_id_fkey";
            columns: ["corridor_id"];
            isOneToOne: false;
            referencedRelation: "corridors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "recipients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount_minor: number;
          created_at: string;
          currency: string;
          id: string;
          order_id: string;
          provider: string;
          provider_reference: string;
          raw_payload: Json;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          created_at?: string;
          currency: string;
          id?: string;
          order_id: string;
          provider: string;
          provider_reference: string;
          raw_payload?: Json;
          status: string;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          order_id?: string;
          provider?: string;
          provider_reference?: string;
          raw_payload?: Json;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_currency_fkey";
            columns: ["currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      product_images: {
        Row: {
          created_at: string;
          id: string;
          product_id: string;
          sort_order: number;
          storage_path: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id: string;
          sort_order?: number;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string;
          sort_order?: number;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          active: boolean;
          brand: string | null;
          category: string;
          condition: string;
          created_at: string;
          currency: string;
          description: string;
          id: string;
          price_minor: number;
          stock: number;
          title: string;
          updated_at: string;
          vendor_id: string;
          weight_grams: number | null;
        };
        Insert: {
          active?: boolean;
          brand?: string | null;
          category: string;
          condition?: string;
          created_at?: string;
          currency: string;
          description?: string;
          id?: string;
          price_minor: number;
          stock?: number;
          title: string;
          updated_at?: string;
          vendor_id: string;
          weight_grams?: number | null;
        };
        Update: {
          active?: boolean;
          brand?: string | null;
          category?: string;
          condition?: string;
          created_at?: string;
          currency?: string;
          description?: string;
          id?: string;
          price_minor?: number;
          stock?: number;
          title?: string;
          updated_at?: string;
          vendor_id?: string;
          weight_grams?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_currency_fkey";
            columns: ["currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "products_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          country_code: string | null;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          phone: string | null;
          preferred_currency: string;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        Insert: {
          country_code?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id: string;
          phone?: string | null;
          preferred_currency?: string;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          country_code?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          phone?: string | null;
          preferred_currency?: string;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_country_code_fkey";
            columns: ["country_code"];
            isOneToOne: false;
            referencedRelation: "countries";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_preferred_currency_fkey";
            columns: ["preferred_currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
        ];
      };
      quote_lines: {
        Row: {
          amount_minor: number;
          created_at: string;
          currency: string;
          id: string;
          label: string;
          line_type: string;
          quote_id: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          created_at?: string;
          currency: string;
          id?: string;
          label: string;
          line_type: string;
          quote_id: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          label?: string;
          line_type?: string;
          quote_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_lines_currency_fkey";
            columns: ["currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "quote_lines_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          currency: string;
          expires_at: string;
          fx_rate_used: number | null;
          id: string;
          order_id: string;
          prepared_by: string;
          total_minor: number;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          currency: string;
          expires_at: string;
          fx_rate_used?: number | null;
          id?: string;
          order_id: string;
          prepared_by: string;
          total_minor: number;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          currency?: string;
          expires_at?: string;
          fx_rate_used?: number | null;
          id?: string;
          order_id?: string;
          prepared_by?: string;
          total_minor?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_currency_fkey";
            columns: ["currency"];
            isOneToOne: false;
            referencedRelation: "currencies";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "quotes_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_prepared_by_fkey";
            columns: ["prepared_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      recipients: {
        Row: {
          address_line: string;
          city: string;
          country_code: string;
          created_at: string;
          created_by: string;
          email: string | null;
          full_name: string;
          id: string;
          landmark: string | null;
          phone: string;
          state: string;
          updated_at: string;
        };
        Insert: {
          address_line: string;
          city: string;
          country_code?: string;
          created_at?: string;
          created_by?: string;
          email?: string | null;
          full_name: string;
          id?: string;
          landmark?: string | null;
          phone: string;
          state: string;
          updated_at?: string;
        };
        Update: {
          address_line?: string;
          city?: string;
          country_code?: string;
          created_at?: string;
          created_by?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          landmark?: string | null;
          phone?: string;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recipients_country_code_fkey";
            columns: ["country_code"];
            isOneToOne: false;
            referencedRelation: "countries";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "recipients_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shipment_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          location: string | null;
          note: string | null;
          occurred_at: string;
          shipment_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          location?: string | null;
          note?: string | null;
          occurred_at?: string;
          shipment_id: string;
          status: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          location?: string | null;
          note?: string | null;
          occurred_at?: string;
          shipment_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shipment_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shipment_events_shipment_id_fkey";
            columns: ["shipment_id"];
            isOneToOne: false;
            referencedRelation: "shipments";
            referencedColumns: ["id"];
          },
        ];
      };
      shipment_orders: {
        Row: {
          created_at: string;
          id: string;
          order_id: string;
          shipment_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          order_id: string;
          shipment_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          order_id?: string;
          shipment_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shipment_orders_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shipment_orders_shipment_id_fkey";
            columns: ["shipment_id"];
            isOneToOne: false;
            referencedRelation: "shipments";
            referencedColumns: ["id"];
          },
        ];
      };
      shipments: {
        Row: {
          adapter: string;
          created_at: string;
          destination_country: string;
          id: string;
          logistics_partner: string;
          origin_country: string;
          status: string;
          tracking_number: string | null;
          updated_at: string;
        };
        Insert: {
          adapter?: string;
          created_at?: string;
          destination_country: string;
          id?: string;
          logistics_partner: string;
          origin_country: string;
          status?: string;
          tracking_number?: string | null;
          updated_at?: string;
        };
        Update: {
          adapter?: string;
          created_at?: string;
          destination_country?: string;
          id?: string;
          logistics_partner?: string;
          origin_country?: string;
          status?: string;
          tracking_number?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shipments_destination_country_fkey";
            columns: ["destination_country"];
            isOneToOne: false;
            referencedRelation: "countries";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "shipments_origin_country_fkey";
            columns: ["origin_country"];
            isOneToOne: false;
            referencedRelation: "countries";
            referencedColumns: ["code"];
          },
        ];
      };
      vendors: {
        Row: {
          business_name: string;
          city: string;
          country_code: string;
          created_at: string;
          id: string;
          owner_id: string;
          payout_details_json: Json;
          status: Database["public"]["Enums"]["vendor_status"];
          updated_at: string;
          verification_notes: string | null;
        };
        Insert: {
          business_name: string;
          city: string;
          country_code: string;
          created_at?: string;
          id?: string;
          owner_id: string;
          payout_details_json?: Json;
          status?: Database["public"]["Enums"]["vendor_status"];
          updated_at?: string;
          verification_notes?: string | null;
        };
        Update: {
          business_name?: string;
          city?: string;
          country_code?: string;
          created_at?: string;
          id?: string;
          owner_id?: string;
          payout_details_json?: Json;
          status?: Database["public"]["Enums"]["vendor_status"];
          updated_at?: string;
          verification_notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "vendors_country_code_fkey";
            columns: ["country_code"];
            isOneToOne: false;
            referencedRelation: "countries";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "vendors_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      vendor_directory: {
        Row: {
          business_name: string | null;
          country_code: string | null;
          id: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      approve_vendor: {
        Args: {
          _vendor_id: string;
        };
        Returns: undefined;
      };
      current_user_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      current_vendor_id: {
        Args: never;
        Returns: string;
      };
      is_admin: {
        Args: never;
        Returns: boolean;
      };
      is_approved_vendor: {
        Args: {
          _vendor_id: string;
        };
        Returns: boolean;
      };
      is_privileged_session: {
        Args: never;
        Returns: boolean;
      };
      suspend_vendor: {
        Args: {
          _vendor_id: string;
          _note?: string;
        };
        Returns: undefined;
      };
      write_audit: {
        Args: {
          _action: string;
          _entity_type: string;
          _entity_id: string;
          _details?: Json;
        };
        Returns: undefined;
      };
    };
    Enums: {
      dispute_status: "open" | "under_review" | "resolved_buyer" | "resolved_vendor" | "closed";
      ledger_entry_type: "payment_received" | "held" | "released_to_vendor" | "refunded_to_buyer" | "platform_fee" | "adjustment";
      order_status: "draft" | "quote_requested" | "quoted" | "quote_expired" | "awaiting_payment" | "paid" | "purchased" | "inspection_pending" | "inspection_approved" | "shipped" | "in_transit" | "arrived_destination" | "customs_cleared" | "out_for_delivery" | "delivered" | "disputed" | "refunded" | "cancelled";
      order_type: "catalog" | "link";
      user_role: "buyer" | "vendor" | "admin";
      vendor_status: "pending" | "approved" | "suspended";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

export const Constants = {
  public: {
    Enums: {
      dispute_status: ["open", "under_review", "resolved_buyer", "resolved_vendor", "closed"],
      ledger_entry_type: ["payment_received", "held", "released_to_vendor", "refunded_to_buyer", "platform_fee", "adjustment"],
      order_status: ["draft", "quote_requested", "quoted", "quote_expired", "awaiting_payment", "paid", "purchased", "inspection_pending", "inspection_approved", "shipped", "in_transit", "arrived_destination", "customs_cleared", "out_for_delivery", "delivered", "disputed", "refunded", "cancelled"],
      order_type: ["catalog", "link"],
      user_role: ["buyer", "vendor", "admin"],
      vendor_status: ["pending", "approved", "suspended"],
    },
  },
} as const;
