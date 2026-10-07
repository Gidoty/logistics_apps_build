import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Recipient = Tables<"recipients">;

/** Names of the states (and FCT) in a country, for the address form. */
export async function listRegionNames(countryCode = "NG"): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("regions")
    .select("name")
    .eq("country_code", countryCode)
    .order("name");
  if (error) throw new Error(`Could not load states: ${error.message}`);
  return data.map((region) => region.name);
}

/** The signed-in buyer's recipients, newest first. Row level security limits this to their own. */
export async function listOwnRecipients(options: { includeArchived?: boolean } = {}): Promise<Recipient[]> {
  const supabase = await createClient();
  let query = supabase.from("recipients").select("*").order("created_at", { ascending: false });
  if (!options.includeArchived) query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load recipients: ${error.message}`);
  return data;
}

export async function getOwnRecipient(id: string): Promise<(Recipient & { inUse: boolean }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("recipients").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load recipient: ${error.message}`);
  if (!data) return null;
  const used = await supabase.rpc("recipient_in_use", { _recipient_id: id });
  return { ...data, inUse: used.data === true };
}
