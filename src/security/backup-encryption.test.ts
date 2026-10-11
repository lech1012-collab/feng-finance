import { describe, expect, it } from "vitest";
import type { Backup } from "../domain/models";
import { transaction } from "../tests/helpers";
import { decodeBase64, encodeBase64 } from "./crypto";
import {
  decryptBackup,
  encryptBackup,
  encryptedBackupHeader,
} from "./backup-encryption";
const backup: Backup = {
  format: "feng-finance",
  version: 1,
  schemaVersion: 3,
  moneyUnit: "minor",
  exportedAt: "2026-10-08T00:00:00.000Z",
  accounts: [],
  statements: [],
  transactions: [
    transaction({ merchant: "Fictitious Secret Merchant", amount: -98765 }),
  ],
  categories: [],
  rules: [],
  transferLinks: [],
  settings: [],
};
describe("encrypted backups", () => {
  it("round-trips complete local data while exposing only authenticated non-financial metadata", async () => {
    const file = await encryptBackup(backup, "correct horse local password");
    const text = JSON.stringify(file);
    expect(text).not.toContain("Fictitious Secret Merchant");
    expect(text).not.toContain("98765");
    expect(file).toMatchObject({
      encrypted: true,
      schemaVersion: 3,
      encryption: "AES-256-GCM",
      derivation: "PBKDF2-SHA256",
      iterations: 600000,
    });
    expect(await decryptBackup(file, "correct horse local password")).toEqual(
      backup,
    );
  });
  it("rejects the wrong password and authenticated-header tampering before any storage access", async () => {
    const file = await encryptBackup(backup, "a different local password");
    await expect(decryptBackup(file, "incorrect password")).rejects.toThrow(
      "No data has changed",
    );
    await expect(
      decryptBackup(
        { ...file, schemaVersion: 2 },
        "a different local password",
      ),
    ).rejects.toThrow("backup is damaged");
  });
  it("uses a fresh random salt and nonce for every export", async () => {
    const first = await encryptBackup(backup, "same local password"),
      second = await encryptBackup(backup, "same local password");
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.payload).not.toBe(second.payload);
  });
  it("rejects unsupported iteration counts, oversized encoding and short passwords", async () => {
    await expect(encryptBackup(backup, "short")).rejects.toThrow("at least 8");
    const header = {
      format: "feng-encrypted-backup",
      version: 1,
      schemaVersion: 3,
      createdAt: backup.exportedAt,
      encrypted: true,
      encryption: "AES-256-GCM",
      derivation: "PBKDF2-SHA256",
      salt: encodeBase64(new Uint8Array(16)),
      iv: encodeBase64(new Uint8Array(12)),
      payload: "YQ==",
    };
    expect(() =>
      encryptedBackupHeader({ ...header, iterations: 599999 }),
    ).toThrow("invalid header");
    expect(() =>
      encryptedBackupHeader({ ...header, iterations: 100000000 }),
    ).toThrow("invalid header");
    expect(() => decodeBase64("YWFhYWFhYWFh", 2)).toThrow("too large");
  });
});
