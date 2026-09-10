import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  // Surface Supabase auth-link errors (e.g. otp_expired) on /signin instead
  // of bouncing silently. Kept relative so the redirect always stays on the
  // current origin — never hardcoded to 127.0.0.1 or any single host.
  const error = requestUrl.searchParams.get("error");
  if (error) {
    const params = new URLSearchParams();
    params.set("error", error);
    const errorCode = requestUrl.searchParams.get("error_code");
    const errorDescription = requestUrl.searchParams.get("error_description");
    if (errorCode) params.set("error_code", errorCode);
    if (errorDescription) params.set("error_description", errorDescription);
    return NextResponse.redirect(
      new URL(`/signin?${params.toString()}`, request.url)
    );
  }

  const code = requestUrl.searchParams.get("code");
  const flowId = requestUrl.searchParams.get("sb_flow_id");
  const tokenHash = requestUrl.searchParams.get("token_hash");

  if (code) {
    const supabase = await createClient();

    // Forward the PKCE flow id when present so the code exchange reads the
    // correct verifier slot instead of falling back to the legacy
    // "most recent flow" key, which breaks when the confirmation link opens
    // in a different browser/session (common on mobile).
    const { error } = flowId
      ? await supabase.auth.exchangeCodeForSession(code, { flowId })
      : await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        await supabase
          .from("profiles")
          .upsert(
            {
              id: user.id,
              email: user.email,
              full_name: user.user_metadata?.full_name ?? "",
              username: "",
              avatar_url: "",
            },
            {
              onConflict: "id",
            }
          );
      }

      return NextResponse.redirect(new URL("/", request.url));
    }

    // Surface a branded error on /signin instead of raw Supabase JSON.
    const params = new URLSearchParams();
    params.set("error", "access_denied");
    const errorCode = error.code ?? "exchange_failed";
    const errorDescription =
      errorCode === "otp_expired"
        ? "This confirmation link has expired or has already been used. Please sign in with your password instead."
        : "We could not complete your sign-in. Open the confirmation link in the same browser you used to sign up, or sign in with your password.";
    params.set("error_code", errorCode);
    params.set("error_description", errorDescription);
    return NextResponse.redirect(
      new URL(`/signin?${params.toString()}`, request.url)
    );
  }

  // Defensive fallback: older/non-PKCE confirmation links may deliver a
  // token_hash instead of a code. Verify it the same way the docs describe.
  if (tokenHash) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email",
    });

    if (!error) {
      return NextResponse.redirect(new URL("/", request.url));
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

  return NextResponse.redirect(new URL("/signin", request.url));
}