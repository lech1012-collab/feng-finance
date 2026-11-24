// The reporting tables always contain just one ledger. Switching both ledgers in
// one IndexedDB transaction also rolls back a partial copy if storage is full.
import { loadDemo } from "./demo";
import { updateClosedMonthSnapshots } from "./month-review";
import Dexie from "dexie";
import {
  db,
  defaultCategories,
  defaultRules,
  type FinanceDB,
} from "./database";
import { copyStoredBlobs } from "./audit";
import type {
  Account,
  Statement,
  Transaction,
  Rule,
  ChangeLog,
  Backup,
} from "../domain/models";

export type Ledger = "personal" | "demo";
type Row = Record<string, unknown>;
export type LedgerRows = Record<string, Row[]>;
export interface LedgerArchive {
  name: Ledger;
  rows: LedgerRows;
}

function byId(rows: Row[]): Set<unknown> {
  return new Set(rows.map((row) => row.id));
}

// These preferences apply to the device. Financial configuration, including
// budgets, periods, CSV mappings and backup timestamps, travels with its ledger.
function sharedSetting(key: string) {
  return (
    key.startsWith("security:") ||
    key.startsWith("installBanner") ||
    key.startsWith("betaNotice") ||
    [
      "initialized",
      "defaults-1.1",
      "theme",
      "currency",
      "reportingCurrency",
      "fxSource",
      "fx:download",
      "lastSeenVersion",
      "storagePersisted",
      "separateStorageWarningSeen",
    ].includes(key)
  );
}
function financialTables(database: FinanceDB) {
  return database.tables.filter(
    (table) => !["safetyBackups", "ledgerArchives"].includes(table.name),
  );
}

async function snapshot(database: FinanceDB): Promise<LedgerRows> {
  const entries = await Promise.all(
    financialTables(database).map(async (table) => {
      let rows: Row[] = await table.toArray();
      if (table.name === "settings")
        rows = rows.filter((s) => !sharedSetting(String(s.key)));
      return [table.name, rows] as const;
    }),
  );
  const rows = Object.fromEntries(entries);
  const [attachments, changeLog] = await Dexie.waitFor(
    copyStoredBlobs([rows.attachments, rows.changeLog]),
  );
  return { ...rows, attachments, changeLog };
}

async function populate(database: FinanceDB, rows: LedgerRows) {
  for (const table of financialTables(database)) {
    if (table.name === "settings")
      await database.settings.filter((s) => !sharedSetting(s.key)).delete();
    else await table.clear();
    if (rows[table.name]?.length) await table.bulkPut(rows[table.name]);
  }
}

function freshLedger(): LedgerRows {
  return {
    categories: defaultCategories.map((category) => ({ ...category })),
    rules: defaultRules.map((rule) => ({ ...rule })),
    settings: [
      { key: "transferMatching", value: "manual" },
      { key: "transferDateWindowDays", value: "4" },
    ],
  };
}

// Split children and a few older statement records inherit ownership from
// their source. File previews and the migration must make the same decision.
type OwnershipRecord = {
  id?: unknown;
  accountId?: unknown;
  isDemo?: unknown;
  source?: unknown;
  parentId?: unknown;
  statementId?: unknown;
};
function legacyOwnership(
  accounts: OwnershipRecord[],
  statements: OwnershipRecord[],
  transactions: OwnershipRecord[],
) {
  const accountIds = new Set(accounts.filter((row) => row.isDemo).map((row) => row.id));
  const statementIds = new Set(
    statements.filter((row) => row.isDemo ||
      (accountIds.has(row.accountId) && String(row.id).startsWith("demo-")))
      .map((row) => row.id),
  );
  const txIds = new Set(
    transactions.filter((row) => row.isDemo || statementIds.has(row.statementId)).map((row) => row.id),
  );
  for (const row of transactions) {
    if (txIds.has(row.parentId)) txIds.add(row.id);
  }
  return { accountIds, statementIds, txIds };
}

export function backupLedger(
  backup: Pick<Backup, "ledger" | "accounts" | "transactions" | "statements" | "valuations">,
): Ledger {
  if (backup.ledger) return backup.ledger;
  const { accountIds, statementIds, txIds } = legacyOwnership(
    backup.accounts, backup.statements, backup.transactions,
  );
  return accountIds.size > 0 &&
    accountIds.size === backup.accounts.length &&
    statementIds.size === backup.statements.length &&
    txIds.size === backup.transactions.length &&
    (backup.valuations ?? []).every((row) => row.isDemo)
    ? "demo" : "personal";
}

export async function currentLedger(database = db): Promise<Ledger> {
  // Read only the primary key, rather than materialising the inactive ledger.
  return (await database.ledgerArchives.where(":id").equals("personal").count())
    ? "demo"
    : "personal";
}

export async function activateLedger(destination: Ledger, database = db) {
  await database.transaction("rw", database.tables, async () => {
    const active = await currentLedger(database);
    if (active === destination) return;
    const previous = await snapshot(database);
    const next = await database.ledgerArchives.get(destination);
    // Stored attachments in the inactive record also need their own bytes before removal.
    const nextLedgerRows = next
      ? await Dexie.waitFor(copyStoredBlobs(next.rows))
      : freshLedger();
    await database.ledgerArchives.put({ name: active, rows: previous });
    await populate(database, nextLedgerRows);
    await database.ledgerArchives.delete(destination);
  });
}

/** Reconstruct ownership once for pre-isolation records or portable mixed backups.
 * Explicitly personal manual entries retain their account shell but never demo balances.
 */
export function partitionLegacyRows(
  all: LedgerRows,
): { personal: LedgerRows; demo: LedgerRows } | undefined {
  if (!all.accounts.some((row) => row.isDemo)) return;
  const {accountIds, statementIds, txIds} = legacyOwnership(all.accounts, all.statements, all.transactions);
  const realTransactions = all.transactions.filter((row) => !txIds.has(row.id));
  const realStatements = all.statements.filter(
    (row) => !statementIds.has(row.id),
  );
  const personalUses = new Set(
    [
      ...realTransactions,
      ...realStatements,
      ...all.valuations.filter((r) => !r.isDemo),
    ].map((r) => r.accountId),
  );
  const personalAccounts = all.accounts.filter(
    (a) => !a.isDemo || personalUses.has(a.id),
  );
  if (
    !personalAccounts.length &&
    !realTransactions.length &&
    !realStatements.length
  )
    return;
  const personal: LedgerRows = {};
  const demo: LedgerRows = {};
  for (const [name, rows] of Object.entries(all)) {
    personal[name] = [];
    demo[name] = [];
    for (const row of rows) {
      let sample = !!row.isDemo;
      switch (name) {
        case "accounts":
          if (sample && personalUses.has(row.id))
            personal[name].push({ ...row, isDemo: false });
          break;
        case "statements":
          sample = statementIds.has(row.id);
          break;
        case "transactions":
          sample = txIds.has(row.id);
          break;
        case "attachments":
          sample = txIds.has(row.transactionId);
          break;
        case "rules":
          sample =
            accountIds.has(row.accountId) && !personalUses.has(row.accountId);
          if (
            row.builtIn ||
            (personalUses.has(row.accountId) && accountIds.has(row.accountId))
          )
            demo[name].push(row);
          break;
        case "categories":
          demo[name].push(row);
          break;
        case "importDiagnostics":
          sample = statementIds.has(row.statementId);
          break;
        case "transferProposals":
          if (txIds.has(row.debitTxId) !== txIds.has(row.creditTxId)) continue;
          sample = txIds.has(row.debitTxId);
          break;
        case "transferLinks": {
          const legs = row.transactionIds as string[];
          if (
            legs.some((id) => txIds.has(id)) &&
            !legs.every((id) => txIds.has(id))
          )
            continue;
          sample = legs.every((id) => txIds.has(id));
          break;
        }
        case "recurringSeries":
          sample =
            sample ||
            (accountIds.has(row.accountId) && !personalUses.has(row.accountId));
          break;
        case "fxRates":
        case "budgets":
        case "savedViews":
        case "savedReports":
        case "scenarios":
          sample = String(row.id).startsWith("demo-");
          break;
        case "changeLog":
          continue; // Assigned below, after related keys are known.
      }
      (sample ? demo : personal)[name].push(row);
    }
  }
  for (const rows of [personal, demo]) {
    const links = byId(rows.transferLinks),
      series = byId(rows.recurringSeries),
      txs = byId(rows.transactions);
    for (const row of rows.transactions) {
      if (
        (row.linkId && !links.has(row.linkId)) ||
        (row.transferPairId && !links.has(row.transferPairId))
      ) {
        row.linkId = undefined;
        row.transferPairId = undefined;
        row.isTransfer = false;
        row.kind = "normal";
        row.type = Number(row.amount) < 0 ? "expense" : "income";
        row.isReviewed = false;
      }
      if (
        Array.isArray(row.refundAllocations) &&
        row.refundAllocations.some((a) => !txs.has(a.transactionId))
      ) {
        row.refundAllocations = undefined;
        row.isReviewed = false;
      }
      if (row.recurringSeriesId && !series.has(row.recurringSeriesId))
        row.recurringSeriesId = undefined;
    }
    // Retain referenced metadata when a legacy user intentionally used it across scopes.
    const tagIds = new Set(
      rows.transactions.flatMap((row) =>
        Array.isArray(row.tags) ? row.tags : [],
      ),
    );
    for (const rule of rows.rules as unknown as Rule[])
      for (const action of rule.actions ?? []) {
        for (const id of action.tagIds ?? []) tagIds.add(id);
        for (const split of action.splits ?? [])
          for (const id of split.tagIds ?? []) tagIds.add(id);
      }
    const ownTags = byId(rows.tags);
    rows.tags.push(
      ...all.tags.filter((row) => tagIds.has(row.id) && !ownTags.has(row.id)),
    );
    const ownAccounts = byId(rows.accounts);
    for (const pot of rows.pots)
      if (pot.linkedAccountId && !ownAccounts.has(pot.linkedAccountId))
        pot.linkedAccountId = undefined;
  }
  // Keep old Undo operations in their own ledger, never reintroduce a demo
  // mutation through personal history. The migration snapshot retains mixed originals.
  const demoKeys = new Map(
    Object.entries(demo).map(([name, rows]) => [
      name,
      new Set(rows.map((r) => r.id ?? r.key ?? r.month)),
    ]),
  );
  const realKeys = new Map(
    Object.entries(personal).map(([name, rows]) => [
      name,
      new Set(rows.map((r) => r.id ?? r.key ?? r.month)),
    ]),
  );
  for (const entry of all.changeLog as unknown as ChangeLog[]) {
    const isSample = (change: ChangeLog["changes"][number]) => {
      if (realKeys.get(change.table)?.has(change.key)) return false;
      const old = (change.after ?? change.before) as
        Partial<Account & Statement & Transaction> | undefined;
      return (
        demoKeys.get(change.table)?.has(change.key) ||
        old?.isDemo ||
        accountIds.has(old?.accountId) ||
        change.key.startsWith("demo-")
      );
    };
    const sampleChanges = entry.changes.filter(isSample),
      realChanges = entry.changes.filter((c) => !isSample(c));
    if (sampleChanges.length)
      demo.changeLog.push({ ...entry, changes: sampleChanges });
    if (realChanges.length)
      personal.changeLog.push({ ...entry, changes: realChanges });
  }
  return { personal, demo };
}

export async function mergeArchivedDemo(
  database: FinanceDB,
  imported: LedgerRows,
) {
  const previous = await database.ledgerArchives.get("demo");
  const local = previous
    ? await Dexie.waitFor(copyStoredBlobs(previous.rows))
    : {};
  const merged = { ...imported, ...local };
  for (const [table, rows] of Object.entries(imported)) {
    const key = database.table(table).schema.primKey.name;
    if (!key) throw new Error("Cannot merge records without a primary key.");
    const kept = local[table] ?? [];
    const keys = new Set(kept.map((row) => row[key]));
    merged[table] = [...kept, ...rows.filter((row) => !keys.has(row[key]))];
  }
  await database.ledgerArchives.put({ name: "demo", rows: merged });
  return merged;
}

export async function separateLegacyLedger(database: FinanceDB) {
  if (!(await database.accounts.filter((a) => !!a.isDemo).first())) return;
  const all = await snapshot(database);
  const parts = partitionLegacyRows(all);
  if (!parts) {
    if ((await currentLedger(database)) === "personal")
      await database.ledgerArchives.put({
        name: "personal",
        rows: freshLedger(),
      });
    return;
  }
  await database.ledgerArchives.put({ name: "demo", rows: parts.demo });
  await populate(database, parts.personal);
  if (parts.personal.monthCloses.length)
    await updateClosedMonthSnapshots(database);
}

export async function openDemoLedger() {
  const exists = await db.transaction("rw", db.tables, async () => {
    if ((await currentLedger()) === "demo") return true;
    if (!(await db.ledgerArchives.where(":id").equals("demo").count()))
      return false;
    await activateLedger("demo");
    return true;
  });
  return exists ? { changeId: "" } : loadDemo(true);
}

export async function deleteDemoLedger(database = db) {
  await database.transaction("rw", database.tables, async () => {
    if ((await currentLedger(database)) !== "demo") return;
    await activateLedger("personal", database);
    await database.ledgerArchives.delete("demo");
  });
}
