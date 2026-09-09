'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function sanitizeAuthError(message: string | undefined): string | null {
  const text = typeof message === "string" ? message.trim() : "";
  if (text.length === 0) return null;
  if (
    text === "{}" ||
    text === "[]" ||
    text === "null" ||
    /^\{[\s]*\}$/.test(text) ||
    /^\[[\s]*\]$/.test(text)
  ) {
    return null;
  }
  return text;
}

export default function LoginForm({
  initialErrorCode,
  initialErrorDescription,
}: {
  initialErrorCode?: string;
  initialErrorDescription?: string;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function AuthError({
    errorCode,
    errorDescription,
  }: {
    errorCode?: string;
    errorDescription?: string;
  }) {
    const messages: Record<string, string> = {
      otp_expired: 'This link has expired or has already been used.',
      access_denied: 'Sign-in was cancelled or could not be completed.',
      exchange_failed:
        'Open the confirmation link in the same browser you used to sign up.',
      verify_failed:
        'Open the confirmation link in the same browser you used to sign up.',
    };
    const text =
      errorCode && messages[errorCode]
        ? messages[errorCode]
        : errorDescription;
    if (!text) return null;
    
    // Special handling for expired confirmation link
    if (errorCode === 'otp_expired') {
      return (
        <div className="space-y-4">
          <div
            role="alert"
            className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
          >
            {text}
          </div>
          <div className="flex flex-col sm:flex-row sm:gap-4">
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                // Redirect to signin page to allow user to request new confirmation
                router.push('/signin');
                router.refresh();
              }}
            >
              Sign in
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                // Redirect to signup to allow user to start over
                router.push('/signup');
                router.refresh();
              }}
            >
              Start over
            </Button>
          </div>
        </div>
      );
    }
    
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
      >
        {text}
      </div>
    );
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      const safe = sanitizeAuthError(signInError.message);
      setError(safe ?? "Unable to sign in right now. Please try again.");
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="w-full">
      <AuthError
        errorCode={initialErrorCode}
        errorDescription={initialErrorDescription}
      />

      <form onSubmit={handleLogin} className="mt-6 space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="signin-email"
            className="text-sm font-medium text-[var(--foreground)]"
          >
            Email
          </label>
          <Input
            id="signin-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="signin-password"
            className="text-sm font-medium text-[var(--foreground)]"
          >
            Password
          </label>
          <div className="relative">
            <Input
              id="signin-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={loading}
          className="w-full"
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Signing in...
            </>
          ) : (
            'Sign in'
          )}
        </Button>

        <p className="mt-8 text-center text-sm text-[var(--muted-foreground)]">
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            className="font-medium text-[var(--brand)] underline-offset-4 transition-colors hover:underline"
          >
            Create one
          </Link>
        </p>
      </form>
    </div>
  );
}