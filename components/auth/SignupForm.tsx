'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

export default function SignupForm() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const rawOrigin =
      typeof window !== 'undefined' ? window.location.origin : '';
    const canonicalOrigin = rawOrigin.replace('//127.0.0.1', '//localhost');

    const redirectTo = canonicalOrigin
      ? `${canonicalOrigin}/auth/callback`
      : '/auth/callback';

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    setLoading(false);

    if (signUpError) {
      const safe = sanitizeAuthError(signUpError.message);
      setError(
        safe ??
          "Unable to create your account right now. Please try again."
      );
      return;
    }

    router.push('/signin');
    router.refresh();
  }

  return (
    <div className="w-full">
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSignup} className="mt-6 space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="signup-email"
            className="text-sm font-medium text-[var(--foreground)]"
          >
            Email
          </label>
          <Input
            id="signup-email"
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
            htmlFor="signup-password"
            className="text-sm font-medium text-[var(--foreground)]"
          >
            Password
          </label>
          <div className="relative">
            <Input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Create a password"
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

        <Button type="submit" disabled={loading} className="w-full" size="lg">
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Creating account...
            </>
          ) : (
            'Create account'
          )}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-[var(--muted-foreground)]">
        Already have an account?{' '}
        <Link
          href="/signin"
          className="font-medium text-[var(--brand)] underline-offset-4 transition-colors hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
