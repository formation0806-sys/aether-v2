'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Matches the app's lg: Tailwind breakpoint used by AppShell
// to distinguish mobile layout from desktop layout.
const MOBILE_BREAKPOINT = 1024;

export default function AuthenticatedRedirect() {
  const router = useRouter();

  useEffect(() => {
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    router.replace(isMobile ? '/chat' : '/dashboard');
  }, [router]);

  return null;
}
