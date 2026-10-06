import type { Metadata, Viewport } from "next";
import { ACTIVE_VISUAL_THEME, VISUAL_THEMES, VISUAL_THEME_STORAGE_KEY } from "./visual-theme";
import "./globals.css";
import "./stats-search.css";
import "./visual-themes.css";
import "./neon-lime.css";
import "./deep-ink-blue.css";
import "./theme-picker.css";
import "./theme-geometry.css";
import "./ledger-home-refinement.css";

export const metadata: Metadata = {
  title: "记一笔",
  description: "轻量、清晰的个人与家庭记账网页。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const restoreThemeScript = `try{const selected=localStorage.getItem(${JSON.stringify(VISUAL_THEME_STORAGE_KEY)});if(${JSON.stringify(Object.keys(VISUAL_THEMES))}.includes(selected)){document.documentElement.dataset.visualTheme=selected}}catch{}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-visual-theme={ACTIVE_VISUAL_THEME} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: restoreThemeScript }} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
