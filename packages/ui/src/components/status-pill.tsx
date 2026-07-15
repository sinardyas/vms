import type { VendorStatus, VerifyStatus } from "@vms/domain";
import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "../lib/cn";

/**
 * StatusPill — a traffic-light dot + label for a record's lifecycle state. The tone maps a
 * semantic colour; the dot is the "traffic light" the ticket calls for. Domain helpers below map
 * `VendorStatus` / `VerifyStatus` codes to the right tone so screens never hard-code the colour.
 */
const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
  {
    variants: {
      tone: {
        neutral: "bg-secondary text-muted-foreground",
        info: "bg-info/10 text-info",
        pending: "bg-warning/15 text-warning-foreground",
        success: "bg-success/10 text-success",
        danger: "bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const dotColor: Record<NonNullable<VariantProps<typeof pillVariants>["tone"]>, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-info",
  pending: "bg-warning",
  success: "bg-success",
  danger: "bg-destructive",
};

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  /** Hide the traffic-light dot (label only). */
  hideDot?: boolean;
}

export function StatusPill({
  className,
  tone = "neutral",
  hideDot,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span className={cn(pillVariants({ tone }), className)} {...props}>
      {!hideDot && <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[tone ?? "neutral"])} />}
      {children}
    </span>
  );
}

/** Vendor lifecycle → tone (Draft→Pending→Active, incl. HOD; inactive/blacklisted). */
export const vendorStatusTone: Record<VendorStatus, StatusPillProps["tone"]> = {
  draft: "neutral",
  pending: "pending",
  pending_hod: "pending",
  active: "success",
  inactive: "neutral",
  blacklisted: "danger",
};

/** Document verification → tone. */
export const verifyStatusTone: Record<VerifyStatus, StatusPillProps["tone"]> = {
  pending: "pending",
  verified: "success",
  rejected: "danger",
};

export { pillVariants };
