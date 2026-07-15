import { APP_NAME } from "@vms/domain";
import { AppShell } from "@vms/ui";

export default function App() {
  return (
    <AppShell title={`${APP_NAME} — Staff Console`}>
      <p>
        Phase 0 scaffold. Master data, approvals and verification screens land in later tickets.
      </p>
    </AppShell>
  );
}
