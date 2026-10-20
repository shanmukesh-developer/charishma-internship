import type { Config } from "tailwindcss";

/**
 * Zenvy admin design tokens. Every colour is a CSS variable (RGB channels, see globals.css) so the
 * same class works in light and dark mode and still supports Tailwind's `/alpha` modifier.
 * Pages should only use these semantic names (bg, surface, line, fg, accent, success, ...), never raw
 * palette colours, so dark-mode parity comes for free.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Legacy names kept for any third-party class that still references them.
        background: token("bg"),
        foreground: token("fg"),

        bg: token("bg"),
        surface: {
          DEFAULT: token("surface"),
          2: token("surface-2"),
          3: token("surface-3"),
        },
        line: {
          DEFAULT: token("line"),
          strong: token("line-strong"),
        },
        fg: {
          DEFAULT: token("fg"),
          muted: token("fg-muted"),
          subtle: token("fg-subtle"),
        },
        accent: {
          DEFAULT: token("accent"),
          hover: token("accent-hover"),
          fg: token("accent-fg"),
          soft: token("accent-soft"),
          text: token("accent-text"),
        },
        success: { DEFAULT: token("success"), soft: token("success-soft"), text: token("success-text") },
        warning: { DEFAULT: token("warning"), soft: token("warning-soft"), text: token("warning-text") },
        danger: { DEFAULT: token("danger"), soft: token("danger-soft"), text: token("danger-text") },
        info: { DEFAULT: token("info"), soft: token("info-soft"), text: token("info-text") },
        // Fixed colours (same in both themes): text on solid accent / danger buttons, modal scrim.
        "on-solid": "rgb(255 255 255 / <alpha-value>)",
        scrim: "rgb(8 9 12 / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      // Type scale for a dense operations UI (13 px body).
      fontSize: {
        "2xs": ["11px", { lineHeight: "16px" }],
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["14px", { lineHeight: "22px" }],
        lg: ["16px", { lineHeight: "24px" }],
        xl: ["18px", { lineHeight: "26px" }],
        "2xl": ["22px", { lineHeight: "30px" }],
        "3xl": ["28px", { lineHeight: "36px" }],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(var(--shadow) / 0.06)",
        sm: "0 1px 3px 0 rgb(var(--shadow) / 0.08), 0 1px 2px -1px rgb(var(--shadow) / 0.06)",
        pop: "0 12px 32px -8px rgb(var(--shadow) / 0.24), 0 2px 6px -2px rgb(var(--shadow) / 0.12)",
      },
      ringColor: {
        DEFAULT: token("accent"),
      },
      keyframes: {
        "zv-fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "zv-pop-in": { from: { opacity: "0", transform: "translateY(4px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        "zv-slide-in": { from: { transform: "translateX(16px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
      },
      animation: {
        "zv-fade-in": "zv-fade-in 120ms ease-out both",
        "zv-pop-in": "zv-pop-in 140ms ease-out both",
        "zv-slide-in": "zv-slide-in 180ms ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
