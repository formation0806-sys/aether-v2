"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MessageSquare,
  Brain,
  CheckSquare,
  Compass,
  Settings,
  LogOut,
  Menu,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react";

import { ProductMarkFull } from "@/components/product/ProductMark";
import ConversationHistory from "@/components/ai/ConversationHistory";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Compass },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
];

const BOTTOM_ITEMS: NavItem[] = [
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavItem({
  item,
  isActive,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-smooth lg:py-2.5",
        isActive
          ? "bg-[var(--brand)]/10 text-[var(--brand)]"
          : "text-[var(--sidebar-foreground)]/80 hover:bg-[var(--sidebar-accent)] hover:text-[var(--foreground)]"
      )}
    >
      {isActive && (
        <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--brand)]" />
      )}
      <item.icon
        size={18}
        strokeWidth={isActive ? 2.2 : 2}
        className={cn(
          "shrink-0 transition-transform duration-200 group-hover:scale-110",
          isActive ? "text-[var(--brand)]" : "opacity-90"
        )}
        aria-hidden
      />
      <span>{item.label}</span>
    </Link>
  );
}

function DesktopUser({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <div className="border-t border-[var(--sidebar-border)] p-3">
      <div className="mb-1 px-1.5">
        <p className="eyebrow">Signed in as</p>
        <p className="mt-1 truncate text-xs font-medium text-[var(--foreground)]">
          {email}
        </p>
      </div>
      <div className="space-y-0.5">
        {BOTTOM_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            isActive={pathname === item.href}
          />
        ))}
        <Link
          href="/"
          className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--muted-foreground)] transition-smooth hover:bg-[var(--sidebar-accent)] hover:text-[var(--foreground)]"
        >
          <LogOut
            size={18}
            strokeWidth={1.8}
            className="shrink-0 transition-transform duration-200 group-hover:scale-110"
            aria-hidden
          />
          <span>Sign out</span>
        </Link>
      </div>
    </div>
  );
}

function DesktopNav({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] lg:flex">
      <div className="flex h-16 shrink-0 items-center border-b border-[var(--sidebar-border)] px-5">
        <ProductMarkFull />
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto p-3">
        <div>
          <p className="eyebrow px-3 pb-2 pt-1">Workspace</p>
          <div className="space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <NavItem
                key={item.href}
                item={item}
                isActive={
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href + "/"))
                }
              />
            ))}
          </div>
        </div>

        <div className="my-3 border-t border-[var(--sidebar-border)]" />

        <ConversationHistory />
      </nav>

      <DesktopUser email={email} />
    </aside>
  );
}

function MobileNav({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const pathname = usePathname();

  // Close the drawer with the Escape key (standard dialog behavior).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Navigation"
      className="fixed inset-0 z-50 lg:hidden"
    >
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="backdrop-enter absolute inset-0 bg-black/50"
      />
      <div className="drawer-enter absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] shadow-2xl">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--sidebar-border)] px-4">
          <ProductMarkFull />
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close navigation"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-smooth hover:bg-[var(--muted)] hover:text-[var(--foreground)] active:scale-95"
          >
            <X size={20} />
          </button>
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto py-1">
          <p className="eyebrow px-3 pb-2 pt-1">Workspace</p>
          <div className="space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <NavItem
                key={item.href}
                item={item}
                isActive={
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href + "/"))
                }
                onNavigate={onClose}
              />
            ))}
          </div>

          <div className="mx-3 my-3 border-t border-[var(--sidebar-border)]" />

          <ConversationHistory onNavigate={onClose} />

          <div className="mx-3 my-3 border-t border-[var(--sidebar-border)]" />

          <p className="eyebrow px-3 pb-2 pt-1">Account</p>
          <div className="space-y-0.5">
            {BOTTOM_ITEMS.map((item) => (
              <NavItem
                key={item.href}
                item={item}
                isActive={pathname === item.href}
                onNavigate={onClose}
              />
            ))}
            <Link
              href="/"
              onClick={onClose}
              className="group flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-[var(--muted-foreground)] transition-smooth hover:bg-[var(--sidebar-accent)] hover:text-[var(--foreground)] lg:py-2.5"
            >
              <LogOut
                size={18}
                strokeWidth={1.8}
                className="shrink-0 transition-transform duration-200 group-hover:scale-110"
                aria-hidden
              />
              <span>Sign out</span>
            </Link>
          </div>
        </nav>

        <div className="border-t border-[var(--sidebar-border)] p-3">
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {email}
          </p>
        </div>
      </div>
    </div>
  );
}

function MobileHeader({
  onMenuClick,
}: {
  onMenuClick: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-3 lg:hidden">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open navigation"
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-smooth hover:bg-[var(--muted)] hover:text-[var(--foreground)] active:scale-95"
      >
        <Menu size={22} />
      </button>
      <ProductMarkFull variant="full" className="mx-auto" />
      <Link
        href="/chat"
        aria-label="New chat"
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--foreground)] transition-smooth hover:bg-[var(--muted)] hover:text-[var(--brand)] active:scale-95"
      >
        <Plus size={22} aria-hidden />
      </Link>
    </header>
  );
}

export default function AppShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--background)]">
      <DesktopNav email={email} />

      {mobileNavOpen && (
        <MobileNav email={email} onClose={() => setMobileNavOpen(false)} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader onMenuClick={() => setMobileNavOpen(true)} />

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
