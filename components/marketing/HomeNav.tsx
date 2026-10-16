"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { SalpaWordmark } from "@/components/marketing/SalpaMark";

/**
 * Refined public navigation.
 *
 * Destinations (unchanged):
 *   Why Salpa   -> #idea
 *   Memory      -> #memory
 *   How it works -> #continuity
 *   Product     -> #experience
 *   Sign in     -> /signin
 *   Get started -> /signup
 *
 * A functional, keyboard-accessible mobile menu is rendered below the
 * breakpoint. Anchor targets use scroll-mt-20 on their sections so they are
 * never hidden behind the sticky header.
 */
const NAV_LINKS = [
  { href: "#why-salpa", label: "Why Salpa" },
  { href: "#memory", label: "Memory" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#experience", label: "Product" },
] as const;

export default function HomeNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  // Close the mobile menu on Escape so keyboard users can dismiss it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, toggle]);

  return (
    <header
      className={`sticky top-0 z-40 border-b border-white/[0.06] bg-black/80 backdrop-blur-md transition-colors duration-300 ${scrolled ? "border-white/[0.14] bg-black/95" : "border-white/[0.06] bg-black/80"}`}
    >
      <nav aria-label="Primary" className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <SalpaWordmark className="mr-2" />

        {/* Desktop links */}
        <div className="hidden items-center gap-8 text-sm text-[#94a3b8] md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors duration-200 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/signin"
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-[#94a3b8] transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="group inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-medium text-black transition-all duration-200 hover:bg-[#E5E5E5] hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Get started
            <ArrowRight size={15} aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>

          {/* Mobile menu button */}
          <button
            onClick={toggle}
            aria-expanded={open}
            aria-label="Open main menu"
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#94a3b8] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
          >
            {open ? (
              <X size={20} strokeWidth={2} />
            ) : (
              <Menu size={20} strokeWidth={2} />
            )}
          </button>
        </div>
      </nav>

      {/* Mobile menu drawer */}
      {open && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={toggle}
          aria-hidden="true"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          />
          <div
            className="absolute inset-y-0 left-0 w-full max-w-xs flex flex-col border-r border-white/[0.06] bg-black/95 backdrop-blur-md p-6 sm:px-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <SalpaWordmark className="text-sm" />
              <button
                onClick={toggle}
                aria-label="Close menu"
                className="text-[#94a3b8] hover:text-white transition-colors"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>
            <nav aria-label="Mobile menu" className="flex flex-col gap-1 text-sm">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={toggle}
                  className="block py-4 text-[#cbd5e1] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg"
                >
                  {link.label}
                </a>
              ))}
              <div className="mt-8 pt-6 border-t border-white/[0.06] flex flex-col gap-2">
                <Link
                  href="/signin"
                  className="block py-3 text-[#94a3b8] transition-colors hover:text-white rounded-lg"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="block py-3 inline-flex items-center gap-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-[#E5E5E5] hover:-translate-y-px transition-all"
                >
                  Get started
                  <ArrowRight size={14} aria-hidden />
                </Link>
              </div>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
