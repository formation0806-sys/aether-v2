import { vi } from "vitest";

export const fixtureFetch = vi.stubGlobal("fetch", vi.fn());

export function resetFetch() {
  vi.restoreAllMocks();
}