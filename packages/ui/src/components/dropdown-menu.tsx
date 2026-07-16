import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

/**
 * Dropdown menu — an anchored panel that hangs off a trigger, in the prototype's card idiom (white
 * `rounded-xl` surface, hairline border, generous shadow). Built on Radix DropdownMenu so focus
 * management, `Esc`, outside-click dismissal, typeahead, and arrow-key roving come for free.
 *
 * The notification bell (M6.3) is the first caller: `Content` is deliberately unopinionated about
 * width and padding so a panel of rows can set its own, rather than inheriting a menu's item metrics.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 8, ...props }, ref) => (
  <DropdownMenuPortal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-card shadow-2xl",
        "data-[state=open]:animate-fade-in",
        className,
      )}
      {...props}
    />
  </DropdownMenuPortal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm outline-none transition-colors",
      "focus:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuLabel = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-3 py-2 text-sm font-bold text-foreground", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuSeparator = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("h-px bg-border", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
