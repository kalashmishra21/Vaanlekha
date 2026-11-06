export type Appearance = "light" | "dark";

export const appearanceEvent = "dukaansaathi-appearance-change";

export function resolveAppearance(value: unknown): Appearance {
  return value === "dark" ? "dark" : "light";
}

export function readAppearance(): Appearance {
  try {
    return resolveAppearance(localStorage.getItem("dukaansaathi-theme"));
  } catch {
    return "light";
  }
}

export function applyAppearance(next: Appearance) {
  document.documentElement.dataset.theme = next;
}

export function saveAppearance(next: Appearance) {
  try { localStorage.setItem("dukaansaathi-theme", next); } catch { /* This session still updates. */ }
  applyAppearance(next);
  window.dispatchEvent(new Event(appearanceEvent));
}
