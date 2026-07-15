import type { Icon } from "@phosphor-icons/react";
import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "../lib/cn";

/**
 * StatCard — the prototype's counter card (DESIGN_GUIDELINES §5): a tinted surface, an icon in a
 * rounded chip, a tiny uppercase label, and a big `text-4xl font-extrabold` number. The `tone`
 * swaps the whole colour family (blue / amber / red / green) as the guidelines prescribe.
 */
const statVariants = cva(
  "flex flex-col justify-between rounded-xl border p-6 shadow-sm transition-all hover:shadow-md",
  {
    variants: {
      tone: {
        primary: "border-primary/20 bg-primary/5",
        warning: "border-warning/20 bg-warning/10",
        danger: "border-destructive/20 bg-destructive/5",
        success: "border-success/20 bg-success/5",
        info: "border-info/20 bg-info/5",
      },
    },
    defaultVariants: { tone: "primary" },
  },
);

const chipTone: Record<NonNullable<VariantProps<typeof statVariants>["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  warning: "bg-warning/15 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  success: "bg-success/10 text-success",
  info: "bg-info/10 text-info",
};

export interface StatCardProps extends VariantProps<typeof statVariants> {
  label: string;
  value: React.ReactNode;
  icon?: Icon;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: IconCmp,
  tone = "primary",
  className,
}: StatCardProps) {
  return (
    <div className={cn(statVariants({ tone }), className)}>
      <div className="mb-2 flex items-center gap-2">
        {IconCmp && (
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              chipTone[tone ?? "primary"],
            )}
          >
            <IconCmp size={18} weight="bold" />
          </span>
        )}
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <span className="mt-1 text-4xl font-extrabold text-foreground">{value}</span>
    </div>
  );
}
