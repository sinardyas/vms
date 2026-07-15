import {
  ClockCountdown,
  FileText,
  FloppyDisk,
  MagnifyingGlass,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { VENDOR_STATUSES, VERIFY_STATUSES } from "@vms/domain";
import { Badge } from "./components/badge";
import { Button } from "./components/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/dialog";
import { Field } from "./components/field";
import { Input, Textarea } from "./components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/select";
import { StatCard } from "./components/stat-card";
import { StatusPill, vendorStatusTone, verifyStatusTone } from "./components/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";
import { useToast } from "./components/toast";
import { useT } from "./i18n/provider";

/**
 * Gallery — the component showcase the ticket calls for. Renders every primitive against the
 * prototype's feel so reviewers can eyeball fidelity in a running app. Must live inside
 * `<LocaleProvider>` + `<ToastProvider>` (both app shells provide them).
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">{children}</CardContent>
    </Card>
  );
}

const SAMPLE_VENDORS = [
  { name: "PT Samudera Bahari", npwp: "01.234.567.8-901.000", status: "active" as const },
  { name: "CV Tanker Nusantara", npwp: "02.345.678.9-012.000", status: "pending" as const },
  { name: "Ocean Freight Ltd", npwp: "—", status: "draft" as const },
  { name: "PT Bahtera Jaya", npwp: "03.456.789.0-123.000", status: "blacklisted" as const },
];

export function Gallery() {
  const t = useT();
  const { toast } = useToast();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">Design system</p>
        <h1 className="text-2xl font-bold text-foreground">@vms/ui component gallery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prototype look-and-feel extracted into shadcn-structured React components. Flip the ID/EN
          switch in the header — the enum labels below re-render from the domain catalogue.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard tone="primary" icon={ClockCountdown} label="Awaiting Process" value={12} />
        <StatCard tone="warning" icon={Warning} label="Pending HOD" value={3} />
        <StatCard tone="success" icon={FileText} label="Verified" value={48} />
        <StatCard tone="danger" icon={Trash} label="Rejected" value={2} />
      </div>

      <Section title="Buttons">
        <Button variant="primary">
          <FloppyDisk size={18} weight="bold" /> Primary
        </Button>
        <Button variant="success">Approve</Button>
        <Button variant="destructive">
          <Trash size={18} weight="bold" /> Reject
        </Button>
        <Button variant="outline">Cancel</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Learn more</Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section title="Badges & status pills">
        <Badge tone="primary">Local</Badge>
        <Badge tone="info">Foreign</Badge>
        <Badge tone="navy">PKP</Badge>
        <span className="mx-2 h-6 w-px bg-border" />
        {VENDOR_STATUSES.map((s) => (
          <StatusPill key={s} tone={vendorStatusTone[s]}>
            {t(`enum.vendorStatus.${s}`)}
          </StatusPill>
        ))}
        <span className="mx-2 h-6 w-px bg-border" />
        {VERIFY_STATUSES.map((s) => (
          <StatusPill key={s} tone={verifyStatusTone[s]}>
            {t(`enum.verifyStatus.${s}`)}
          </StatusPill>
        ))}
      </Section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Form controls</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Company Name" required helper="As printed on the deed of establishment">
            {(p) => <Input placeholder="PT Samudera Bahari" {...p} />}
          </Field>
          <Field label="NPWP" required error="Invalid NPWP format">
            {(p) => <Input placeholder="00.000.000.0-000.000" defaultValue="123" {...p} />}
          </Field>
          <Field label="Vendor Origin">
            {(p) => (
              <Select>
                <SelectTrigger id={p.id} aria-describedby={p["aria-describedby"]}>
                  <SelectValue placeholder="Select origin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local / Dalam Negeri</SelectItem>
                  <SelectItem value="foreign">Foreign / Luar Negeri</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Search">
            {(p) => (
              <div className="relative">
                <MagnifyingGlass
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input className="pl-9" placeholder="Search vendors…" {...p} />
              </div>
            )}
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            {(p) => <Textarea placeholder="Internal note…" {...p} />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tabs</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="text-sm text-muted-foreground">
              Vendor profile fields render here.
            </TabsContent>
            <TabsContent value="documents" className="text-sm text-muted-foreground">
              Uploaded documents and verification state.
            </TabsContent>
            <TabsContent value="history" className="text-sm text-muted-foreground">
              Approval and audit timeline.
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Table</CardTitle>
        </CardHeader>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Vendor</TableHead>
                  <TableHead>NPWP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SAMPLE_VENDORS.map((v) => (
                  <TableRow key={v.name}>
                    <TableCell className="font-semibold">{v.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {v.npwp}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={vendorStatusTone[v.status]}>
                        {t(`enum.vendorStatus.${v.status}`)}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Section title="Overlays & feedback">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Activate vendor?</DialogTitle>
              <DialogDescription>
                This moves the vendor to Active and grants portal access. The action is audited.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" className="flex-1">
                  Cancel
                </Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="success" className="flex-[2]">
                  Activate
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button
          variant="secondary"
          onClick={() => toast({ title: "Saved", description: "Draft stored.", tone: "success" })}
        >
          Success toast
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({ title: "Permission denied", description: t("error.forbidden"), tone: "danger" })
          }
        >
          Error toast
        </Button>
      </Section>
    </div>
  );
}
