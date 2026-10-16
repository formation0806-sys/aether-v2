import Link from "next/link";

/**
 * SALPA wordmark — text only, standing alone.
 * The circular ring mark was intentionally removed from the homepage.
 */
export function SalpaWordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center ${className ?? ""}`}
      aria-label="Salpa home"
    >
      <span className="text-sm font-semibold tracking-[0.18em] text-white">
        SALPA
      </span>
    </Link>
  );
}
