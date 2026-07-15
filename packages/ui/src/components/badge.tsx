import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "../lib/cn";

/**
 * Badge — the prototype's small inline pill (DESIGN_GUIDELINES §5): tinted `{color}-50` surface,
 * `{color}-700` text, uppercase tracked. Tones follow the semantic palette so status, role chips
 * and section tags stay consistent.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
  {
    variants: {
      tone: {
        neutral: "bg-secondary text-muted-foreground",
        primary: "bg-primary/10 text-primary",
        success: "bg-success/10 text-success",
        warning: "bg-warning/15 text-warning-foreground",
        danger: "bg-destructive/10 text-destructive",
        info: "bg-info/10 text-info",
        navy: "bg-navy/10 text-navy",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
