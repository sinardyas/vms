/**
 * Registration-lists seed (M2.2, #33) — the five master lists vendor registration reads its dropdowns
 * from, loaded so a fresh `docker compose up` lands testers on populated selects. Folds in the drift
 * audit (#4) + seed-matrix (#10) reconciliations:
 *
 *   - **SEED-1** — all **15** vendor categories (bilingual), not the prototype's 4-item subset.
 *   - **SEED-4** — currencies use **CNY** (ISO-4217), never `CNH`; `showInBankSelector` is set for the
 *     bank-usable set (IDR/USD/SGD/CNY/EUR/JPY) and off for the rest of the reference list.
 *   - **SEED-5** — business entities in one canonical **title-case**, bilingual `name_id` / `name_en`.
 *
 * Idempotent (re-runnable on every boot): the code-keyed lists (countries by `iso3`, currencies by
 * `code`, banks by `code`) upsert on their unique index; the two bilingual-term lists have no unique
 * column, so they upsert by matching `name_en` — insert when absent, refresh the label + reactivate
 * when present. Deactivations a tester makes in the console are **not** undone for the code-keyed
 * lists' *labels* only — re-seeding sets `active: true`, which is the intended "seed activates every
 * row it references" rule (seed-matrix §0). Banks resolve their `country_id` from the seeded countries.
 */

import { eq } from "drizzle-orm";
import type { DB } from "../index";
import { banks, businessEntities, countries, currencies, vendorCategories } from "../schema/master-data";

/* ── Countries (ISO-3166 alpha-3) — Indonesia + Singapore + China + trade partners ── */

/** `[name, iso3]` — the reference country list (from the prototype console master). */
export const COUNTRY_SEED: readonly (readonly [string, string])[] = [
  ["Afghanistan", "AFG"], ["Albania", "ALB"], ["Algeria", "DZA"], ["Angola", "AGO"],
  ["Argentina", "ARG"], ["Australia", "AUS"], ["Austria", "AUT"], ["Bahrain", "BHR"],
  ["Bangladesh", "BGD"], ["Belgium", "BEL"], ["Brazil", "BRA"], ["Brunei", "BRN"],
  ["Bulgaria", "BGR"], ["Cambodia", "KHM"], ["Canada", "CAN"], ["Chile", "CHL"],
  ["China", "CHN"], ["Colombia", "COL"], ["Croatia", "HRV"], ["Cyprus", "CYP"],
  ["Czechia", "CZE"], ["Denmark", "DNK"], ["Ecuador", "ECU"], ["Egypt", "EGY"],
  ["Estonia", "EST"], ["Finland", "FIN"], ["France", "FRA"], ["Germany", "DEU"],
  ["Ghana", "GHA"], ["Greece", "GRC"], ["Hong Kong", "HKG"], ["Hungary", "HUN"],
  ["Iceland", "ISL"], ["India", "IND"], ["Indonesia", "IDN"], ["Iran", "IRN"],
  ["Iraq", "IRQ"], ["Ireland", "IRL"], ["Israel", "ISR"], ["Italy", "ITA"],
  ["Japan", "JPN"], ["Jordan", "JOR"], ["Kazakhstan", "KAZ"], ["Kenya", "KEN"],
  ["Kuwait", "KWT"], ["Latvia", "LVA"], ["Lebanon", "LBN"], ["Liberia", "LBR"],
  ["Lithuania", "LTU"], ["Luxembourg", "LUX"], ["Malaysia", "MYS"], ["Malta", "MLT"],
  ["Marshall Islands", "MHL"], ["Mexico", "MEX"], ["Morocco", "MAR"], ["Myanmar", "MMR"],
  ["Netherlands", "NLD"], ["New Zealand", "NZL"], ["Nigeria", "NGA"], ["Norway", "NOR"],
  ["Oman", "OMN"], ["Pakistan", "PAK"], ["Panama", "PAN"], ["Peru", "PER"],
  ["Philippines", "PHL"], ["Poland", "POL"], ["Portugal", "PRT"], ["Qatar", "QAT"],
  ["Romania", "ROU"], ["Russia", "RUS"], ["Saudi Arabia", "SAU"], ["Senegal", "SEN"],
  ["Singapore", "SGP"], ["Slovakia", "SVK"], ["Slovenia", "SVN"], ["South Africa", "ZAF"],
  ["South Korea", "KOR"], ["Spain", "ESP"], ["Sri Lanka", "LKA"], ["Sweden", "SWE"],
  ["Switzerland", "CHE"], ["Taiwan", "TWN"], ["Tanzania", "TZA"], ["Thailand", "THA"],
  ["Turkey", "TUR"], ["Ukraine", "UKR"], ["United Arab Emirates", "ARE"],
  ["United Kingdom", "GBR"], ["United States", "USA"], ["Uruguay", "URY"],
  ["Venezuela", "VEN"], ["Vietnam", "VNM"], ["Yemen", "YEM"],
];

/* ── Currencies (ISO-4217) — SEED-4: CNY not CNH; bank-selector set flagged ─────── */

/** The currencies offered in the bank multi-currency selector (seed-matrix §2.2, SEED-4). */
export const BANK_SELECTOR_CURRENCIES: ReadonlySet<string> = new Set([
  "IDR",
  "USD",
  "SGD",
  "CNY",
  "EUR",
  "JPY",
]);

/** `[code, name, country]` — the reference currency list. **CNY** (Renminbi); deliberately no `CNH`. */
export const CURRENCY_SEED: readonly (readonly [string, string, string])[] = [
  ["IDR", "Indonesian Rupiah", "Indonesia"], ["USD", "US Dollar", "United States"],
  ["EUR", "Euro", "Eurozone"], ["JPY", "Japanese Yen", "Japan"],
  ["SGD", "Singapore Dollar", "Singapore"], ["CNY", "Renminbi", "China"],
  ["GBP", "Pound Sterling", "United Kingdom"], ["AUD", "Australian Dollar", "Australia"],
  ["CAD", "Canadian Dollar", "Canada"], ["CHF", "Swiss Franc", "Switzerland"],
  ["HKD", "Hong Kong Dollar", "Hong Kong"], ["MYR", "Malaysian Ringgit", "Malaysia"],
  ["THB", "Thai Baht", "Thailand"], ["KRW", "South Korean Won", "South Korea"],
  ["INR", "Indian Rupee", "India"], ["AED", "UAE Dirham", "United Arab Emirates"],
  ["SAR", "Saudi Riyal", "Saudi Arabia"], ["PHP", "Philippine Peso", "Philippines"],
  ["VND", "Vietnamese Dong", "Vietnam"], ["TWD", "New Taiwan Dollar", "Taiwan"],
  ["NZD", "New Zealand Dollar", "New Zealand"], ["SEK", "Swedish Krona", "Sweden"],
  ["NOK", "Norwegian Krone", "Norway"], ["DKK", "Danish Krone", "Denmark"],
  ["ZAR", "South African Rand", "South Africa"], ["BRL", "Brazilian Real", "Brazil"],
  ["RUB", "Russian Ruble", "Russia"], ["TRY", "Turkish Lira", "Turkey"],
  ["QAR", "Qatari Riyal", "Qatar"], ["KWD", "Kuwaiti Dinar", "Kuwait"],
  ["BHD", "Bahraini Dinar", "Bahrain"], ["OMR", "Omani Rial", "Oman"],
  ["PKR", "Pakistani Rupee", "Pakistan"], ["BDT", "Bangladeshi Taka", "Bangladesh"],
  ["LKR", "Sri Lankan Rupee", "Sri Lanka"], ["MMK", "Myanmar Kyat", "Myanmar"],
  ["BND", "Brunei Dollar", "Brunei"], ["KHR", "Cambodian Riel", "Cambodia"],
];

/* ── Banks — SEED reference: local Indonesian + foreign, each with a country ISO-3 ── */

/** `{ name, code, location, countryIso3 }` — banks with the ISO-3 to resolve `country_id` from. */
export const BANK_SEED: readonly {
  readonly name: string;
  readonly code: string;
  readonly location: "local" | "foreign";
  readonly countryIso3: string;
}[] = [
  { name: "Bank Mandiri", code: "BMRI", location: "local", countryIso3: "IDN" },
  { name: "Bank Negara Indonesia (BNI)", code: "BNIN", location: "local", countryIso3: "IDN" },
  { name: "Bank Rakyat Indonesia (BRI)", code: "BRIN", location: "local", countryIso3: "IDN" },
  { name: "Bank Central Asia (BCA)", code: "CENA", location: "local", countryIso3: "IDN" },
  { name: "Bank CIMB Niaga", code: "BNIA", location: "local", countryIso3: "IDN" },
  { name: "Bank Syariah Indonesia (BSI)", code: "BSMD", location: "local", countryIso3: "IDN" },
  { name: "DBS Bank", code: "DBSS", location: "foreign", countryIso3: "SGP" },
  { name: "Bank of China", code: "BKCH", location: "foreign", countryIso3: "CHN" },
  { name: "HSBC", code: "HSBC", location: "foreign", countryIso3: "GBR" },
  { name: "Standard Chartered", code: "SCBL", location: "foreign", countryIso3: "GBR" },
  { name: "Citibank N.A.", code: "CITI", location: "foreign", countryIso3: "USA" },
];

/* ── Business entities — SEED-5: title-case, bilingual legal forms ─────────────── */

/** `{ nameId, nameEn, category }` — Indonesian + foreign legal forms, one canonical title-case. */
export const BUSINESS_ENTITY_SEED: readonly {
  readonly nameId: string;
  readonly nameEn: string;
  readonly category: "local" | "foreign";
}[] = [
  { nameId: "PT (Perseroan Terbatas)", nameEn: "PT (Limited Company)", category: "local" },
  { nameId: "CV (Persekutuan Komanditer)", nameEn: "CV (Limited Partnership)", category: "local" },
  { nameId: "UD (Usaha Dagang)", nameEn: "UD (Trading Business)", category: "local" },
  { nameId: "Firma", nameEn: "General Partnership (Firma)", category: "local" },
  { nameId: "Koperasi", nameEn: "Cooperative", category: "local" },
  { nameId: "Perum (Perusahaan Umum)", nameEn: "Perum (Public Corporation)", category: "local" },
  { nameId: "Persero", nameEn: "State-Owned Ltd (Persero)", category: "local" },
  { nameId: "Perorangan", nameEn: "Sole Proprietorship", category: "local" },
  { nameId: "Yayasan", nameEn: "Foundation", category: "local" },
  { nameId: "LLC", nameEn: "LLC", category: "foreign" },
  { nameId: "Inc.", nameEn: "Inc.", category: "foreign" },
  { nameId: "Corp.", nameEn: "Corp.", category: "foreign" },
  { nameId: "Co., Ltd.", nameEn: "Co., Ltd.", category: "foreign" },
  { nameId: "Ltd.", nameEn: "Ltd.", category: "foreign" },
  { nameId: "Pte. Ltd.", nameEn: "Pte. Ltd.", category: "foreign" },
  { nameId: "GmbH", nameEn: "GmbH", category: "foreign" },
  { nameId: "B.V.", nameEn: "B.V.", category: "foreign" },
  { nameId: "Sdn. Bhd.", nameEn: "Sdn. Bhd.", category: "foreign" },
  { nameId: "K.K.", nameEn: "K.K.", category: "foreign" },
  { nameId: "Pty Ltd", nameEn: "Pty Ltd", category: "foreign" },
  { nameId: "S.A.", nameEn: "S.A.", category: "foreign" },
];

/* ── Vendor categories — SEED-1: all 15 (bilingual), not the prototype's 4 ──────── */

/** `{ nameId, nameEn }` — the full 15 tanker-supply categories (SEED-1). */
export const VENDOR_CATEGORY_SEED: readonly { readonly nameId: string; readonly nameEn: string }[] = [
  { nameId: "Suku Cadang", nameEn: "Spare Parts" },
  { nameId: "Bahan Bakar", nameEn: "Bunker Fuel" },
  { nameId: "Provisi", nameEn: "Provisions / Chandler" },
  { nameId: "Galangan", nameEn: "Shipyard / Drydock" },
  { nameId: "Pelumas", nameEn: "Lubricants" },
  { nameId: "Cat & Pelapis", nameEn: "Paint & Coating" },
  { nameId: "Keselamatan", nameEn: "Safety" },
  { nameId: "Navigasi & Komunikasi", nameEn: "Navigation & Communication" },
  { nameId: "Kelistrikan", nameEn: "Electrical" },
  { nameId: "Perkakas", nameEn: "Tools" },
  { nameId: "Jasa Survei", nameEn: "Survey Services" },
  { nameId: "Logistik", nameEn: "Logistics / Freight" },
  { nameId: "Kru", nameEn: "Crewing / Manning" },
  { nameId: "Katering", nameEn: "Catering" },
  { nameId: "Limbah", nameEn: "Waste Management" },
];

/**
 * Static invariants over the seed data, checked before any write so a malformed list fails loudly
 * (and is unit-tested without a DB in `registration-lists.test.ts`). Enforces the reconciliations:
 * exactly 15 categories (SEED-1), CNY present and CNH absent (SEED-4), the bank-selector set covered,
 * every bilingual side non-blank, and no duplicate code / iso3 / currency-code across a list.
 */
export const assertRegistrationSeedConsistent = (): void => {
  const dup = (label: string, values: readonly string[]): void => {
    const seen = new Set<string>();
    for (const v of values) {
      if (seen.has(v)) throw new Error(`[seed] duplicate ${label}: ${v}`);
      seen.add(v);
    }
  };

  dup("country iso3", COUNTRY_SEED.map(([, iso3]) => iso3));
  dup("currency code", CURRENCY_SEED.map(([code]) => code));
  dup("bank code", BANK_SEED.map((b) => b.code));
  dup("business entity nameEn", BUSINESS_ENTITY_SEED.map((e) => e.nameEn));
  dup("vendor category nameEn", VENDOR_CATEGORY_SEED.map((c) => c.nameEn));

  // SEED-1: exactly the full 15 categories.
  if (VENDOR_CATEGORY_SEED.length !== 15)
    throw new Error(`[seed] expected 15 vendor categories, got ${VENDOR_CATEGORY_SEED.length}`);

  // SEED-4: CNY present, CNH absent.
  const currencyCodes = new Set(CURRENCY_SEED.map(([code]) => code));
  if (!currencyCodes.has("CNY")) throw new Error("[seed] currency CNY (ISO-4217) is missing");
  if (currencyCodes.has("CNH")) throw new Error("[seed] currency CNH must be dropped in favour of CNY");
  for (const code of BANK_SELECTOR_CURRENCIES)
    if (!currencyCodes.has(code))
      throw new Error(`[seed] bank-selector currency ${code} is not in the currency list`);

  // Every bilingual side must be non-blank (ADR-0011); every bank must point at a seeded country.
  const iso3s = new Set(COUNTRY_SEED.map(([, iso3]) => iso3));
  for (const b of BANK_SEED)
    if (!iso3s.has(b.countryIso3))
      throw new Error(`[seed] bank "${b.code}" references unknown country ${b.countryIso3}`);
  for (const e of BUSINESS_ENTITY_SEED)
    if (!e.nameId.trim() || !e.nameEn.trim())
      throw new Error(`[seed] business entity has a blank label: ${e.nameEn || e.nameId}`);
  for (const c of VENDOR_CATEGORY_SEED)
    if (!c.nameId.trim() || !c.nameEn.trim())
      throw new Error(`[seed] vendor category has a blank label: ${c.nameEn || c.nameId}`);
};

/**
 * Seed (or re-seed) the five registration lists. Idempotent — code-keyed lists upsert on their unique
 * index; the bilingual lists upsert by matching `name_en`. Returns per-list row counts for the log.
 */
export const seedRegistrationLists = async (
  db: DB,
): Promise<{
  countries: number;
  currencies: number;
  banks: number;
  businessEntities: number;
  vendorCategories: number;
}> => {
  assertRegistrationSeedConsistent();

  // Countries first — banks resolve their country_id from these.
  for (const [name, iso3] of COUNTRY_SEED) {
    await db
      .insert(countries)
      .values({ name, iso3 })
      .onConflictDoUpdate({
        target: countries.iso3,
        set: { name, active: true, updatedAt: new Date() },
      });
  }

  for (const [code, name, country] of CURRENCY_SEED) {
    await db
      .insert(currencies)
      .values({ code, name, country, showInBankSelector: BANK_SELECTOR_CURRENCIES.has(code) })
      .onConflictDoUpdate({
        target: currencies.code,
        set: {
          name,
          country,
          showInBankSelector: BANK_SELECTOR_CURRENCIES.has(code),
          active: true,
          updatedAt: new Date(),
        },
      });
  }

  // Resolve each seeded country's id once, so bank country_id can be filled by ISO-3.
  const countryRows = await db.select({ id: countries.id, iso3: countries.iso3 }).from(countries);
  const countryIdByIso3 = new Map(countryRows.map((r) => [r.iso3, r.id]));

  for (const bank of BANK_SEED) {
    const countryId = countryIdByIso3.get(bank.countryIso3) ?? null;
    await db
      .insert(banks)
      .values({ name: bank.name, code: bank.code, location: bank.location, countryId })
      .onConflictDoUpdate({
        target: banks.code,
        set: {
          name: bank.name,
          location: bank.location,
          countryId,
          active: true,
          updatedAt: new Date(),
        },
      });
  }

  // Bilingual-term lists have no unique column: match by name_en, insert if absent, else refresh.
  for (const entity of BUSINESS_ENTITY_SEED) {
    const [existing] = await db
      .select({ id: businessEntities.id })
      .from(businessEntities)
      .where(eq(businessEntities.nameEn, entity.nameEn))
      .limit(1);
    if (existing) {
      await db
        .update(businessEntities)
        .set({
          nameId: entity.nameId,
          category: entity.category,
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(businessEntities.id, existing.id));
    } else {
      await db.insert(businessEntities).values(entity);
    }
  }

  for (const category of VENDOR_CATEGORY_SEED) {
    const [existing] = await db
      .select({ id: vendorCategories.id })
      .from(vendorCategories)
      .where(eq(vendorCategories.nameEn, category.nameEn))
      .limit(1);
    if (existing) {
      await db
        .update(vendorCategories)
        .set({ nameId: category.nameId, active: true, updatedAt: new Date() })
        .where(eq(vendorCategories.id, existing.id));
    } else {
      await db.insert(vendorCategories).values(category);
    }
  }

  return {
    countries: COUNTRY_SEED.length,
    currencies: CURRENCY_SEED.length,
    banks: BANK_SEED.length,
    businessEntities: BUSINESS_ENTITY_SEED.length,
    vendorCategories: VENDOR_CATEGORY_SEED.length,
  };
};
