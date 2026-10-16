// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { FinanceDB, initializeDatabase } from "./database";
import { createBackup, restoreBackup, validateBackup } from "./backup";
import { fxSchema } from "./backup-schema";
import { parseEcbCsv } from "../analytics/fx";
import { decryptBackup, encryptBackup } from "../security/backup-encryption";
import { accounts, transaction } from "../tests/helpers";

const rates = parseEcbCsv(
  [
    "TIME_PERIOD,CURRENCY,CURRENCY_DENOM,OBS_VALUE",
    "2026-10-13,BRL,EUR,6.01894",
    "2026-10-13,CNY,EUR,7.5641",
    "2026-10-13,GBP,EUR,0.86425",
    "2026-10-13,INR,EUR,103.275",
    "2026-10-13,ZAR,EUR,20.2719",
  ].join("\n"),
);
const databases: FinanceDB[] = [];
async function database() {
  const next = new FinanceDB("fx-backup-" + crypto.randomUUID());
  databases.push(next);
  await initializeDatabase(next);
  await next.accounts.put(accounts[0]);
  await next.transactions.put(
    transaction({
      source: "manual",
      statementId: "",
      sourcePage: 0,
      categoryId: "groceries",
      description: "FICTITIOUS LOCAL PURCHASE",
    }),
  );
  return next;
}
afterEach(async () => {
  for (const current of databases.splice(0)) await current.delete();
});

it("round-trips every downloaded ECB quote in a portable backup without altering supported-currency accounts or source money", async () => {
  const source = await database();
  await source.fxRates.bulkPut(rates);
  const cached = await source.fxRates.toArray();
  const originalTransactions = await source.transactions.toArray();
  const originalAccounts = await source.accounts.toArray();
  const backup = validateBackup(
    JSON.parse(JSON.stringify(await createBackup({}, source))),
  );
  expect(backup.fxRates).toEqual(cached);
  const target = await database();
  await restoreBackup(backup, target);
  expect(await target.fxRates.toArray()).toEqual(cached);
  expect(await target.transactions.toArray()).toEqual(originalTransactions);
  expect(await target.accounts.toArray()).toEqual(originalAccounts);
  expect(await source.fxRates.toArray()).toEqual(cached);
});

it("decrypts and restores the same broad ECB cache from a password-protected backup", async () => {
  const source = await database();
  await source.fxRates.bulkPut(rates);
  const backup = await createBackup({}, source);
  const encrypted = await encryptBackup(
    backup,
    "fictitious strong backup password",
  );
  const decoded = validateBackup(
    await decryptBackup(encrypted, "fictitious strong backup password"),
  );
  expect(decoded.fxRates).toEqual(backup.fxRates);
  const target = await database();
  await restoreBackup(decoded, target);
  expect(await target.fxRates.toArray()).toEqual(backup.fxRates);
  expect(await target.transactions.toArray()).toEqual(backup.transactions);
});

it("accepts alphabetic three-letter FX bases and quotes without enabling unsupported ledger currencies", async () => {
  expect(
    fxSchema.parse({ ...rates[0], base: "BRL", quote: "CNY" }),
  ).toMatchObject({ base: "BRL", quote: "CNY" });
  const source = await database();
  await source.fxRates.bulkPut(rates);
  const backup = await createBackup({}, source);
  const original = await source.accounts.toArray();
  for (const currency of ["BRL", "CNY", "INR", "ZAR"]) {
    await expect(
      restoreBackup(
        { ...backup, accounts: [{ ...backup.accounts[0], currency }] },
        source,
      ),
    ).rejects.toThrow();
    expect(await source.accounts.toArray()).toEqual(original);
    expect(() =>
      validateBackup({
        ...backup,
        transactions: [{ ...backup.transactions[0], currency }],
      }),
    ).toThrow();
  }
});

it.each(["brl", "BR", "BRLL", "B1L", "£BR", " BRL", "BRL ", "<x>"])(
  "rejects malformed FX currency code %s in either side",
  (code) => {
    expect(fxSchema.safeParse({ ...rates[0], base: code }).success).toBe(false);
    expect(fxSchema.safeParse({ ...rates[0], quote: code }).success).toBe(
      false,
    );
  },
);

it.each([
  "0",
  "0.000",
  "-1",
  "Infinity",
  "NaN",
  "1e3",
  "1,23",
  "0.1234567890123",
  "9".repeat(400),
])("keeps rejecting invalid, nonpositive or unsafe decimal rates: %s", (rate) =>
  expect(fxSchema.safeParse({ ...rates[0], rate }).success).toBe(false),
);

it.each(["2026-02-30", "2026-13-01", "13/10/2026", "not a date"])(
  "keeps rejecting invalid FX dates: %s",
  (date) =>
    expect(fxSchema.safeParse({ ...rates[0], date }).success).toBe(false),
);
