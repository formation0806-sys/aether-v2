import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * AETHER-owned email confirmation endpoint.
 *
 * The hosted Supabase "Confirm signup" email template should point its link
 * at this route:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 *
 * That keeps confirmation on our origin: a valid token is exchanged for a
 * session (persisted via the server cookie setAll fix) and the user lands on
 * /dashboard. An expired/invalid token redirects to a branded /signin error
 * state instead of exposing Supabase's raw JSON error.
 *
 * PKCE links (code + sb_flow_id) are handed off untouched to the existing
 * /auth/callback code-exchange flow.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  const code = requestUrl.searchParams.get("code");
  if (code) {
    return NextResponse.redirect(
      new URL(`/auth/callback?${requestUrl.searchParams.toString()}`, request.url)
    );
  }

  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");

  if (!tokenHash || !type) {
    const params = new URLSearchParams();
    params.set("error", "access_denied");
    params.set("error_code", "verify_failed");
    params.set(
      "error_description",
      "This confirmation link is incomplete or has already been used. Please sign in with your password instead."
    );
    return NextResponse.redirect(
      new URL(`/signin?${params.toString()}`, request.url)
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (!error) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const params = new URLSearchParams();
  params.set("error", "access_denied");
  const errorCode = error.code ?? "verify_failed";
  const errorDescription =
    errorCode === "otp_expired"
      ? "This confirmation link has expired or has already been used. Please sign in with your password instead."
      : "We could not confirm your email. Open the confirmation link in the same browser you used to sign up, or sign in with your password.";
  params.set("error_code", errorCode);
  params.set("error_description", errorDescription);
  return NextResponse.redirect(
    new URL(`/signin?${params.toString()}`, request.url)
  );
}