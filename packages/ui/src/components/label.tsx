import * as LabelPrimitive from "@radix-ui/react-label";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

/**
 * Label — the signature tiny uppercase wide-tracked field label (DESIGN_GUIDELINES §3).
 * Built on Radix Label so clicking it focuses its control. Pass `required` for the red `*`.
 */
export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground",
      "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  >
    {children}
    {required && <span className="text-destructive">*</span>}
  </LabelPrimitive.Root>
));
Label.displayName = "Label";
