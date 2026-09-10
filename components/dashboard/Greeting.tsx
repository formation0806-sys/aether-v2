"use client";

import { useMemo } from "react";

/**
 * Returns a timezone-aware greeting based on the user's local time.
 *
 * Time ranges (browser local time):
 *   00:00–04:59 → "Good night"
 *   05:00–11:59 → "Good morning"
 *   12:00–16:59 → "Good afternoon"
 *   17:00–20:59 → "Good evening"
 *   21:00–23:59 → "Good night"
 */
function getGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

export default function Greeting() {
  const greeting = useMemo(() => getGreeting(), []);

  return <>{greeting}</>;
}
