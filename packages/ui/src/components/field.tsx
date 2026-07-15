import { useId } from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";

/**
 * Field — the prototype's label-over-control unit (DESIGN_GUIDELINES §5): tiny uppercase label,
 * the control, then optional helper/error text. Wires `htmlFor`/`id` and `aria-describedby`
 * automatically so forms stay accessible without callers threading ids by hand.
 */
export interface FieldProps {
  label: string;
  required?: boolean;
  helper?: string;
  error?: string;
  className?: string;
  /** Render-prop receives the id + aria-* to spread onto the control. */
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => React.ReactNode;
}

export function Field({ label, required, helper, error, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : helper ? `${id}-helper` : undefined;
  return (
    <div className={cn("flex flex-col", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : helper ? (
        <p id={`${id}-helper`} className="mt-1.5 text-xs text-muted-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
