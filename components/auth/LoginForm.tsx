'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function AuthError({
  errorCode,
  errorDescription,
}: {
  errorCode?: string;
  errorDescription?: string;
}) {
  const messages: Record<string, string> = {
    otp_expired: 'This link has expired. Please sign in with your password instead.',
    access_denied: 'Sign-in was cancelled or could not be completed.',
  };
  const text =
    errorCode && messages[errorCode]
      ? messages[errorCode]
      : errorDescription;
  if (!text) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
    >
      {text}
    </div>
  );
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
      setError(signInError.message);
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
      </form>

      <p className="mt-8 text-center text-sm text-[var(--muted-foreground)]">
        Don&apos;t have an account?{' '}
        <Link
          href="/signup"
          className="font-medium text-[var(--brand)] underline-offset-4 transition-colors hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
