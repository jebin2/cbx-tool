export type ViewPrefs = {
  fitMode: "height" | "width";
  viewMode: "vstrip" | "hstrip" | "spread";
  autoScrollSpeed: string;
};

const PREFS_KEY = "cbx-view-prefs";

const DEFAULT_PREFS: ViewPrefs = {
  fitMode: "height",
  viewMode: "vstrip",
  autoScrollSpeed: "2",
};

export function loadViewPrefs(): ViewPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { ...DEFAULT_PREFS, ...stored };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveViewPrefs(patch: Partial<ViewPrefs>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadViewPrefs(), ...patch }));
  } catch {
    // Storage unavailable — preferences just won't persist.
  }
}
