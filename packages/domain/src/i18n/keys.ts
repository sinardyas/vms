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

  // Locality (bank / business-entity legal-form locality — ADR-0006). Same codes as origin, but a
  // distinct label namespace so the master-data screens read on their own terms.
  "enum.locality.local": { id: "Dalam Negeri", en: "Local" },
  "enum.locality.foreign": { id: "Luar Negeri", en: "Foreign" },

  "enum.vendorStatus.draft": { id: "Draf", en: "Draft" },
  "enum.vendorStatus.pending": { id: "Menunggu Persetujuan", en: "Pending" },
  "enum.vendorStatus.pending_hod": { id: "Menunggu Persetujuan HOD", en: "Pending HOD" },
  "enum.vendorStatus.active": { id: "Aktif", en: "Active" },
  "enum.vendorStatus.inactive": { id: "Tidak Aktif", en: "Inactive" },
  "enum.vendorStatus.blacklisted": { id: "Masuk Daftar Hitam", en: "Blacklisted" },

  "enum.verifyStatus.pending": { id: "Menunggu Verifikasi", en: "Pending" },
  "enum.verifyStatus.verified": { id: "Terverifikasi", en: "Verified" },
  "enum.verifyStatus.rejected": { id: "Ditolak", en: "Rejected" },

  // Taxation status (drift-audit #4 P0) — the portal's "Status Perpajakan" set (M3.5).
  "enum.taxStatus.pkp_corporate": { id: "PKP – Badan", en: "PKP – Corporate" },
  "enum.taxStatus.pkp_individual": { id: "PKP – Perorangan", en: "PKP – Individual" },
  "enum.taxStatus.non_pkp_corporate": { id: "Non-PKP – Badan", en: "Non-PKP – Corporate" },
  "enum.taxStatus.non_pkp_individual": { id: "Non-PKP – Perorangan", en: "Non-PKP – Individual" },

  // NPWP sub-type (drift-audit #4).
  "enum.npwpType.personal": { id: "Perorangan", en: "Personal" },
  "enum.npwpType.head_office": { id: "Kantor Pusat", en: "Head Office" },
  "enum.npwpType.branch": { id: "Cabang", en: "Branch" },

  // Company scale per SIUP (drift-audit #4 P1).
  "enum.companyScale.kecil": { id: "Kecil", en: "Small" },
  "enum.companyScale.menengah": { id: "Menengah", en: "Medium" },
  "enum.companyScale.besar": { id: "Besar", en: "Large" },

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

  // --- RBAC verb labels (the 5 permission columns, ADR-0011). ---
  "enum.rbacVerb.add": { id: "Tambah", en: "Add" },
  "enum.rbacVerb.edit": { id: "Ubah", en: "Edit" },
  "enum.rbacVerb.delete": { id: "Hapus", en: "Delete" },
  "enum.rbacVerb.view": { id: "Lihat", en: "View" },
  "enum.rbacVerb.approve": { id: "Setujui", en: "Approve" },

  // --- Access admin — the M1.5 console screen (#24): Users/Roles CRUD + RBAC matrix editor. ---
  "access.title": { id: "Kontrol Akses", en: "Access Control" },
  "access.subtitle": {
    id: "Kelola pengguna, peran, dan matriks izin RBAC (9 modul × 5 verba).",
    en: "Manage users, roles, and the RBAC permission matrix (9 modules × 5 verbs).",
  },
  "access.tab.roles": { id: "Peran", en: "Roles" },
  "access.tab.users": { id: "Pengguna", en: "Users" },
  "access.loading": { id: "Memuat…", en: "Loading…" },
  "access.loadError": { id: "Gagal memuat data akses.", en: "Couldn't load access data." },
  "access.saveError": { id: "Gagal menyimpan perubahan.", en: "Couldn't save the change." },
  "access.retry": { id: "Coba lagi", en: "Retry" },
  "access.cancel": { id: "Batal", en: "Cancel" },
  "access.save": { id: "Simpan", en: "Save" },
  "access.saving": { id: "Menyimpan…", en: "Saving…" },

  // Roles tab
  "access.roles.new": { id: "Peran baru", en: "New role" },
  "access.roles.empty": { id: "Belum ada peran.", en: "No roles yet." },
  "access.roles.col.role": { id: "Peran", en: "Role" },
  "access.roles.col.code": { id: "Kode", en: "Code" },
  "access.roles.col.lead": { id: "Ketua", en: "Lead" },
  "access.roles.col.users": { id: "Pengguna", en: "Users" },
  "access.roles.col.status": { id: "Status", en: "Status" },
  "access.roles.col.actions": { id: "Tindakan", en: "Actions" },
  "access.roles.edit": { id: "Ubah", en: "Edit" },
  "access.roles.deactivate": { id: "Nonaktifkan", en: "Deactivate" },
  "access.roles.reactivate": { id: "Aktifkan", en: "Reactivate" },
  "access.roles.createTitle": { id: "Peran baru", en: "New role" },
  "access.roles.editTitle": { id: "Ubah peran", en: "Edit role" },
  "access.roles.field.code": { id: "Kode (netral bahasa)", en: "Code (language-neutral)" },
  "access.roles.field.code.helper": {
    id: "Kunci stabil, mis. document_verifier. Tidak dapat diubah setelah dibuat.",
    en: "Stable key, e.g. document_verifier. Cannot be changed after creation.",
  },
  "access.roles.field.nameId": { id: "Nama (Indonesia)", en: "Name (Indonesian)" },
  "access.roles.field.nameEn": { id: "Nama (Inggris)", en: "Name (English)" },
  "access.roles.field.lead": {
    id: "Ketua peran (dispatch otomatis)",
    en: "Role lead (auto-dispatch)",
  },
  "access.roles.field.lead.none": { id: "Tanpa ketua", en: "No lead" },
  "access.roles.matrix": { id: "Matriks izin", en: "Permission matrix" },
  "access.roles.matrix.module": { id: "Modul", en: "Module" },

  // Users tab
  "access.users.new": { id: "Pengguna baru", en: "New user" },
  "access.users.empty": { id: "Belum ada pengguna.", en: "No users yet." },
  "access.users.col.name": { id: "Nama", en: "Name" },
  "access.users.col.email": { id: "Email", en: "Email" },
  "access.users.col.kind": { id: "Jenis", en: "Kind" },
  "access.users.col.roles": { id: "Peran", en: "Roles" },
  "access.users.col.status": { id: "Status", en: "Status" },
  "access.users.col.actions": { id: "Tindakan", en: "Actions" },
  "access.users.edit": { id: "Ubah", en: "Edit" },
  "access.users.resetPassword": { id: "Atur ulang sandi", en: "Reset password" },
  "access.users.deactivate": { id: "Nonaktifkan", en: "Deactivate" },
  "access.users.reactivate": { id: "Aktifkan", en: "Reactivate" },
  "access.users.createTitle": { id: "Pengguna internal baru", en: "New internal user" },
  "access.users.editTitle": { id: "Ubah pengguna", en: "Edit user" },
  "access.users.field.email": { id: "Email", en: "Email" },
  "access.users.field.name": { id: "Nama lengkap", en: "Full name" },
  "access.users.field.roles": { id: "Peran", en: "Roles" },
  "access.users.createHint": {
    id: "Pengguna dibuat sebagai staf internal dan menerima email untuk menetapkan kata sandinya.",
    en: "The user is created as internal staff and receives an email to set their password.",
  },
  "access.users.resetSent": {
    id: "Email atur ulang kata sandi dikirim ke {email}.",
    en: "A password-reset email was sent to {email}.",
  },
  "access.users.created": { id: "Pengguna {email} dibuat.", en: "User {email} created." },
  "access.status.active": { id: "Aktif", en: "Active" },
  "access.status.inactive": { id: "Nonaktif", en: "Inactive" },
  "access.kind.internal": { id: "Internal", en: "Internal" },
  "access.kind.vendor": { id: "Vendor", en: "Vendor" },

  // Deadlock guard (ADR-0011b): warn before a save that would leave zero eligible approvers.
  "access.deadlock.warning": {
    id: "Perubahan ini membuat tidak ada pengguna aktif yang memegang izin persetujuan wajib: {capabilities}. Tetap simpan?",
    en: "This change leaves no active user holding a required approval permission: {capabilities}. Save anyway?",
  },
  "access.deadlock.confirm": { id: "Tetap simpan", en: "Save anyway" },
  "access.deadlock.title": { id: "Peringatan kebuntuan", en: "Deadlock warning" },
  "access.eligibility.holders": {
    id: "{count} pengguna aktif memegang izin ini",
    en: "{count} active users hold this permission",
  },

  // API-surfaced access errors (over the shared DomainError codes).
  "access.error.notFound": {
    id: "Data akses tidak ditemukan.",
    en: "That access record was not found.",
  },
  "access.error.codeTaken": {
    id: "Kode peran sudah digunakan.",
    en: "That role code is already in use.",
  },
  "access.error.emailTaken": {
    id: "Email sudah terdaftar.",
    en: "That email is already registered.",
  },
  "access.error.vendorRoleGrant": {
    id: "Peran hanya dapat diberikan kepada pengguna internal.",
    en: "Roles can only be granted to internal users.",
  },

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

  // --- Master-data framework — the shared errors every M2 master-list CRUD returns (M2.1, #32). ---
  "master.error.notFound": {
    id: "Data master tidak ditemukan.",
    en: "The master record was not found.",
  },
  "master.error.codeTaken": {
    id: "Kode ini sudah dipakai oleh data master lain.",
    en: "This code is already used by another master record.",
  },

  // --- Registration lists console (M2.2, #33) — the 5 dropdown masters vendor registration reads. ---
  "regLists.title": { id: "Data Master", en: "Master Data" },
  "regLists.subtitle": {
    id: "Daftar registrasi yang dibaca formulir pendaftaran vendor. Menonaktifkan sebuah baris menyembunyikannya dari pendaftaran baru tanpa memutus referensi yang sudah ada.",
    en: "The registration lists the vendor form reads. Deactivating a row hides it from new registrations without breaking existing references.",
  },
  "regLists.loading": { id: "Memuat…", en: "Loading…" },
  "regLists.loadError": { id: "Gagal memuat daftar.", en: "Failed to load the list." },
  "regLists.empty": { id: "Belum ada data.", en: "No records yet." },
  "regLists.new": { id: "Tambah", en: "Add" },
  "regLists.edit": { id: "Ubah", en: "Edit" },
  "regLists.deactivate": { id: "Nonaktifkan", en: "Deactivate" },
  "regLists.reactivate": { id: "Aktifkan", en: "Reactivate" },
  "regLists.save": { id: "Simpan", en: "Save" },
  "regLists.saving": { id: "Menyimpan…", en: "Saving…" },
  "regLists.saved": { id: "Tersimpan", en: "Saved" },
  "regLists.saveError": {
    id: "Gagal menyimpan. Coba lagi.",
    en: "Could not save. Please try again.",
  },
  "regLists.cancel": { id: "Batal", en: "Cancel" },
  "regLists.status.active": { id: "Aktif", en: "Active" },
  "regLists.status.inactive": { id: "Tidak Aktif", en: "Inactive" },
  "regLists.col.status": { id: "Status", en: "Status" },
  "regLists.col.actions": { id: "Aksi", en: "Actions" },
  "regLists.createTitle": { id: "Tambah {list}", en: "Add {list}" },
  "regLists.editTitle": { id: "Ubah {list}", en: "Edit {list}" },

  // The five lists (tab + singular name interpolated into the dialog titles).
  "regLists.tab.businessEntities": { id: "Badan Usaha", en: "Business Entity" },
  "regLists.tab.vendorCategories": { id: "Kategori Vendor", en: "Vendor Category" },
  "regLists.tab.banks": { id: "Bank", en: "Bank" },
  "regLists.tab.currencies": { id: "Mata Uang", en: "Currency" },
  "regLists.tab.countries": { id: "Negara", en: "Country" },

  // Field / column labels shared across the lists.
  "regLists.f.nameId": { id: "Nama (ID)", en: "Name (ID)" },
  "regLists.f.nameEn": { id: "Nama (EN)", en: "Name (EN)" },
  "regLists.f.name": { id: "Nama", en: "Name" },
  "regLists.f.code": { id: "Kode", en: "Code" },
  "regLists.f.category": { id: "Kategori", en: "Category" },
  "regLists.f.location": { id: "Lokasi", en: "Location" },
  "regLists.f.country": { id: "Negara", en: "Country" },
  "regLists.f.countryNone": { id: "— Tidak ada —", en: "— None —" },
  "regLists.f.iso3": { id: "Kode ISO-3", en: "ISO-3 code" },
  "regLists.f.showInBankSelector": {
    id: "Tampilkan di pemilih mata uang bank",
    en: "Show in bank currency selector",
  },

  // --- Operational Lists console (M2.5, #36) — the six behaviorally-inert reference lists. ---
  // Reuses the generic `regLists.*` chrome (loading/save/edit/status/actions); adds only its own
  // title, subtitle, tabs, and the fields the registration lists don't have.
  "opsLists.title": { id: "Daftar Operasional", en: "Operational Lists" },
  "opsLists.subtitle": {
    id: "Daftar referensi operasional yang dikelola di Fase-0 namun belum digunakan oleh proses apa pun (ADR-0002). Ambang SLA disimpan sebagai konfigurasi yang tidak aktif — tidak ada pengatur waktu langsung di Fase-0.",
    en: "Operational reference lists managed in Phase-0 but not yet acted on by any workflow (ADR-0002). SLA thresholds are stored as inert config — no live timers run in Phase-0.",
  },
  "opsLists.slaInert": {
    id: "Konfigurasi tidak aktif: ambang SLA disimpan tetapi tidak ditegakkan di Fase-0.",
    en: "Inert config: SLA thresholds are stored but not enforced in Phase-0.",
  },

  // Tabs (singular list names).
  "opsLists.tab.departments": { id: "Departemen", en: "Department" },
  "opsLists.tab.soechiEntities": { id: "Entitas Soechi", en: "Soechi Entity" },
  "opsLists.tab.vessels": { id: "Kapal", en: "Vessel" },
  "opsLists.tab.ports": { id: "Pelabuhan", en: "Port" },
  "opsLists.tab.taxCodes": { id: "Kode Pajak", en: "Tax Code" },
  "opsLists.tab.slaThresholds": { id: "Ambang SLA", en: "SLA Threshold" },

  // Fields / columns specific to the operational lists.
  "opsLists.f.vesselType": { id: "Jenis Kapal", en: "Vessel type" },
  "opsLists.f.tz": { id: "Zona Waktu", en: "Time zone" },
  "opsLists.f.lat": { id: "Lintang", en: "Latitude" },
  "opsLists.f.lon": { id: "Bujur", en: "Longitude" },
  "opsLists.f.label": { id: "Label", en: "Label" },
  "opsLists.f.labelId": { id: "Label (ID)", en: "Label (ID)" },
  "opsLists.f.labelEn": { id: "Label (EN)", en: "Label (EN)" },
  "opsLists.f.rate": { id: "Tarif", en: "Rate" },
  "opsLists.f.basis": { id: "Dasar", en: "Basis" },
  "opsLists.f.appliesTo": { id: "Berlaku Untuk", en: "Applies to" },
  "opsLists.f.stage": { id: "Tahap", en: "Stage" },
  "opsLists.f.stageId": { id: "Tahap (ID)", en: "Stage (ID)" },
  "opsLists.f.stageEn": { id: "Tahap (EN)", en: "Stage (EN)" },
  "opsLists.f.target": { id: "Target", en: "Target" },
  "opsLists.f.warnAt": { id: "Peringatan Pada", en: "Warn at" },
  "opsLists.f.email": { id: "Notifikasi Email", en: "Email notification" },

  // --- Document Master origin applicability (ADR-0013). ---
  "enum.appliesTo.local": { id: "Dalam Negeri", en: "Local" },
  "enum.appliesTo.foreign": { id: "Luar Negeri", en: "Foreign" },
  "enum.appliesTo.both": { id: "Keduanya", en: "Both" },

  // --- Document Master console (M2.3, #34) — compliance doc types + the category matrix. ---
  "docMaster.title": { id: "Master Dokumen", en: "Document Master" },
  "docMaster.subtitle": {
    id: "Jenis dokumen kepatuhan yang diminta dari vendor dan matriks persyaratan per kategori yang dievaluasi oleh gerbang aktivasi. Menonaktifkan dokumen berarti dokumen itu tidak lagi diminta dari vendor.",
    en: "The compliance document types requested from vendors and the per-category requirements matrix the activation gate evaluates. Disabling a document stops it being requested from vendors.",
  },
  "docMaster.doc": { id: "Dokumen", en: "Document" },
  "docMaster.tab.documents": { id: "Master Dokumen", en: "Document Master" },
  "docMaster.tab.requirements": { id: "Persyaratan Kategori", en: "Category Requirements" },

  // Document field / column labels.
  "docMaster.f.no": { id: "No.", en: "No." },
  "docMaster.f.name": { id: "Nama Dokumen", en: "Document Name" },
  "docMaster.f.type": { id: "Jenis", en: "Type" },
  "docMaster.f.appliesTo": { id: "Berlaku Untuk", en: "Applies To" },
  "docMaster.f.validityDays": { id: "Masa Berlaku (hari)", en: "Validity (days)" },
  "docMaster.f.mandatory": { id: "Wajib", en: "Mandatory" },
  "docMaster.f.reminder": { id: "Pengingat", en: "Reminder" },
  "docMaster.badge.mandatory": { id: "Wajib", en: "Mandatory" },
  "docMaster.badge.optional": { id: "Opsional", en: "Optional" },

  // Category-requirements matrix.
  "docMaster.matrix.title": {
    id: "Matriks Persyaratan Kategori",
    en: "Category Requirements Matrix",
  },
  "docMaster.matrix.subtitle": {
    id: "Petakan jenis dokumen mana yang diwajibkan setiap kategori vendor. Kumpulan wajib vendor = dokumen asal ∪ dokumen kategori tunggalnya. Klik sel untuk berpindah antara Tidak diperlukan → Wajib → Opsional.",
    en: "Map which document types each vendor category requires. A vendor's required set = origin documents ∪ its single category's documents. Click a cell to cycle Not required → Mandatory → Optional.",
  },
  "docMaster.matrix.docColumn": { id: "Dokumen", en: "Document" },
  "docMaster.matrix.noCategories": {
    id: "Belum ada kategori vendor aktif. Tambahkan kategori di Data Master dahulu.",
    en: "No active vendor categories yet. Add categories in Master Data first.",
  },
  "docMaster.matrix.noDocuments": {
    id: "Belum ada dokumen. Tambahkan dokumen di tab Master Dokumen dahulu.",
    en: "No documents yet. Add documents in the Document Master tab first.",
  },
  "docMaster.matrix.cell.none": { id: "—", en: "—" },
  "docMaster.matrix.cell.mandatory": { id: "W", en: "M" },
  "docMaster.matrix.cell.optional": { id: "O", en: "O" },
  "docMaster.matrix.legend.mandatory": { id: "W = Wajib", en: "M = Mandatory" },
  "docMaster.matrix.legend.optional": { id: "O = Opsional", en: "O = Optional" },
  "docMaster.matrix.legend.none": { id: "— = Tidak diperlukan", en: "— = Not required" },

  // --- Approval triggers (ADR-0005, 0009) — what an ApprovalRequest / route is about. ---
  "enum.approvalTrigger.new_vendor_registration": {
    id: "Pendaftaran Vendor Baru (Mandiri)",
    en: "New Vendor Registration (Self)",
  },
  "enum.approvalTrigger.office_vendor_registration": {
    id: "Pendaftaran Vendor oleh Kantor",
    en: "Office Vendor Registration",
  },
  "enum.approvalTrigger.bank_change": { id: "Perubahan Bank", en: "Bank Change" },
  "enum.approvalTrigger.non_bank_change": {
    id: "Perubahan Data Non-Bank",
    en: "Non-Bank Change",
  },
  "enum.approvalTrigger.reactivation": { id: "Reaktivasi Vendor", en: "Vendor Reactivation" },

  // --- Approval Routes console (M2.4, #35, ADR-0009/0011) — the trigger→ordered-steps routing table. ---
  "approvalRoutes.title": { id: "Rute Persetujuan", en: "Approval Routes" },
  "approvalRoutes.subtitle": {
    id: "Tabel rute yang diselesaikan mesin alur kerja berdasarkan pemicu. Setiap langkah memberi keputusan pada satu peran; menyimpan rute yang menyisakan langkah tanpa penyetuju yang memenuhi syarat akan diperingatkan.",
    en: "The routing table the workflow engine resolves by trigger. Each step is decided by one role; saving a route that leaves a step with no eligible approver is warned.",
  },
  "approvalRoutes.col.trigger": { id: "Pemicu", en: "Trigger" },
  "approvalRoutes.col.name": { id: "Nama Rute", en: "Route name" },
  "approvalRoutes.col.steps": { id: "Langkah (berurutan)", en: "Steps (in order)" },
  "approvalRoutes.stepsNone": { id: "Belum ada langkah", en: "No steps yet" },
  "approvalRoutes.editSteps": { id: "Ubah langkah", en: "Edit steps" },
  "approvalRoutes.stepsTitle": { id: "Langkah untuk {route}", en: "Steps for {route}" },
  "approvalRoutes.stepN": { id: "Langkah {n}", en: "Step {n}" },
  "approvalRoutes.stepRole": { id: "Peran penyetuju", en: "Approver role" },
  "approvalRoutes.addStep": { id: "Tambah langkah", en: "Add step" },
  "approvalRoutes.removeStep": { id: "Hapus", en: "Remove" },
  "approvalRoutes.moveUp": { id: "Naik", en: "Move up" },
  "approvalRoutes.moveDown": { id: "Turun", en: "Move down" },
  "approvalRoutes.rolePlaceholder": { id: "— Pilih peran —", en: "— Select role —" },
  "approvalRoutes.needStep": {
    id: "Rute butuh minimal satu langkah.",
    en: "A route needs at least one step.",
  },
  // Deadlock guard on save (ADR-0011): a step whose role has no eligible approver strands the route.
  "approvalRoutes.deadlock.warning": {
    id: "Menyimpan rute ini menyisakan peran langkah tanpa penyetuju aktif yang memenuhi syarat: {roles}. Rute tidak dapat diselesaikan sampai peran itu memiliki penyetuju. Tetap simpan?",
    en: "Saving this route leaves step role(s) with no eligible active approver: {roles}. The route can't be resolved until those roles have an approver. Save anyway?",
  },
  "approvalRoutes.deadlock.confirm": { id: "Tetap simpan", en: "Save anyway" },
  "approvalRoutes.deadlock.title": { id: "Peringatan kebuntuan", en: "Deadlock warning" },

  // --- Bank accounts + attachments (M3.2, #43, ADR-0013) ---
  // Holder-proof invariant: when the account holder is not the company, KTP + surat are required.
  "error.bank.holderProofRequired": {
    id: "Pemilik rekening bukan perusahaan: KTP pemilik dan surat pernyataan wajib dilampirkan.",
    en: "The account holder is not the company: the holder's KTP and a surat pernyataan are required.",
  },
  // Out-of-country account: a remark is required when the bank's country differs from the vendor's.
  "error.bank.countryRemarkRequired": {
    id: "Negara bank berbeda dari negara vendor: keterangan wajib diisi.",
    en: "The bank's country differs from the vendor's: a remark is required.",
  },
  // Upload validation (validated, not gated).
  "error.file.badType": {
    id: "Tipe berkas tidak didukung. Diperbolehkan: {allowed}.",
    en: "Unsupported file type. Allowed: {allowed}.",
  },
  "error.file.empty": { id: "Berkas kosong.", en: "The file is empty." },
  "error.file.tooLarge": {
    id: "Ukuran berkas melebihi batas {maxMb} MB.",
    en: "The file exceeds the {maxMb} MB limit.",
  },
  "error.file.storeFailed": {
    id: "Gagal menyimpan berkas.",
    en: "Failed to store the file.",
  },

  // --- Compliance document capture (M3.3, #44, ADR-0011/0013) ---
  // Upload named a document type that isn't in the Document Master.
  "error.document.masterUnknown": {
    id: "Tipe dokumen tidak dikenal.",
    en: "Unknown document type.",
  },

  // --- Shared submit gate (M3.4, #45, ADR-0004) — surfaced by the portal + office API alike. ---
  // Top-level 422 when a Draft isn't complete enough to submit; per-blocker details ride in `details`.
  "error.vendor.notSubmittable": {
    id: "Pendaftaran belum dapat dikirim — sebagian data wajib masih kurang.",
    en: "The registration can't be submitted yet — some required information is missing.",
  },
  // A required profile field is empty at submit (the field is named by the issue's `path`).
  "error.vendor.fieldRequired": {
    id: "Kolom ini wajib diisi sebelum mengirim.",
    en: "This field is required before submitting.",
  },
  // A vendor must have at least one bank account to be submitted (so it is payable once active).
  "error.vendor.bankRequired": {
    id: "Minimal satu rekening bank wajib diisi sebelum mengirim.",
    en: "At least one bank account is required before submitting.",
  },
  // Exactly one bank must be the primary (Bank Utama); found a different count.
  "error.vendor.bankPrimaryOne": {
    id: "Tepat satu rekening utama wajib ditetapkan (ditemukan {count}).",
    en: "Exactly one primary bank account is required (found {count}).",
  },
  // A mandatory document type has no uploaded version yet (the doc type is named by the issue's `path`).
  "error.vendor.documentMissing": {
    id: "Dokumen wajib ini belum diunggah.",
    en: "This required document has not been uploaded yet.",
  },

  // --- Vendor aggregate + submit endpoint (M3.5, #46, ADR-0004/0010) ---
  // Submit blocked because the Tax ID (NPWP) is already held by a non-Draft vendor (partial-unique).
  // Friendly + actionable, no PII about the other record (ADR-0004): sign in or contact support.
  "error.vendor.taxIdDuplicate": {
    id: "NPWP/Tax ID ini sudah terdaftar. Jika ini perusahaan Anda, silakan masuk dengan akun yang ada atau hubungi tim pengadaan.",
    en: "This Tax ID (NPWP) is already registered. If this is your company, sign in with the existing account or contact procurement.",
  },
  // A vendor-kind user tried to reach a vendor record they don't own (own-vendor scoping).
  "error.vendor.notOwner": {
    id: "Anda tidak memiliki akses ke data vendor ini.",
    en: "You don't have access to this vendor record.",
  },
  // Edit/submit attempted on a vendor that has already left Draft (only Drafts are editable here).
  "error.vendor.notDraft": {
    id: "Pendaftaran ini bukan lagi Draft dan tidak dapat diubah di sini.",
    en: "This registration is no longer a Draft and can't be changed here.",
  },
  // A vendor-kind user who already owns a registration tried to start a second one (single-owner).
  "error.vendor.alreadyRegistered": {
    id: "Akun Anda sudah memiliki pendaftaran vendor — lanjutkan yang sudah ada.",
    en: "Your account already has a vendor registration — continue the existing one.",
  },

  // --- Approval workflow engine (M4.2, #57, ADR-0005/0012) ---
  // A decision was attempted on a request that is no longer Pending (already approved/rejected/recalled).
  "error.approval.notPending": {
    id: "Permintaan persetujuan ini sudah selesai dan tidak dapat diputuskan lagi.",
    en: "This approval request is already resolved and can no longer be decided.",
  },
  // Reject requires a reason so the submitter knows what to fix on resume (ADR-0005: reject with reasons).
  "error.approval.reasonRequired": {
    id: "Alasan penolakan wajib diisi.",
    en: "A reason is required to reject.",
  },
  // Reassign targeted a step that isn't the request's current open step (already decided or not reached).
  "error.approval.stepNotActionable": {
    id: "Langkah ini bukan langkah aktif yang sedang menunggu keputusan.",
    en: "This step is not the current step awaiting a decision.",
  },

  // --- Portal UI chrome (M3.5, #46) — bilingual labels for the self-registration portal. ---
  "portal.shell.subtitle": { id: "Portal Vendor", en: "Vendor Portal" },
  "portal.nav.dashboard": { id: "Beranda", en: "Dashboard" },
  "portal.nav.registration": { id: "Pendaftaran Saya", en: "My Registration" },
  "portal.nav.documents": { id: "Dokumen", en: "Documents" },

  "portal.common.save": { id: "Simpan", en: "Save" },
  "portal.common.saveDraft": { id: "Simpan draft", en: "Save draft" },
  "portal.common.continue": { id: "Lanjut", en: "Continue" },
  "portal.common.back": { id: "Kembali", en: "Back" },
  "portal.common.cancel": { id: "Batal", en: "Cancel" },
  "portal.common.add": { id: "Tambah", en: "Add" },
  "portal.common.remove": { id: "Hapus", en: "Remove" },
  "portal.common.edit": { id: "Ubah", en: "Edit" },
  "portal.common.optional": { id: "Opsional", en: "Optional" },
  "portal.common.loading": { id: "Memuat…", en: "Loading…" },
  "portal.common.saved": { id: "Tersimpan", en: "Saved" },
  "portal.common.yes": { id: "Ya", en: "Yes" },
  "portal.common.no": { id: "Tidak", en: "No" },
  "portal.common.select": { id: "Pilih…", en: "Select…" },

  "portal.auth.signInTitle": { id: "Masuk ke Portal Vendor", en: "Sign in to the Vendor Portal" },
  "portal.auth.signInSubtitle": {
    id: "Kelola pendaftaran dan dokumen perusahaan Anda.",
    en: "Manage your company's registration and documents.",
  },
  "portal.auth.email": { id: "Email", en: "Email" },
  "portal.auth.password": { id: "Kata sandi", en: "Password" },
  "portal.auth.confirmPassword": { id: "Konfirmasi kata sandi", en: "Confirm password" },
  "portal.auth.name": { id: "Nama Anda", en: "Your name" },
  "portal.auth.signIn": { id: "Masuk", en: "Sign in" },
  "portal.auth.signOut": { id: "Keluar", en: "Sign out" },
  "portal.auth.newVendor": { id: "Vendor baru?", en: "New vendor?" },
  "portal.auth.registerHere": { id: "Daftar di sini", en: "Register here" },
  "portal.auth.registerTitle": { id: "Buat akun vendor", en: "Create a vendor account" },
  "portal.auth.registerSubtitle": {
    id: "Email ini menjadi nama pengguna Anda dan tidak dapat diubah.",
    en: "This email becomes your username and cannot be changed later.",
  },
  "portal.auth.createAccount": { id: "Buat akun", en: "Create account" },
  "portal.auth.backToSignIn": { id: "Kembali ke halaman masuk", en: "Back to sign in" },
  "portal.auth.verifyTitle": { id: "Periksa email Anda", en: "Check your email" },
  "portal.auth.verifyBody": {
    id: "Kami mengirim tautan verifikasi ke email Anda. Buka tautan itu, lalu masuk untuk melanjutkan pendaftaran.",
    en: "We've sent a verification link to your email. Open it, then sign in to continue your registration.",
  },
  "portal.auth.heroTitle": { id: "Manajemen Vendor Soechi", en: "Soechi Vendor Management" },
  "portal.auth.heroBody": {
    id: "Satu sistem, dua ruang kerja — daftar, unggah dokumen, dan pantau kualifikasi Anda.",
    en: "One system, two workspaces — register, upload documents, and track your qualification.",
  },
  "portal.auth.signInError": {
    id: "Email atau kata sandi salah, atau email belum diverifikasi.",
    en: "Wrong email or password, or the email isn't verified yet.",
  },
  "portal.auth.signUpError": {
    id: "Tidak dapat membuat akun. Coba lagi.",
    en: "Couldn't create the account. Please try again.",
  },
  "portal.auth.passwordMismatch": {
    id: "Konfirmasi kata sandi tidak cocok.",
    en: "Password confirmation doesn't match.",
  },
  "portal.auth.passwordTooShort": {
    id: "Kata sandi minimal 8 karakter.",
    en: "Password must be at least 8 characters.",
  },

  "portal.reg.startTitle": { id: "Mulai pendaftaran vendor", en: "Start your vendor registration" },
  "portal.reg.startBody": {
    id: "Pilih asal perusahaan Anda untuk membuat draft. Anda dapat keluar dan melanjutkannya kapan saja.",
    en: "Choose your company's origin to create a draft. You can leave and resume it anytime.",
  },
  "portal.reg.originQuestion": { id: "Asal vendor", en: "Vendor origin" },
  "portal.reg.originLocalHint": {
    id: "PT / CV · NPWP, NIB · PPN 11% + PPh 23",
    en: "PT / CV · NPWP, NIB · VAT 11% + WHT 23",
  },
  "portal.reg.originForeignHint": {
    id: "Berbadan hukum di luar negeri · Form DGT · PPh 26",
    en: "Incorporated abroad · Form DGT · WHT 26",
  },
  "portal.reg.companyName": { id: "Nama perusahaan", en: "Company name" },
  "portal.reg.create": { id: "Buat draft", en: "Create draft" },
  "portal.reg.title": { id: "Pendaftaran Vendor", en: "Vendor Registration" },
  "portal.reg.stepsTitle": { id: "Langkah pendaftaran", en: "Onboarding steps" },
  "portal.reg.stepOf": { id: "Langkah {n} dari {total}", en: "Step {n} of {total}" },
  "portal.reg.draftSaved": { id: "Draft tersimpan.", en: "Draft saved." },

  "portal.step.company": { id: "Informasi Perusahaan", en: "Company Information" },
  "portal.step.companySub": { id: "Detail & PIC", en: "Details & PIC" },
  "portal.step.bank": { id: "Pembayaran & Bank", en: "Payment & Bank" },
  "portal.step.bankSub": { id: "Termin & rekening", en: "Terms & account" },
  "portal.step.documents": { id: "Dokumen", en: "Documents" },
  "portal.step.documentsSub": { id: "Unggah berkas", en: "Upload files" },
  "portal.step.review": { id: "Tinjau & Kirim", en: "Review & Submit" },
  "portal.step.reviewSub": { id: "Kirim untuk kualifikasi", en: "Submit for qualification" },

  "portal.section.identity": { id: "Identitas & Pajak", en: "Identity & Tax" },
  "portal.section.address": { id: "Alamat", en: "Address" },
  "portal.section.people": { id: "Kontak & PIC", en: "Contacts & PIC" },
  "portal.section.payment": { id: "Termin Pembayaran", en: "Payment Terms" },

  "portal.field.name": { id: "Nama perusahaan", en: "Company name" },
  "portal.field.businessEntity": { id: "Badan usaha", en: "Business entity" },
  "portal.field.category": { id: "Klasifikasi", en: "Classification" },
  "portal.field.taxId": { id: "NPWP / Tax ID", en: "NPWP / Tax ID" },
  "portal.field.taxStatus": { id: "Status pajak", en: "Tax status" },
  "portal.field.npwpType": { id: "Jenis NPWP", en: "NPWP type" },
  "portal.field.companyScale": { id: "Skala perusahaan", en: "Company scale" },
  "portal.field.procurementNote": { id: "Pengadaan vendor", en: "Vendor procurement" },
  "portal.field.address": { id: "Alamat", en: "Address" },
  "portal.field.city": { id: "Kota", en: "City" },
  "portal.field.postal": { id: "Kode pos", en: "Postal code" },
  "portal.field.country": { id: "Negara", en: "Country" },
  "portal.field.phone": { id: "No. telepon", en: "Phone no." },
  "portal.field.fax": { id: "Faks", en: "Fax" },
  "portal.field.yearFounded": { id: "Tahun berdiri", en: "Year established" },
  "portal.field.website": { id: "Situs web", en: "Website" },
  "portal.field.email": { id: "Email korespondensi", en: "Correspondence email" },
  "portal.field.commissioner": { id: "Nama komisaris", en: "Commissioner name" },
  "portal.field.director": { id: "Nama direktur", en: "Director name" },
  "portal.field.picName": { id: "PIC (penanggung jawab)", en: "PIC (person in charge)" },
  "portal.field.picRole": { id: "Jabatan PIC", en: "PIC position" },
  "portal.field.picPhone": { id: "No. telepon PIC", en: "PIC phone no." },
  "portal.field.picPhoneHint": { id: "Nomor WhatsApp wajib.", en: "WhatsApp number required." },
  "portal.field.picEmail": { id: "Email PIC", en: "PIC email" },
  "portal.field.soechiReference": {
    id: "Nama referensi (Grup Soechi)",
    en: "Reference name (Soechi Group)",
  },
  "portal.field.paymentTerm": { id: "Termin pembayaran", en: "Payment terms" },
  "portal.field.emailLocked": {
    id: "Email dikunci dari akun Anda.",
    en: "Email is locked from your account.",
  },

  "portal.bank.title": { id: "Rekening Bank", en: "Bank Accounts" },
  "portal.bank.primaryBadge": { id: "Bank Utama", en: "Main Bank" },
  "portal.bank.makePrimary": { id: "Jadikan Bank Utama", en: "Set as Main Bank" },
  "portal.bank.add": { id: "Tambah rekening", en: "Add account" },
  "portal.bank.none": {
    id: "Belum ada rekening. Tambahkan minimal satu untuk mengirim.",
    en: "No accounts yet. Add at least one to submit.",
  },
  "portal.bank.bankName": { id: "Nama bank", en: "Bank name" },
  "portal.bank.accountNo": { id: "Nomor rekening", en: "Account number" },
  "portal.bank.holderName": { id: "Nama pemilik rekening", en: "Account holder name" },
  "portal.bank.branch": { id: "Cabang", en: "Branch" },
  "portal.bank.currency": { id: "Mata uang", en: "Currency" },
  "portal.bank.swift": { id: "Kode SWIFT", en: "SWIFT code" },
  "portal.bank.iban": { id: "IBAN", en: "IBAN" },
  "portal.bank.bankCountry": { id: "Negara bank", en: "Bank country" },
  "portal.bank.description": { id: "Deskripsi", en: "Description" },
  "portal.bank.holderSameQuestion": {
    id: "Apakah nama pemilik rekening sama dengan nama perusahaan?",
    en: "Is the account holder name the same as the company name?",
  },
  "portal.bank.holderSameYes": { id: "Ya, sama dengan perusahaan", en: "Yes, same as company" },
  "portal.bank.holderSameNo": {
    id: "Tidak, rekening pribadi (unggah KTP)",
    en: "No, personal account (upload KTP)",
  },
  "portal.bank.proof": { id: "Bukti rekening (buku tabungan)", en: "Account proof (bank book)" },
  "portal.bank.ktp": { id: "KTP pemilik rekening", en: "Account holder ID card (KTP)" },
  "portal.bank.surat": { id: "Surat pernyataan (bermaterai)", en: "Statement letter (stamped)" },
  "portal.bank.remark": {
    id: "Keterangan (negara bank berbeda)",
    en: "Remark (bank country differs)",
  },

  "portal.doc.title": { id: "Dokumen Kepatuhan", en: "Compliance Documents" },
  "portal.doc.mandatory": { id: "Wajib", en: "Mandatory" },
  "portal.doc.optional": { id: "Opsional", en: "Optional" },
  "portal.doc.browse": { id: "Pilih berkas", en: "Browse" },
  "portal.doc.uploaded": { id: "Terunggah", en: "Uploaded" },
  "portal.doc.replace": { id: "Ganti", en: "Replace" },
  "portal.doc.refNo": { id: "No. dokumen", en: "Document no." },
  "portal.doc.variant": { id: "Jenis / varian", en: "Type / variant" },
  "portal.doc.constraint": {
    id: "PDF, JPG, atau PNG — maks 10 MB.",
    en: "PDF, JPG, or PNG — max 10 MB.",
  },
  "portal.doc.none": {
    id: "Belum ada dokumen wajib untuk klasifikasi ini.",
    en: "No mandatory documents for this classification yet.",
  },

  "portal.review.title": { id: "Tinjau & Kirim", en: "Review & Submit" },
  "portal.review.note": {
    id: "Anda tetap dapat masuk selagi kualifikasi diproses.",
    en: "You can sign in while qualification is pending.",
  },
  "portal.review.complete": { id: "Lengkap", en: "Complete" },
  "portal.review.incomplete": { id: "Belum lengkap", en: "Incomplete" },
  "portal.review.blockersTitle": {
    id: "Lengkapi hal berikut sebelum mengirim:",
    en: "Complete the following before submitting:",
  },
  "portal.review.submit": { id: "Kirim pendaftaran", en: "Submit registration" },
  "portal.review.sectionProfile": { id: "Profil perusahaan", en: "Company profile" },
  "portal.review.sectionBanks": { id: "Rekening bank", en: "Bank accounts" },
  "portal.review.sectionDocuments": { id: "Dokumen", en: "Documents" },

  "portal.status.title": { id: "Status Pendaftaran", en: "Registration Status" },
  "portal.status.draft": { id: "Draft", en: "Draft" },
  "portal.status.pending": { id: "Menunggu Kualifikasi", en: "Pending Qualification" },
  "portal.status.pendingBody": {
    id: "Pendaftaran Anda telah dikirim dan sedang ditinjau oleh tim AP & verifikasi dokumen.",
    en: "Your registration has been submitted and is under review by the AP & document-verification team.",
  },
  "portal.status.draftBody": {
    id: "Pendaftaran Anda masih berupa draft. Lengkapi dan kirim saat siap.",
    en: "Your registration is still a draft. Complete and submit it when ready.",
  },

  // --- Console office registration (M3.6, #47) — staff register a vendor on-behalf → Pending-HOD ---
  "console.vendorReg.landingTitle": {
    id: "Pendaftaran Vendor oleh Kantor",
    en: "Office Vendor Registration",
  },
  "console.vendorReg.landingBody": {
    id: "Daftarkan vendor atas nama mereka menggunakan validasi yang sama dengan portal vendor.",
    en: "Register a vendor on their behalf using the same validation as the vendor portal.",
  },
  "console.vendorReg.hodNotice": {
    id: "Vendor yang didaftarkan oleh staf kantor memerlukan persetujuan Manajer / HOD sebelum diaktifkan.",
    en: "Vendors registered by office staff require Manager / HOD approval before they are activated.",
  },
  "console.vendorReg.registerCta": { id: "Daftarkan vendor", en: "Register vendor" },
  "console.vendorReg.startTitle": { id: "Daftarkan vendor baru", en: "Register a new vendor" },
  "console.vendorReg.startBody": {
    id: "Pilih asal vendor dan nama perusahaan untuk memulai draft, lalu lengkapi profil, bank, dan dokumen.",
    en: "Pick the vendor's origin and company name to start a draft, then complete profile, banks, and documents.",
  },
  "console.vendorReg.create": { id: "Mulai pendaftaran", en: "Start registration" },
  "console.vendorReg.submit": { id: "Kirim untuk persetujuan HOD", en: "Submit for HOD approval" },
  "console.vendorReg.reviewNote": {
    id: "Setelah dikirim, vendor menunggu persetujuan HOD sebelum aktif dan tidak dapat diedit di sini.",
    en: "Once submitted, the vendor awaits HOD approval before activation and can no longer be edited here.",
  },
  "console.vendorReg.successTitle": {
    id: "Terkirim untuk persetujuan HOD",
    en: "Submitted for HOD approval",
  },
  "console.vendorReg.successBody": {
    id: "Vendor telah didaftarkan dan menunggu persetujuan Manajer / HOD sebelum diaktifkan.",
    en: "The vendor has been registered and is awaiting Manager / HOD approval before activation.",
  },
  "console.vendorReg.registerAnother": {
    id: "Daftarkan vendor lain",
    en: "Register another vendor",
  },
  "console.vendorReg.backToStart": { id: "Batalkan", en: "Cancel" },

  // --- Console vendor list + profile (M3.7, #48) — browse vendors, read-only profile tabs ---
  "console.vendorList.title": { id: "Vendor", en: "Vendors" },
  "console.vendorList.subtitle": {
    id: "Master & kategorisasi vendor. Vendor dalam & luar negeri membawa set dokumen berbeda.",
    en: "Vendor master & categorization. Local and foreign vendors carry different document sets.",
  },
  "console.vendorList.searchPlaceholder": {
    id: "Cari vendor — nama, kategori, negara, NPWP, status…",
    en: "Search vendors — name, category, country, tax ID, status…",
  },
  "console.vendorList.colVendor": { id: "Vendor", en: "Vendor" },
  "console.vendorList.colCountry": { id: "Negara", en: "Country" },
  "console.vendorList.colCategory": { id: "Kategori", en: "Category" },
  "console.vendorList.colTaxId": { id: "NPWP / Tax ID", en: "Tax ID" },
  "console.vendorList.colStatus": { id: "Status", en: "Status" },
  "console.vendorList.empty": {
    id: "Belum ada vendor terdaftar.",
    en: "No vendors registered yet.",
  },
  "console.vendorList.noResults": {
    id: "Tidak ada vendor yang cocok dengan pencarian.",
    en: "No vendors match your search.",
  },
  "console.vendorList.loadError": {
    id: "Gagal memuat daftar vendor.",
    en: "Failed to load the vendor list.",
  },
  "console.vendorList.backToList": { id: "Kembali ke daftar", en: "Back to vendors" },
  "console.vendorList.sourceSelf": {
    id: "Pendaftaran mandiri",
    en: "Self-registered",
  },
  "console.vendorList.sourceOffice": {
    id: "Didaftarkan oleh kantor",
    en: "Office-registered",
  },
  "console.vendorProfile.tabDetails": { id: "Detail", en: "Details" },
  "console.vendorProfile.tabDocuments": { id: "Dokumen", en: "Documents" },
  "console.vendorProfile.tabBank": { id: "Bank", en: "Bank" },
  "console.vendorProfile.tabActivity": { id: "Aktivitas", en: "Activity" },
  "console.vendorProfile.loadError": {
    id: "Gagal memuat data vendor.",
    en: "Failed to load vendor data.",
  },
  "console.vendorProfile.noDocuments": {
    id: "Tidak ada dokumen wajib untuk vendor ini.",
    en: "No required documents for this vendor.",
  },
  "console.vendorProfile.docCaptured": { id: "Terunggah", en: "Uploaded" },
  "console.vendorProfile.docMissing": { id: "Belum diunggah", en: "Not uploaded" },
  "console.vendorProfile.docVersion": { id: "Versi {n}", en: "Version {n}" },
  "console.vendorProfile.docPreview": { id: "Pratinjau", en: "Preview" },
  "console.vendorProfile.noBanks": {
    id: "Belum ada rekening bank.",
    en: "No bank accounts yet.",
  },
  "console.vendorProfile.noActivity": {
    id: "Belum ada aktivitas tercatat untuk vendor ini.",
    en: "No activity recorded for this vendor yet.",
  },

  // --- Portal read-only status view (M3.7, #48) — "where's my registration?" ---
  "portal.status.summaryTitle": { id: "Ringkasan pendaftaran", en: "Registration summary" },
  "portal.status.docsTitle": { id: "Dokumen", en: "Documents" },
  "portal.status.banksTitle": { id: "Rekening bank", en: "Bank accounts" },
} as const satisfies Record<string, MessageEntry>;

/** Every valid message key — a typo here is a compile error. */
export type MessageKey = keyof typeof catalogue;
