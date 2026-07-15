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
} as const satisfies Record<string, MessageEntry>;

/** Every valid message key — a typo here is a compile error. */
export type MessageKey = keyof typeof catalogue;
