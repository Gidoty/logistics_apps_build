import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type OwnVendor = Pick<
  Tables<"vendors">,
  "id" | "business_name" | "country_code" | "city" | "status" | "verification_notes" | "created_at"
>;

/** The signed-in user's vendor record, if they have applied. */
export async function getOwnVendor(userId: string): Promise<OwnVendor | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("id, business_name, country_code, city, status, verification_notes, created_at")
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load vendor record: ${error.message}`);
  return data;
}
