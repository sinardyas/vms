import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

/**
 * Button — the prototype's bold, pill-ish action (DESIGN_GUIDELINES §5). Colored variants carry a
 * matching tinted shadow; every variant pairs cleanly with a leading/trailing Phosphor icon via the
 * default `inline-flex gap-2`. `asChild` renders the styling onto a child (e.g. an `<a>`) à la shadcn.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90",
        success:
          "bg-success text-success-foreground shadow-md shadow-success/20 hover:bg-success/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20 hover:bg-destructive/90",
        outline: "border-2 border-destructive text-destructive hover:bg-destructive/10 font-bold",
        secondary:
          "border border-input bg-card text-foreground shadow-sm hover:bg-secondary font-medium",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground font-medium",
        link: "text-primary underline-offset-4 hover:underline font-semibold",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-6 text-sm",
        lg: "h-12 px-8 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
