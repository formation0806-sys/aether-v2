import Link from "next/link";

type ProductMarkProps = {
  variant?: "icon" | "full";
  className?: string;
};

function ProductIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
      <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" />
      <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.9" />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
    </svg>
  );
}

export function ProductMarkIcon({ className }: { className?: string }) {
  return <ProductIcon className={className} />;
}

export function ProductMarkFull({
  variant = "full",
  className,
}: ProductMarkProps) {
  const iconSize = variant === "icon" ? "size-8" : "size-7";

  return (
    <Link
      href="/dashboard"
      className={`inline-flex items-center gap-2.5 ${className}`}
      aria-label="Go to home"
    >
      <ProductIcon className={iconSize} />
      {variant === "full" && (
        <span className="text-sm font-semibold tracking-[0.18em] text-[var(--foreground)]">
          AETHER
        </span>
      )}
    </Link>
  );
}

export function ProductLogo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <ProductIcon className="size-10" />
    </div>
  );
}
