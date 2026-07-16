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
} as const satisfies Record<string, MessageEntry>;

/** Every valid message key — a typo here is a compile error. */
export type MessageKey = keyof typeof catalogue;
