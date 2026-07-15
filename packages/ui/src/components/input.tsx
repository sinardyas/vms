import { forwardRef } from "react";
import { cn } from "../lib/cn";

/**
 * Input — the prototype's form field (DESIGN_GUIDELINES §5): rounded-xl, semibold value text,
 * blue focus ring. Read-only fields get the muted, not-allowed treatment automatically.
 */
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors",
        "placeholder:font-normal placeholder:text-muted-foreground",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        "read-only:cursor-not-allowed read-only:bg-secondary read-only:text-muted-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

/** Textarea sibling — same skin, taller, no resize (matches the prototype's note fields). */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-24 w-full resize-none rounded-xl border border-input bg-card px-3.5 py-3 text-sm font-semibold text-foreground shadow-sm transition-colors",
      "placeholder:font-normal placeholder:text-muted-foreground",
      "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
