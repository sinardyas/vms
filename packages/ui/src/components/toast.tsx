import { CheckCircle, Info, WarningCircle, XCircle } from "@phosphor-icons/react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "../lib/cn";

/**
 * Toast — transient feedback (save succeeded, permission denied…). Built on Radix Toast for
 * timing, swipe-to-dismiss and screen-reader announcement. Wrap the app in `<ToastProvider>` and
 * call `useToast().toast({ title, tone })` anywhere below it.
 */
type ToastTone = "info" | "success" | "warning" | "danger";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (t: { title: string; description?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneStyles: Record<ToastTone, { border: string; icon: React.ReactNode }> = {
  info: { border: "border-l-info", icon: <Info size={20} weight="fill" className="text-info" /> },
  success: {
    border: "border-l-success",
    icon: <CheckCircle size={20} weight="fill" className="text-success" />,
  },
  warning: {
    border: "border-l-warning",
    icon: <WarningCircle size={20} weight="fill" className="text-warning" />,
  },
  danger: {
    border: "border-l-destructive",
    icon: <XCircle size={20} weight="fill" className="text-destructive" />,
  },
};

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback<ToastContextValue["toast"]>(({ title, description, tone = "info" }) => {
    nextId += 1;
    const id = nextId;
    setItems((prev) => [...prev, { id, title, description, tone }]);
  }, []);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) remove(item.id);
            }}
            className={cn(
              "flex items-start gap-3 rounded-xl border border-border border-l-4 bg-card p-4 shadow-lg",
              "data-[state=open]:animate-slide-in-right data-[swipe=end]:animate-fade-in",
              toneStyles[item.tone].border,
            )}
          >
            {toneStyles[item.tone].icon}
            <div className="flex-1">
              <ToastPrimitive.Title className="text-sm font-bold text-foreground">
                {item.title}
              </ToastPrimitive.Title>
              {item.description && (
                <ToastPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                  {item.description}
                </ToastPrimitive.Description>
              )}
            </div>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-3 p-6 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** Access the toast dispatcher. Throws if used outside `<ToastProvider>`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}
