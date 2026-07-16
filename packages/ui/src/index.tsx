/**
 * @vms/ui — the Soechi VMS React design system (M0.5).
 *
 * The prototype's look-and-feel (DESIGN_GUIDELINES.md, vendor_portal.html, staff_console.html)
 * extracted into reusable, accessible components: shadcn architecture (Radix primitives + cva +
 * `cn`), re-skinned to the Soechi palette via CSS-variable tokens (`./styles.css`). Every Phase-0
 * screen inherits it. Import the stylesheet once per app and extend the Tailwind preset:
 *
 *   import "@vms/ui/styles.css";
 *   // tailwind.config: presets: [require("@vms/ui/tailwind-preset").default]
 */

export const UI_VERSION = "0.1.0";

// Utilities
export { cn } from "./lib/cn";

// Primitives
export { Button, buttonVariants, type ButtonProps } from "./components/button";
export { Input, Textarea } from "./components/input";
export { Label } from "./components/label";
export { Field, type FieldProps } from "./components/field";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/card";
export { Badge, badgeVariants, type BadgeProps } from "./components/badge";
export {
  StatusPill,
  vendorStatusTone,
  verifyStatusTone,
  type StatusPillProps,
} from "./components/status-pill";
export { StatCard, type StatCardProps } from "./components/stat-card";
export {
  Table,
  TableContainer,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from "./components/table";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./components/dialog";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "./components/select";
export { ToastProvider, useToast } from "./components/toast";
export { ComingSoon, type ComingSoonProps } from "./components/coming-soon";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
} from "./components/dropdown-menu";

// Notifications — the in-app centre (M6.3, ADR-0016), mounted in the shell's `headerRight` by both
// apps. The app supplies the API; this package never learns where it lives.
export {
  NotificationBell,
  relativeTime,
  type NotificationBellProps,
  type NotificationApi,
  type NotificationItem,
  type NotificationFeedPage,
} from "./notifications/bell";

// App shell
export {
  AppShell,
  type AppShellProps,
  type NavItem,
  type NavGroup,
  type AppUser,
} from "./shell/app-shell";

// Access — RBAC capability mirror (M1.3): server-authored flags gate what a screen offers.
export {
  CapabilitiesProvider,
  useCapabilities,
  useCan,
  type CapabilitiesLoader,
  type CapabilitiesStatus,
} from "./access/capabilities";

// i18n
export { LocaleProvider, useLocale, useT, SUPPORTED_LOCALES } from "./i18n/provider";
export { LocaleSwitch } from "./i18n/locale-switch";

// Showcase
export { Gallery } from "./gallery";
