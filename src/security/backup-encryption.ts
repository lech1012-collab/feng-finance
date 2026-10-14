import type { Backup } from "../domain/models";
import {
  BackupFileTooLargeError,
  MAX_BACKUP_FILE_BYTES,
} from "../storage/backup-limits";
import {
  decodeBase64,
  deriveKey,
  encodeBase64,
  PBKDF2_ITERATIONS,
  randomBytes,
} from "./crypto";

export interface EncryptedBackupHeader {
  format: "feng-encrypted-backup";
  version: 1;
  schemaVersion: number;
  createdAt: string;
  encrypted: true;
  encryption: "AES-256-GCM";
  derivation: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
}
export interface EncryptedBackupFile extends EncryptedBackupHeader {
  payload: string;
}
export class BackupPasswordRequired extends Error {
  constructor(readonly header: EncryptedBackupHeader) {
    super("Enter the password used to protect this backup.");
    this.name = "BackupPasswordRequired";
  }
}
function authenticatedHeader(
  header: EncryptedBackupHeader,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(header));
}
export function encryptedBackupHeader(
  input: unknown,
): EncryptedBackupHeader | undefined {
  if (
    !input ||
    typeof input !== "object" ||
    !("format" in input) ||
    input.format !== "feng-encrypted-backup"
  )
    return;
  const value = input as Partial<EncryptedBackupFile>;
  if (
    value.version !== 1 ||
    value.encrypted !== true ||
    value.encryption !== "AES-256-GCM" ||
    value.derivation !== "PBKDF2-SHA256" ||
    !Number.isSafeInteger(value.schemaVersion) ||
    (value.schemaVersion ?? 0) < 1 ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isInteger(value.iterations) ||
    (value.iterations ?? 0) < PBKDF2_ITERATIONS ||
    (value.iterations ?? 0) > 2_000_000 ||
    typeof value.salt !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.payload !== "string"
  )
    throw new Error(
      "This encrypted backup has an unsupported or invalid header.",
    );
  if (
    decodeBase64(value.salt, 64).length !== 16 ||
    decodeBase64(value.iv, 32).length !== 12
  )
    throw new Error("This encrypted backup has invalid encryption parameters.");
  return {
    format: "feng-encrypted-backup",
    version: 1,
    schemaVersion: value.schemaVersion!,
    createdAt: value.createdAt,
    encrypted: true,
    encryption: "AES-256-GCM",
    derivation: "PBKDF2-SHA256",
    iterations: value.iterations!,
    salt: value.salt,
    iv: value.iv,
  };
}
export async function encryptBackup(
  backup: Backup,
  password: string,
): Promise<EncryptedBackupFile> {
  if (password.length < 8)
    throw new Error("Use a backup password with at least 8 characters.");
  const plaintext = new TextEncoder().encode(JSON.stringify(backup));
  // Leave room for base64 expansion and the non-financial header, so every
  // exported file can be reopened by the same 100 MB restore limit.
  if (plaintext.byteLength > 74_000_000)
    throw new Error(
      "This backup is too large to restore safely. Exclude attachments and export again; your data has not changed.",
    );
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const header: EncryptedBackupHeader = {
    format: "feng-encrypted-backup",
    version: 1,
    schemaVersion: backup.schemaVersion,
    createdAt: backup.exportedAt,
    encrypted: true,
    encryption: "AES-256-GCM",
    derivation: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
  };
  const key = await deriveKey(password, salt);
  const payload = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: authenticatedHeader(header),
      tagLength: 128,
    },
    key,
    plaintext,
  );
  return { ...header, payload: encodeBase64(new Uint8Array(payload)) };
}
/** Returns data for validation/preview; never writes to IndexedDB. */
export async function decryptBackup(
  input: unknown,
  password: string,
): Promise<unknown> {
  const header = encryptedBackupHeader(input);
  if (!header) throw new Error("This is not an encrypted Feng backup.");
  try {
    const payload = (input as EncryptedBackupFile).payload;
    const key = await deriveKey(
      password,
      decodeBase64(header.salt),
      header.iterations,
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64(header.iv),
        additionalData: authenticatedHeader(header),
        tagLength: 128,
      },
      key,
      decodeBase64(payload),
    );
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
    ) as unknown;
  } catch {
    throw new Error(
      "The password is incorrect or the backup is damaged. No data has changed.",
    );
  }
}
export async function decodeBackupUpload(
  file: File,
  password?: string,
): Promise<unknown> {
  if (file.size > MAX_BACKUP_FILE_BYTES) throw new BackupFileTooLargeError();
  let input: unknown;
  try {
    input = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new SyntaxError("This file is not a valid Feng backup.");
  }
  const header = encryptedBackupHeader(input);
  if (!header) return input;
  if (!password) throw new BackupPasswordRequired(header);
  return decryptBackup(input, password);
}
