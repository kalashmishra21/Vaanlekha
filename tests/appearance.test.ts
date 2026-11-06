import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { applyAppearance, readAppearance, resolveAppearance, saveAppearance } from "../src/lib/appearance";

describe("Ivory Atelier default appearance", () => {
  it("defaults to Ivory regardless of system preference or an obsolete persisted value", () => {
    expect(resolveAppearance(null)).toBe("light");
    expect(resolveAppearance("system")).toBe("light");
    expect(resolveAppearance("forest")).toBe("light");
    expect(resolveAppearance("dark")).toBe("dark");
  });

  it("sets Ivory on the server before hydration and ignores OS dark preference for new visitors", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain('data-theme="light"');
    expect(layout).toContain("t==='dark'?'dark':'light'");
    expect(layout).not.toContain("prefers-color-scheme: dark");
  });

  it("retains a deliberately saved dark theme and manual switching still persists", () => {
    const data = new Map<string, string>([["dukaansaathi-theme", "dark"]]);
    const element = { dataset: {} as Record<string, string> };
    const setItem = vi.fn((key: string, value: string) => data.set(key, value));
    vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem });
    vi.stubGlobal("document", { documentElement: element });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    expect(readAppearance()).toBe("dark");
    applyAppearance("dark");
    expect(element.dataset.theme).toBe("dark");
    saveAppearance("light");
    expect(data.get("dukaansaathi-theme")).toBe("light");
    expect(element.dataset.theme).toBe("light");
    vi.unstubAllGlobals();
  });
});
