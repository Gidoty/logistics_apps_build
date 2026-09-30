import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type OwnVendor = Pick<
  Tables<"vendors">,
  | "id"
  | "business_name"
  | "country_code"
  | "city"
  | "status"
  | "verification_notes"
  | "created_at"
  | "phone"
  | "business_reg_number"
  | "categories"
  | "id_document_path"
>;

/** The signed-in user's vendor record, if they have applied. */
export async function getOwnVendor(userId: string): Promise<OwnVendor | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select(
      "id, business_name, country_code, city, status, verification_notes, created_at, phone, business_reg_number, categories, id_document_path",
    )
    .eq("owner_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load vendor record: ${error.message}`);
  return data;
}

export type AdminVendorRow = Pick<
  Tables<"vendors">,
  "id" | "business_name" | "country_code" | "city" | "status" | "created_at" | "categories"
> & { owner: { email: string | null; full_name: string } | null };

export const ADMIN_VENDOR_PAGE_SIZE = 50;

/** Vendors for the admin list, newest first. Admin only (row security). */
export async function listVendorsForAdmin(
  status: Tables<"vendors">["status"] | null,
): Promise<AdminVendorRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("vendors")
    .select(
      "id, business_name, country_code, city, status, created_at, categories, owner:profiles!vendors_owner_id_fkey(email, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(ADMIN_VENDOR_PAGE_SIZE);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load vendors: ${error.message}`);
  return data ?? [];
}

export type AdminVendorDetail = Pick<
  Tables<"vendors">,
  | "id"
  | "owner_id"
  | "business_name"
  | "country_code"
  | "city"
  | "status"
  | "verification_notes"
  | "created_at"
  | "updated_at"
  | "phone"
  | "business_reg_number"
  | "categories"
  | "id_document_path"
> & { owner: { email: string | null; full_name: string } | null };

export async function getVendorForAdmin(vendorId: string): Promise<AdminVendorDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select(
      "id, owner_id, business_name, country_code, city, status, verification_notes, created_at, updated_at, phone, business_reg_number, categories, id_document_path, owner:profiles!vendors_owner_id_fkey(email, full_name)",
    )
    .eq("id", vendorId)
    .maybeSingle();
  if (error) throw new Error(`Could not load vendor: ${error.message}`);
  return data;
}
