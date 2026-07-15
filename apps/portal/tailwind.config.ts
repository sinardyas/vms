import uiPreset from "@vms/ui/tailwind-preset";
import type { Config } from "tailwindcss";

/**
 * Portal Tailwind config — inherits the shared @vms/ui preset (tokens, palette, radius) and adds
 * the content globs. The `packages/ui/src` glob is essential: the design-system components live
 * there, so their classes must be scanned or they'd be purged from the build.
 */
export default {
  presets: [uiPreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
} satisfies Config;
