export const VISUAL_THEMES = {
  "dashu-green": "大树绿",
  "mist-paper": "浅青色",
  "deep-ink-blue": "深墨蓝",
  "neon-lime": "暗黑荧光绿",
} as const;

export type VisualThemeId = keyof typeof VISUAL_THEMES;
export const VISUAL_THEME_STORAGE_KEY = "qingzhang-visual-theme";

export function isVisualThemeId(value: unknown): value is VisualThemeId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(VISUAL_THEMES, value);
}

// Default for new browsers and unavailable preferences. Ledger data is unaffected.
export const ACTIVE_VISUAL_THEME: VisualThemeId = "deep-ink-blue";
