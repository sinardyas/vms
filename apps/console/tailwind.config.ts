import uiPreset from "@vms/ui/tailwind-preset";
import type { Config } from "tailwindcss";

/**
 * Console Tailwind config — inherits the shared @vms/ui preset and scans both the app and the
 * design-system source so component classes survive the production purge.
 */
export default {
  presets: [uiPreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
} satisfies Config;
