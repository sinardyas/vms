/**
 * i18n message catalogue (M0.3, ADR-0008).
 *
 * Bilingual from day 1: every user-facing string is a **key**, resolved to Bahasa Indonesia
 * (`id`, the default) or English (`en`) at render time — never hard-coded. Domain/enum values
 * stay stable machine codes (see `values/enums.ts`); their human labels live here as keys.
 *
 * The catalogue is the single home for these keys; later milestones append their own
 * (M1 auth, M2 master data, M3 registration…). `MessageKey` is derived from this object, so a
 * typo in a key is a compile error, and {@link DomainError.messageKey} can only be a real key.
 */

/** One catalogue entry — the same message in each supported locale. */
export type MessageEntry = { readonly id: string; readonly en: string };

/**
 * The message catalogue. `{name}`-style tokens are interpolated at resolve time.
 * Keys are namespaced by area (`error.*`, `enum.<enum>.<value>`, …).
 */
export const catalogue = {
  // --- Foundational error messages (surface for DomainError codes) ---
  "error.validation": {
    id: "Data yang dikirim tidak valid.",
    en: "The submitted data is invalid.",
  },
  "error.notFound": {
    id: "Data tidak ditemukan.",
    en: "The requested record was not found.",
  },
  "error.unauthorized": {
    id: "Anda harus masuk terlebih dahulu.",
    en: "You must sign in first.",
  },
  "error.forbidden": {
    id: "Anda tidak memiliki izin untuk tindakan ini.",
    en: "You do not have permission for this action.",
  },
  "error.conflict": {
    id: "Terjadi konflik dengan data yang sudah ada.",
    en: "This conflicts with existing data.",
  },
  "error.invariant": {
    id: "Operasi melanggar aturan bisnis.",
    en: "The operation violates a business rule.",
  },
  "error.internal": {
    id: "Terjadi kesalahan tak terduga.",
    en: "An unexpected error occurred.",
  },

  // --- Enum labels (values are codes; labels are translated — ADR-0008) ---
  "enum.origin.local": { id: "Dalam Negeri", en: "Local" },
  "enum.origin.foreign": { id: "Luar Negeri", en: "Foreign" },

  "enum.vendorStatus.draft": { id: "Draf", en: "Draft" },
  "enum.vendorStatus.pending": { id: "Menunggu Persetujuan", en: "Pending" },
  "enum.vendorStatus.pending_hod": { id: "Menunggu Persetujuan HOD", en: "Pending HOD" },
  "enum.vendorStatus.active": { id: "Aktif", en: "Active" },
  "enum.vendorStatus.inactive": { id: "Tidak Aktif", en: "Inactive" },
  "enum.vendorStatus.blacklisted": { id: "Masuk Daftar Hitam", en: "Blacklisted" },

  "enum.verifyStatus.pending": { id: "Menunggu Verifikasi", en: "Pending" },
  "enum.verifyStatus.verified": { id: "Terverifikasi", en: "Verified" },
  "enum.verifyStatus.rejected": { id: "Ditolak", en: "Rejected" },

  // RBAC module labels (ADR-0012) — the 9 permission subjects. Codes stay neutral; these are the
  // human labels the audit filter (M1.4) and the Access matrix editor (M1.5) render.
  "enum.rbacModule.vendors": { id: "Vendor", en: "Vendors" },
  "enum.rbacModule.documents": { id: "Dokumen", en: "Documents" },
  "enum.rbacModule.approvals": { id: "Persetujuan", en: "Approvals" },
  "enum.rbacModule.registration_lists": { id: "Daftar Registrasi", en: "Registration Lists" },
  "enum.rbacModule.operational_lists": { id: "Daftar Operasional", en: "Operational Lists" },
  "enum.rbacModule.approval_routes": { id: "Rute Persetujuan", en: "Approval Routes" },
  "enum.rbacModule.document_master": { id: "Master Dokumen", en: "Document Master" },
  "enum.rbacModule.access": { id: "Kontrol Akses", en: "Access Control" },
  "enum.rbacModule.audit": { id: "Log Audit", en: "Audit Log" },

  // --- "Coming in a later phase" shells for out-of-Phase-0 sections (#9) ---
  "soon.badge": { id: "Fase Mendatang", en: "Later Phase" },
  "soon.title": { id: "Hadir pada fase berikutnya", en: "Coming in a later phase" },
  "soon.description": {
    id: "Bagian ini bukan bagian dari build Fase-0 yang sedang diuji. Fitur ini hadir pada rilis berikutnya — menu menampilkan keseluruhan peta produk, namun hanya layar Fase-0 yang aktif untuk UAT ini.",
    en: "This section isn't part of the Phase-0 build under test. It arrives in a later release — the menu shows the whole product map, but only Phase-0 screens are live for this UAT.",
  },
  "soon.previewLabel": { id: "Pratinjau statis", en: "Static preview" },
  "soon.previewHint": {
    id: "Tidak berfungsi — hanya menggambarkan alur yang direncanakan.",
    en: "Not functional — illustrates the intended flow only.",
  },

  // --- Auth emails — verification + password reset (M1.1, #20, ADR-0004/0015) ---
  // Transactional emails sent via SMTP (Mailpit in dev). Rendered in the recipient's locale,
  // defaulting to `id`. `{name}`, `{url}`, `{minutes}` are interpolated at send time.
  "auth.email.verify.subject": {
    id: "Verifikasi alamat email Anda — Soechi VMS",
    en: "Verify your email address — Soechi VMS",
  },
  "auth.email.verify.heading": { id: "Verifikasi email Anda", en: "Verify your email" },
  "auth.email.verify.body": {
    id: "Halo {name}, terima kasih telah mendaftar. Klik tombol di bawah untuk memverifikasi alamat email Anda dan mengaktifkan akun.",
    en: "Hi {name}, thanks for registering. Click the button below to verify your email address and activate your account.",
  },
  "auth.email.verify.cta": { id: "Verifikasi email", en: "Verify email" },
  "auth.email.reset.subject": {
    id: "Atur ulang kata sandi Anda — Soechi VMS",
    en: "Reset your password — Soechi VMS",
  },
  "auth.email.reset.heading": { id: "Atur ulang kata sandi", en: "Reset your password" },
  "auth.email.reset.body": {
    id: "Halo {name}, kami menerima permintaan untuk mengatur ulang kata sandi Anda. Klik tombol di bawah untuk memilih kata sandi baru.",
    en: "Hi {name}, we received a request to reset your password. Click the button below to choose a new one.",
  },
  "auth.email.reset.cta": { id: "Atur ulang kata sandi", en: "Reset password" },
  "auth.email.linkFallback": {
    id: "Jika tombol tidak berfungsi, salin dan tempel tautan ini ke peramban Anda:",
    en: "If the button doesn't work, copy and paste this link into your browser:",
  },
  "auth.email.expiry": {
    id: "Tautan ini kedaluwarsa dalam {minutes} menit.",
    en: "This link expires in {minutes} minutes.",
  },
  "auth.email.ignore": {
    id: "Jika Anda tidak meminta ini, abaikan email ini dengan aman.",
    en: "If you didn't request this, you can safely ignore this email.",
  },
  "auth.email.signature": { id: "Tim Soechi VMS", en: "The Soechi VMS team" },

  // --- Audit-log module — search/filter viewer over the action-log (M1.4, #8/#23) ---
  "audit.title": { id: "Log Audit", en: "Audit Log" },
  "audit.subtitle": {
    id: "Setiap tindakan dicatat sekali dan tidak pernah diubah — jejak yang hanya bertambah.",
    en: "Every action is recorded once and never edited — an append-only trail.",
  },
  "audit.refresh": { id: "Muat ulang", en: "Refresh" },
  "audit.loading": { id: "Memuat…", en: "Loading…" },
  "audit.empty": { id: "Belum ada tindakan yang tercatat.", en: "No actions recorded yet." },
  "audit.noResults": {
    id: "Tidak ada tindakan yang cocok dengan filter.",
    en: "No actions match these filters.",
  },
  "audit.loadError": {
    id: "Gagal memuat log audit.",
    en: "Couldn't load the audit log.",
  },
  "audit.system": { id: "Sistem", en: "System" },
  "audit.col.time": { id: "Waktu", en: "Time" },
  "audit.col.actor": { id: "Pelaku", en: "Actor" },
  "audit.col.action": { id: "Tindakan", en: "Action" },
  "audit.col.module": { id: "Modul", en: "Module" },
  "audit.col.subject": { id: "Objek", en: "Subject" },
  "audit.col.ip": { id: "Alamat IP", en: "IP address" },

  // Filters
  "audit.filter.actor": { id: "Pelaku", en: "Actor" },
  "audit.filter.actorPlaceholder": { id: "Nama atau email", en: "Name or email" },
  "audit.filter.action": { id: "Tindakan", en: "Action" },
  "audit.filter.actionPlaceholder": { id: "mis. user.signed_in", en: "e.g. user.signed_in" },
  "audit.filter.module": { id: "Modul", en: "Module" },
  "audit.filter.moduleAll": { id: "Semua modul", en: "All modules" },
  "audit.filter.subject": { id: "Objek", en: "Subject" },
  "audit.filter.subjectPlaceholder": { id: "mis. vendor, user", en: "e.g. vendor, user" },
  "audit.filter.from": { id: "Dari", en: "From" },
  "audit.filter.to": { id: "Sampai", en: "To" },
  "audit.filter.apply": { id: "Terapkan", en: "Apply" },
  "audit.filter.clear": { id: "Bersihkan", en: "Clear" },

  // Pagination
  "audit.page.showing": {
    id: "Menampilkan {from}–{to} dari {total}",
    en: "Showing {from}–{to} of {total}",
  },
  "audit.page.prev": { id: "Sebelumnya", en: "Previous" },
  "audit.page.next": { id: "Berikutnya", en: "Next" },
} as const satisfies Record<string, MessageEntry>;

/** Every valid message key — a typo here is a compile error. */
export type MessageKey = keyof typeof catalogue;
