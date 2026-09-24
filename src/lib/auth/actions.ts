"use server";

import { redirect } from "next/navigation";
import { getSiteUrl, isGoogleAuthEnabled } from "@/lib/env";
import {
  formError,
  formSuccess,
  fromZodError,
  readText,
  type FormState,
} from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "./redirect";
import {
  forgotPasswordSchema,
  magicLinkSchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./schemas";

function callbackUrl(next: string): string {
  return `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signInWithPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: readText(formData, "email"),
    password: readText(formData, "password"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return formError("Please confirm your email first. Check your inbox for the link.");
    }
    // Same message for unknown email and wrong password, so accounts cannot be probed.
    return formError("Email or password is incorrect.");
  }

  redirect(safeRedirectPath(readText(formData, "next")));
}

export async function sendMagicLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = magicLinkSchema.safeParse({ email: readText(formData, "email") });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  // New accounts go through sign-up so we collect name and country.
  // The result is ignored on purpose: the reply must not reveal whether the email exists.
  await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: callbackUrl(safeRedirectPath(readText(formData, "next"))),
    },
  });

  return formSuccess("If an account exists for that email, we have sent a sign-in link.");
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  if (!isGoogleAuthEnabled()) redirect("/sign-in?error=google_disabled");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(safeRedirectPath(readText(formData, "next"))) },
  });
  if (error || !data.url) redirect("/sign-in?error=google_failed");

  redirect(data.url);
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    fullName: readText(formData, "fullName"),
    email: readText(formData, "email"),
    password: readText(formData, "password"),
    countryCode: readText(formData, "countryCode"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const { fullName, email, password, countryCode } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by the handle_new_user trigger, which validates both values again.
      data: { full_name: fullName, country_code: countryCode },
      emailRedirectTo: callbackUrl("/account"),
    },
  });

  if (error) {
    if (error.code === "weak_password") return formError(error.message);
    if (error.code === "over_email_send_rate_limit") {
      return formError("Too many attempts. Please wait a few minutes and try again.");
    }
    return formError("We could not create your account. Please try again.");
  }

  // With email confirmation on there is no session yet.
  if (!data.session) redirect(`/check-email?email=${encodeURIComponent(email)}`);
  redirect("/account");
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: readText(formData, "email") });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callbackUrl("/account/password"),
  });

  return formSuccess("If an account exists for that email, we have sent a reset link.");
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse({
    password: readText(formData, "password"),
    confirmPassword: readText(formData, "confirmPassword"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return formError("Choose a password you have not used here before.");
    if (error.code === "reauthentication_needed") {
      return formError("For security, sign in again or use a fresh reset link, then change your password.");
    }
    return formError("We could not update your password. Please try again.");
  }

  return formSuccess("Your password has been updated.");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
