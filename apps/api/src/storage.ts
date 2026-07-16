/**
 * Object storage seam (M3.2, #43, ADR-0008/0013) — the first MinIO touch in the system.
 *
 * Every uploaded byte (bank/terms attachments now; compliance-doc versions in M3.3) lands in MinIO and
 * is referenced from Postgres by a `files` row — bytes in object storage, metadata in the DB. This file
 * is the whole storage surface the rest of the API sees, kept behind a small {@link FileStore} interface
 * so routes are testable with an in-memory fake and the real S3 client is swapped in only at the edge.
 *
 * Reads are never proxied through the API: {@link FileStore.presignGet} mints a short-lived **signed URL**
 * the browser fetches straight from MinIO. Writes are validated first — {@link uploadFile} rejects a
 * wrong content type or an oversize file (the M3.2 "validated, not gated" rule, ADR-0013) *before* it
 * ever writes to storage, and records the `files` row only after the object is safely stored.
 *
 * Built on Bun's native S3 client (`Bun.S3Client`) — MinIO is S3-compatible, so no extra dependency.
 */

import { randomUUID } from "node:crypto";
import { type DB, db as defaultDb, files } from "@vms/db";
import {
  BANK_ATTACHMENT_MAX_BYTES,
  BANK_ATTACHMENT_MIMES,
  type DomainError,
  type Result,
  bankAttachmentMimeSchema,
  err,
  internalError,
  ok,
  validationError,
} from "@vms/domain";
import { env } from "./env";

/**
 * Narrow ambient view of Bun's native S3 client (`Bun.S3Client`) — just the two calls we make. Declared
 * locally rather than pulling `bun-types` into the API's tsconfig (which only loads `@types/node`), so
 * the broad Bun global surface doesn't shift every other file's `fetch`/`Response` types. `presign` is
 * synchronous in Bun and returns the URL string.
 */
type BunS3Client = {
  write: (path: string, data: Uint8Array, options?: { type?: string }) => Promise<number>;
  presign: (path: string, options?: { method?: string; expiresIn?: number }) => string;
};
type BunS3ClientOptions = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
  endpoint?: string;
};
declare const Bun: { S3Client: new (options: BunS3ClientOptions) => BunS3Client };

/** A stored file's metadata — the `files` row plus the bucket/key needed to presign a read. */
export type StoredFile = {
  readonly id: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly originalName: string | null;
};

/**
 * The storage operations the API depends on. Two only: put an object, and mint a signed GET URL for one.
 * Everything else (which bucket, credentials, path-style addressing) is the implementation's concern.
 */
export type FileStore = {
  readonly bucket: string;
  /** Store `bytes` at `objectKey` with the given content type. Overwrites if the key already exists. */
  readonly put: (objectKey: string, bytes: Uint8Array, mime: string) => Promise<void>;
  /** A short-lived signed URL the browser uses to GET the object directly from storage. */
  readonly presignGet: (objectKey: string, ttlSeconds?: number) => Promise<string>;
};

/** Default signed-URL lifetime — long enough to open a document, short enough to not leak (5 min). */
const DEFAULT_PRESIGN_TTL = 300;

/**
 * The real {@link FileStore} over MinIO via Bun's S3 client. A separate `publicEndpoint` may be given so
 * signed URLs are addressed to a host the *browser* can reach (in dev the API and browser share
 * `localhost:9000`; in a split deployment the internal endpoint the API writes through differs from the
 * external one the URL must point at) — falling back to the write endpoint when unset.
 */
export const bunS3FileStore = (cfg = env.storage): FileStore => {
  const common = {
    accessKeyId: cfg.accessKey,
    secretAccessKey: cfg.secretKey,
    bucket: cfg.bucket,
    region: cfg.region,
  };
  const writeClient = new Bun.S3Client({ ...common, endpoint: cfg.endpoint });
  const presignClient = new Bun.S3Client({
    ...common,
    endpoint: cfg.publicEndpoint ?? cfg.endpoint,
  });
  return {
    bucket: cfg.bucket,
    put: async (objectKey, bytes, mime) => {
      await writeClient.write(objectKey, bytes, { type: mime });
    },
    presignGet: async (objectKey, ttlSeconds = DEFAULT_PRESIGN_TTL) =>
      presignClient.presign(objectKey, { method: "GET", expiresIn: ttlSeconds }),
  };
};

/**
 * Validate an attachment's content type + size against the M3.2 rules (ADR-0013). Pure — no IO — so it
 * can gate the request before any byte is stored. Returns a typed `DomainError` (400 for a rejected
 * type, 422 for an oversize file) or `null` when the upload is acceptable.
 */
export const validateAttachment = (mime: string, sizeBytes: number): DomainError | null => {
  if (!bankAttachmentMimeSchema.safeParse(mime).success) {
    return validationError({
      messageKey: "error.file.badType",
      params: { allowed: BANK_ATTACHMENT_MIMES.join(", ") },
    });
  }
  if (sizeBytes <= 0) return validationError({ messageKey: "error.file.empty" });
  if (sizeBytes > BANK_ATTACHMENT_MAX_BYTES) {
    return validationError({
      messageKey: "error.file.tooLarge",
      params: { maxMb: Math.floor(BANK_ATTACHMENT_MAX_BYTES / (1024 * 1024)) },
    });
  }
  return null;
};

/** A file about to be uploaded — the validated bytes plus what the `files` row records. */
export type UploadInput = {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly originalName?: string;
  readonly uploadedBy?: string;
  /** Object-key namespace, e.g. `vendor-banks` (default) or `document-versions` (M3.3). */
  readonly keyPrefix?: string;
};

/** Object-key namespace for bank-account attachments (proof / KTP / surat) — the default. */
const BANK_ATTACHMENT_PREFIX = "vendor-banks";

/** Strip anything but a safe filename tail, so a client-supplied name can't shape the object key. */
const safeName = (name: string | undefined): string =>
  (name ?? "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "file";

/**
 * Validate, store, and record one bank attachment. Validation runs first (nothing is written on a bad
 * type / size); on success the bytes land in MinIO under a collision-proof key and a `files` row is
 * inserted, whose id the caller then links onto the `vendor_banks` slot (`proof`/`ktp`/`surat`).
 */
export const uploadFile = async (
  store: FileStore,
  input: UploadInput,
  dbHandle: DB = defaultDb,
): Promise<Result<StoredFile, DomainError>> => {
  const invalid = validateAttachment(input.mime, input.sizeBytes);
  if (invalid) return err(invalid);

  const prefix = input.keyPrefix ?? BANK_ATTACHMENT_PREFIX;
  const objectKey = `${prefix}/${randomUUID()}-${safeName(input.originalName)}`;
  try {
    await store.put(objectKey, input.bytes, input.mime);
  } catch (cause) {
    return err(internalError({ messageKey: "error.file.storeFailed", details: String(cause) }));
  }

  const [row] = await dbHandle
    .insert(files)
    .values({
      bucket: store.bucket,
      objectKey,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      originalName: input.originalName ?? null,
      uploadedBy: input.uploadedBy ?? null,
    })
    .returning();
  if (!row) return err(internalError({ messageKey: "error.file.storeFailed" }));

  return ok({
    id: row.id,
    bucket: row.bucket,
    objectKey: row.objectKey,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    originalName: row.originalName,
  });
};

/**
 * The two storage operations a feature route actually needs, bundled behind one injectable seam:
 * validate-store-record an upload, and presign a read. Bundling them (rather than passing a raw
 * {@link FileStore} + the ambient `db`) means a route can be tested with a single in-memory fake that
 * touches neither MinIO nor Postgres — which is exactly what the M3.2 bank-attachment tests do.
 */
export type AttachmentStorage = {
  readonly upload: (input: UploadInput) => Promise<Result<StoredFile, DomainError>>;
  readonly presignGet: (objectKey: string, ttlSeconds?: number) => Promise<string>;
};

/** The real {@link AttachmentStorage} — Bun S3 + the ambient DB, wired for production use. */
export const attachmentStorage = (
  fileStore: FileStore = bunS3FileStore(),
  dbHandle: DB = defaultDb,
): AttachmentStorage => ({
  upload: (input) => uploadFile(fileStore, input, dbHandle),
  presignGet: (objectKey, ttlSeconds) => fileStore.presignGet(objectKey, ttlSeconds),
});
