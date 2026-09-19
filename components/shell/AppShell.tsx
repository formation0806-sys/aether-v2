"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  Search,
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
        "flex items-center gap-3 rounded-lg px-3 py-3 text-[14px] font-medium transition-colors duration-150 lg:py-2.5",
        isActive
          ? "bg-[#141414] text-[#F5F5F5]"
          : "text-[#A0A0A0] hover:bg-[#0F0F0F] hover:text-[#F5F5F5]"
      )}
    >
      <item.icon
        size={18}
        strokeWidth={isActive ? 2 : 1.8}
        className="shrink-0"
        aria-hidden
      />
      <span>{item.label}</span>
    </Link>
  );
}

function DesktopUser({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <div className="border-t border-[#1A1A1A] p-3">
      <div className="mb-1 px-1.5">
        <p className="eyebrow">Signed in as</p>
        <p className="mt-1 truncate text-xs font-medium text-[#F5F5F5]">
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
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium text-[#A0A0A0] transition-colors duration-150 hover:bg-[#0F0F0F] hover:text-[#F5F5F5]"
        >
          <LogOut
            size={18}
            strokeWidth={1.8}
            className="shrink-0"
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
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[#1A1A1A] bg-[#050505] lg:flex">
      <div className="flex h-16 shrink-0 items-center border-b border-[#1A1A1A] px-5">
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

        <div className="my-3 border-t border-[#1A1A1A]" />

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
  const [searchQuery, setSearchQuery] = useState("");

  // Close the drawer with the Escape key (standard dialog behavior).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Filter sessions based on search query
  const filteredSessions = useMemo(() => {
    // We'll use a simple approach - the ConversationHistory component will handle filtering
    // For now, we just pass the search query through
    return null;
  }, [searchQuery]);

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
      <div className="drawer-enter absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col border-r border-[#1A1A1A] bg-black">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#1A1A1A] px-4">
          <ProductMarkFull />
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close navigation"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[#A0A0A0] transition-colors duration-150 hover:bg-[#141414] hover:text-[#F5F5F5]"
          >
            <X size={20} />
          </button>
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto py-1">
          {/* New Chat - prominent at top */}
          <Link
            href="/chat"
            onClick={onClose}
            className="flex items-center justify-between rounded-lg px-3 py-3 text-sm font-medium text-[#F5F5F5] transition-colors duration-150 hover:bg-[#141414] lg:py-2.5"
          >
            <span className="flex items-center gap-2">
              <Plus size={18} className="shrink-0" aria-hidden />
              <span>New Chat</span>
            </span>
          </Link>

          {/* Search */}
          <div className="mt-3">
            <div className="flex items-center gap-2 rounded-lg bg-[#0A0A0A] border border-[#202020] px-3 py-2.5">
              <Search size={16} className="shrink-0 text-[#707070]" aria-hidden />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                className="flex-1 bg-transparent text-sm text-[#F5F5F5] placeholder:text-[#707070] outline-none"
                aria-label="Search conversations"
              />
            </div>
          </div>

          <div className="mx-3 my-3 border-t border-[#1A1A1A]" />

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

          <div className="mx-3 my-3 border-t border-[#1A1A1A]" />

          <ConversationHistory onNavigate={onClose} searchQuery={searchQuery} />

          <div className="mx-3 my-3 border-t border-[#1A1A1A]" />

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
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-[14px] font-medium text-[#A0A0A0] transition-colors duration-150 hover:bg-[#0F0F0F] hover:text-[#F5F5F5] lg:py-2.5"
            >
              <LogOut
                size={18}
                strokeWidth={1.8}
                className="shrink-0"
                aria-hidden
              />
              <span>Sign out</span>
            </Link>
          </div>
        </nav>

        <div className="border-t border-[#1A1A1A] p-3">
          <p className="truncate text-xs text-[#707070]">
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#1A1A1A] bg-black px-3 lg:hidden app-safe-top">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open navigation"
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[#A0A0A0] transition-colors duration-150 hover:bg-[#141414] hover:text-[#F5F5F5]"
      >
        <Menu size={22} />
      </button>
      <ProductMarkFull variant="full" className="mx-auto" />
      <Link
        href="/chat"
        aria-label="New chat"
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[#F5F5F5] transition-colors duration-150 hover:bg-[#141414]"
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
    <div className="flex h-dvh overflow-hidden bg-black">
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
