"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { formError, formSuccess, fromZodError, readText, type FormState } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { roleChangeSchema } from "./schemas";

const LAST_ADMIN_MESSAGE = "Cannot remove the last admin";
const UNIQUE_VIOLATION = "23505";

/** Grants or revokes one role. The database re-checks admin rights through RLS. */
export async function changeRole(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "/admin");
  const parsed = roleChangeSchema.safeParse({
    userId: readText(formData, "userId"),
    role: readText(formData, "role"),
    intent: readText(formData, "intent"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const { userId, role, intent } = parsed.data;
  const supabase = await createClient();

  if (intent === "grant") {
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    // Already has the role: nothing to do.
    if (error && error.code !== UNIQUE_VIOLATION) {
      return formError("Could not grant the role. Please try again.");
    }
    revalidatePath("/admin");
    return formSuccess("Role granted.");
  }

  const { data, error } = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role", role)
    .select("role");
  if (error) {
    if (error.message.includes(LAST_ADMIN_MESSAGE)) {
      return formError("You cannot remove the last admin. Make someone else an admin first.");
    }
    return formError("Could not revoke the role. Please try again.");
  }
  revalidatePath("/admin");
  if (data.length === 0) return formError("That user no longer has this role.");
  return formSuccess("Role revoked.");
}
