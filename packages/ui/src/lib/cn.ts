import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names the shadcn way: `clsx` for conditionals, `tailwind-merge` to resolve
 * conflicting Tailwind utilities (a later `px-4` beats an earlier `px-2`). Every component
 * funnels its `className` prop through here so callers can override any default.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
