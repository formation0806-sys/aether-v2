import Link from "next/link";

/**
 * Minimal premium footer — existing routes only, no fake socials.
 * SALPA wordmark stands alone (no circular mark).
 */
export default function HomeFooter() {
  return (
    <footer className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
      <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold tracking-[0.18em] text-white">
            SALPA
          </span>
          <span className="ml-2 text-xs text-[#94a3b8]">
            Persistent personal AI
          </span>
        </div>

        <nav aria-label="Footer" className="flex items-center gap-6 text-sm text-[#94a3b8]">
          <Link href="/signin" className="transition-colors duration-150 hover:text-white">
            Sign in
          </Link>
          <Link href="/signup" className="transition-colors duration-150 hover:text-white">
            Get started
          </Link>
        </nav>
      </div>
      <p className="mt-8 text-xs leading-relaxed text-[#94a3b8]">
        Salpa remembers your context across conversations — so you never start from zero.
      </p>
    </footer>
  );
}
