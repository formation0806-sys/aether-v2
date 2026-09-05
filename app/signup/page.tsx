import Link from "next/link";
import SignupForm from "@/components/auth/SignupForm";
import { ArrowLeft } from "lucide-react";

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          <ArrowLeft size={16} />
          Back
        </Link>
        <Link
          href="/"
          className="flex items-center gap-2"
        >
          <svg
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="size-7"
            aria-hidden
          >
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" />
            <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.9" />
            <circle cx="16" cy="16" r="3" fill="currentColor" />
          </svg>
          <span className="text-sm font-semibold tracking-[0.18em] text-[var(--foreground)]">
            AETHER
          </span>
        </Link>
        <div className="w-16" />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
              Create your workspace
            </h1>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Start building a persistent AI memory
            </p>
          </div>

          <SignupForm />
        </div>
      </div>
    </main>
  );
}
