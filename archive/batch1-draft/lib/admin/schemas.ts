import { z } from "zod";
import { APP_ROLES } from "@/lib/auth/roles";

export const roleChangeSchema = z.object({
  userId: z.uuid("Invalid user."),
  role: z.enum(APP_ROLES),
  intent: z.enum(["grant", "revoke"]),
});
