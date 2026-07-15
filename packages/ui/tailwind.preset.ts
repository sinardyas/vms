/**
 * Shared Tailwind preset for @vms/ui (M0.5).
 *
 * Both the portal and console apps extend this preset so every screen inherits the same design
 * tokens. Colours resolve to CSS variables declared in `src/styles/globals.css` (shadcn-style),
 * so a token can be retuned in one place and every component follows. The palette, radius and
 * type scale are lifted from `DESIGN_GUIDELINES.md` + the prototype (vendor_portal / staff_console).
 *
 * Consuming apps must add `../../packages/ui/src` to their own `content` globs so the components'
 * classes are not tree-shaken away.
 */

import type { Config } from "tailwindcss";

/** `hsl(var(--x))`, or `hsl(var(--x) / <alpha-value>)` so opacity utilities keep working. */
const withAlpha = (name: string) => `hsl(var(${name}) / <alpha-value>)`;

const preset = {
  content: [],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        // Core shadcn surface tokens
        background: withAlpha("--background"),
        foreground: withAlpha("--foreground"),
        border: withAlpha("--border"),
        input: withAlpha("--input"),
        ring: withAlpha("--ring"),
        card: {
          DEFAULT: withAlpha("--card"),
          foreground: withAlpha("--card-foreground"),
        },
        popover: {
          DEFAULT: withAlpha("--popover"),
          foreground: withAlpha("--popover-foreground"),
        },
        primary: {
          DEFAULT: withAlpha("--primary"),
          foreground: withAlpha("--primary-foreground"),
        },
        secondary: {
          DEFAULT: withAlpha("--secondary"),
          foreground: withAlpha("--secondary-foreground"),
        },
        muted: {
          DEFAULT: withAlpha("--muted"),
          foreground: withAlpha("--muted-foreground"),
        },
        accent: {
          DEFAULT: withAlpha("--accent"),
          foreground: withAlpha("--accent-foreground"),
        },
        // Soechi brand + semantic tokens (prototype)
        navy: {
          DEFAULT: withAlpha("--navy"),
          foreground: withAlpha("--navy-foreground"),
        },
        sidebar: {
          DEFAULT: withAlpha("--sidebar"),
          foreground: withAlpha("--sidebar-foreground"),
          muted: withAlpha("--sidebar-muted"),
          active: withAlpha("--sidebar-active"),
          "active-foreground": withAlpha("--sidebar-active-foreground"),
        },
        success: {
          DEFAULT: withAlpha("--success"),
          foreground: withAlpha("--success-foreground"),
        },
        warning: {
          DEFAULT: withAlpha("--warning"),
          foreground: withAlpha("--warning-foreground"),
        },
        info: {
          DEFAULT: withAlpha("--info"),
          foreground: withAlpha("--info-foreground"),
        },
        destructive: {
          DEFAULT: withAlpha("--destructive"),
          foreground: withAlpha("--destructive-foreground"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      letterSpacing: {
        widest: "0.15em",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "zoom-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "zoom-in": "zoom-in 150ms ease-out",
        "slide-in-right": "slide-in-right 300ms ease-out",
      },
    },
  },
  plugins: [],
} satisfies Omit<Config, "content"> & { content: string[] };

export default preset;
