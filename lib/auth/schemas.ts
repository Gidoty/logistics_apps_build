import { z } from "zod";

// Supabase hashes passwords with bcrypt, which ignores bytes after 72.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(254, "Email is too long."));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`)
  .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), {
    message: "Use at least one letter and one number.",
  });

export const fullNameSchema = z.string().trim().min(2, "Enter your full name.").max(120, "Name is too long.");

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Choose a country.");

export const signInSchema = z.object({
  email: emailSchema,
  // Do not apply strength rules at sign-in, only presence.
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX),
});

export const magicLinkSchema = z.object({
  email: emailSchema,
});

export const signUpSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  countryCode: countryCodeSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const newPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

/** Email link types Supabase can send to /auth/callback as token_hash links. */
export const emailOtpTypeSchema = z.enum([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export type SignUpInput = z.infer<typeof signUpSchema>;
