import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/catalog/shop-queries";
import { VENDOR_DOCUMENT_BUCKET, VENDOR_DOCUMENT_LINK_SECONDS } from "@/lib/storage/vendor-documents";
import { createClient } from "@/lib/supabase/server";

const NOT_FOUND = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Sends an admin to a signed link for a vendor's ID document. The link is made
 * fresh on every request and expires after 60 seconds. The bucket is private,
 * so no other URL reaches the file. Everyone who is not an admin gets a plain
 * 404, which does not reveal that the route exists. Each view is written to
 * the audit log before the link is handed out.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/vendors/[vendorId]/document">) {
  const { vendorId } = await params;
  const user = await getSessionUser();
  if (!user || user.role !== "admin" || !isUuid(vendorId)) return NOT_FOUND();

  const supabase = await createClient();
  const { data: vendor, error } = await supabase
    .from("vendors")
    .select("id_document_path")
    .eq("id", vendorId)
    .maybeSingle();
  if (error || !vendor?.id_document_path) return NOT_FOUND();

  const { error: auditError } = await supabase.rpc("log_vendor_document_view", { _vendor_id: vendorId });
  if (auditError) return new NextResponse("Could not record this view.", { status: 500 });

  const { data, error: signError } = await supabase.storage
    .from(VENDOR_DOCUMENT_BUCKET)
    .createSignedUrl(vendor.id_document_path, VENDOR_DOCUMENT_LINK_SECONDS);
  if (signError || !data?.signedUrl) return NOT_FOUND();

  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
