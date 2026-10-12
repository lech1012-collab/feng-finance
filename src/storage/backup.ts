import {
  db,
  defaultCategories,
  defaultRules,
  type FinanceDB,
} from "./database";
import {
  SCHEMA_VERSION,
  type Backup,
  type ChangeLog,
  type SerializedAttachment,
  type Transaction,
} from "../domain/models";
import { decimalMoney } from "../domain/money";
import { backupSchema, auditRecordSchemas } from "./backup-schema";
import { auditedMutation } from "./audit";
import { UnsupportedBackupVersionError } from "./backup-error";
import {
  BackupFileTooLargeError,
  MAX_BACKUP_FILE_BYTES,
} from "./backup-limits";
import { SECURITY_CHANGE_EVENT } from "../security/events";

const extraTables = [
  "valuations",
  "pots",
  "budgets",
  "tags",
  "recurringSeries",
  "monthCloses",
  "attachments",
  "fxRates",
  "transferProposals",
  "savedViews",
  "savedReports",
  "scenarios",
  "changeLog",
  "layoutTemplates",
] as const;
const securityKey = (key: string) => key.startsWith("security:");
const sum = (values: number[]) =>
  values.reduce((total, value) => total + BigInt(value), 0n);

export function validateBackup(input: unknown): Backup {
  if (input && typeof input === "object") {
    const header = input as {
      format?: unknown;
      version?: unknown;
      schemaVersion?: unknown;
    };
    if (
      header.format === "feng-finance" &&
      ((typeof header.version === "number" && header.version > 1) ||
        (typeof header.schemaVersion === "number" &&
          header.schemaVersion > SCHEMA_VERSION))
    )
      throw new UnsupportedBackupVersionError();
  }
  const b = backupSchema.parse(input);
  const unique = (items: { id: string }[]) =>
    new Set(items.map((x) => x.id)).size === items.length;
  const idCollections = [
    b.accounts,
    b.statements,
    b.transactions,
    b.categories,
    b.rules,
    b.transferLinks,
    b.valuations ?? [],
    b.pots ?? [],
    b.budgets ?? [],
    b.tags ?? [],
    b.recurringSeries ?? [],
    b.attachments ?? [],
    b.fxRates ?? [],
    b.transferProposals ?? [],
    b.savedViews ?? [],
    b.savedReports ?? [],
    b.scenarios ?? [],
    b.changeLog ?? [],
    b.layoutTemplates ?? [],
  ];
  if (
    !idCollections.every(unique) ||
    new Set(b.settings.map((s) => s.key)).size !== b.settings.length ||
    new Set((b.monthCloses ?? []).map((close) => close.month)).size !==
      (b.monthCloses ?? []).length
  )
    throw new Error("Backup contains duplicate identifiers.");
  const accounts = new Map(b.accounts.map((a) => [a.id, a]));
  const statements = new Map(b.statements.map((s) => [s.id, s]));
  const categories = new Map(b.categories.map((c) => [c.id, c]));
  const transactions = new Map(b.transactions.map((t) => [t.id, t]));
  const links = new Map(b.transferLinks.map((l) => [l.id, l]));
  const tags = new Map((b.tags ?? []).map((tag) => [tag.id, tag]));
  const attachments = new Map(
    (b.attachments ?? []).map((attachment) => [attachment.id, attachment]),
  );
  const series = new Map((b.recurringSeries ?? []).map((row) => [row.id, row]));
  const validCategory = (main?: string, sub?: string) =>
    (!main && !sub) ||
    (!!main &&
      categories.has(main) &&
      (!sub || categories.get(sub)?.parentId === main));
  for (const c of b.categories)
    if (
      c.parentId &&
      (!categories.has(c.parentId) ||
        categories.get(c.parentId)?.parentId ||
        categories.get(c.parentId)?.kind !== c.kind)
    )
      throw new Error("Invalid category hierarchy.");
  for (const s of b.statements)
    if (
      !accounts.has(s.accountId) ||
      accounts.get(s.accountId)?.currency !== s.currency ||
      s.statementPeriodStart > s.statementPeriodEnd
    )
      throw new Error("Invalid statement account or period.");
  const counts = new Map<string, number>();
  const refundTotals = new Map<string, bigint>();
  for (const t of b.transactions) {
    const s = statements.get(t.statementId);
    const parent = t.parentId ? transactions.get(t.parentId) : undefined;
    const manual = t.source === "manual" || parent?.source === "manual";
    if (
      !accounts.has(t.accountId) ||
      accounts.get(t.accountId)?.currency !== t.currency ||
      (!manual && t.sourcePage < 1) ||
      (!manual &&
        (!s || s.accountId !== t.accountId || s.currency !== t.currency)) ||
      !validCategory(t.categoryId, t.subcategoryId) ||
      t.isTransfer !== (t.type === "transfer") ||
      (t.transferPairId &&
        !links.get(t.transferPairId)?.transactionIds.includes(t.id))
    )
      throw new Error("Backup contains inconsistent transaction references.");
    if (
      t.parentId &&
      (!parent ||
        parent.kind !== "split_parent" ||
        parent.parentId ||
        parent.accountId !== t.accountId ||
        parent.currency !== t.currency ||
        parent.date !== t.date ||
        parent.statementId !== t.statementId ||
        t.kind === "split_parent" ||
        t.isTransfer)
    )
      throw new Error("Backup contains an invalid split transaction.");
    if (!t.parentId && !manual)
      counts.set(t.statementId, (counts.get(t.statementId) ?? 0) + 1);
    for (const attachmentId of t.attachmentIds ?? [])
      if (attachments.get(attachmentId)?.transactionId !== t.id)
        throw new Error("Backup contains an invalid attachment reference.");
    if (t.recurringSeriesId && !series.has(t.recurringSeriesId))
      throw new Error("Backup contains an invalid recurring-series reference.");
    if (t.kind === "refund" && t.amount <= 0)
      throw new Error("Refunds must be positive money-in transactions.");
    if (t.refundAllocations?.length) {
      if (
        t.kind !== "refund" ||
        t.amount <= 0 ||
        sum(t.refundAllocations.map((allocation) => allocation.amount)) !==
          BigInt(t.amount) ||
        new Set(
          t.refundAllocations.map((allocation) => allocation.transactionId),
        ).size !== t.refundAllocations.length
      )
        throw new Error("Backup contains an invalid refund allocation.");
      for (const allocation of t.refundAllocations) {
        const purchase = transactions.get(allocation.transactionId);
        if (
          !purchase ||
          purchase.amount >= 0 ||
          purchase.currency !== t.currency ||
          purchase.isTransfer ||
          purchase.parentId ||
          purchase.date > t.date
        )
          throw new Error("Backup contains an invalid refund purchase.");
        refundTotals.set(
          purchase.id,
          (refundTotals.get(purchase.id) ?? 0n) + BigInt(allocation.amount),
        );
      }
    }
  }
  for (const [id, total] of refundTotals)
    if (total > BigInt(-transactions.get(id)!.amount))
      throw new Error("Refunds exceed the original purchase amount.");
  for (const parent of b.transactions.filter(
    (t) => t.kind === "split_parent",
  )) {
    const children = b.transactions.filter((t) => t.parentId === parent.id);
    if (
      children.length < 2 ||
      children.length > 20 ||
      parent.categoryId ||
      parent.isTransfer ||
      children.some(
        (child) =>
          Math.sign(child.amount) !== Math.sign(parent.amount) ||
          !child.categoryId,
      ) ||
      sum(children.map((child) => child.amount)) !== BigInt(parent.amount)
    )
      throw new Error("Split amounts do not equal their original transaction.");
  }
  for (const s of b.statements)
    if (s.transactionCount !== (counts.get(s.id) ?? 0))
      throw new Error("Backup statement transaction count does not match.");
  const validAction = (
    action: NonNullable<Backup["rules"][number]["actions"]>[number],
  ) => {
    if (action.type === "category")
      return (
        !!action.categoryId &&
        validCategory(action.categoryId, action.subcategoryId)
      );
    if (action.type === "tag")
      return (
        !!action.tagIds?.length && action.tagIds.every((id) => tags.has(id))
      );
    if (action.type === "rename") return !!action.merchant?.trim();
    if (action.type === "kind") return !!action.kind;
    if (action.type === "reviewed") return typeof action.reviewed === "boolean";
    if (action.type === "recurring")
      return !!action.recurringSeriesId && series.has(action.recurringSeriesId);
    return (
      !!action.splits &&
      action.splits.length >= 2 &&
      Math.abs(
        action.splits.reduce((total, row) => total + row.percentage, 0) - 100,
      ) < 0.00000001 &&
      action.splits.every(
        (row) =>
          categories.has(row.categoryId) &&
          categories.get(row.categoryId)?.kind === "expense" &&
          (row.tagIds ?? []).every((id) => tags.has(id)),
      )
    );
  };
  for (const r of b.rules)
    if (
      (r.accountId && !accounts.has(r.accountId)) ||
      !validCategory(r.categoryId, r.subcategoryId) ||
      (r.type !== "transfer" && !r.categoryId && !r.actions?.length) ||
      (r.minAmount !== undefined &&
        r.maxAmount !== undefined &&
        r.minAmount > r.maxAmount) ||
      r.actions?.some((action) => !validAction(action))
    )
      throw new Error("Invalid categorization rule.");
  for (const l of b.transferLinks) {
    const [a, c] = l.transactionIds.map((id) => transactions.get(id));
    if (
      !a ||
      !c ||
      a.id === c.id ||
      a.accountId === c.accountId ||
      a.amount === 0 ||
      c.amount === 0 ||
      Math.sign(a.amount) === Math.sign(c.amount) ||
      (a.currency === c.currency
        ? a.amount !== -c.amount
        : !l.manual || !l.crossCurrency) ||
      a.transferPairId !== l.id ||
      c.transferPairId !== l.id ||
      !a.isTransfer ||
      !c.isTransfer
    )
      throw new Error("Invalid transfer link.");
  }
  for (const row of b.valuations ?? [])
    if (!accounts.has(row.accountId))
      throw new Error("Invalid valuation account.");
  for (const row of b.pots ?? [])
    if (
      (row.linkedAccountId && !accounts.has(row.linkedAccountId)) ||
      (row.linkedCategoryId && !categories.has(row.linkedCategoryId)) ||
      new Set(row.contributions.map((c) => c.month)).size !==
        row.contributions.length
    )
      throw new Error("Invalid pot reference or duplicate contribution month.");
  for (const row of b.budgets ?? [])
    if (
      !categories.has(row.categoryId) ||
      categories.get(row.categoryId)?.kind !== "expense"
    )
      throw new Error("Invalid budget category.");
  for (const row of b.recurringSeries ?? [])
    if (
      !accounts.has(row.accountId) ||
      accounts.get(row.accountId)?.currency !== row.currency
    )
      throw new Error("Invalid recurring-series account.");
  for (const row of b.attachments ?? []) {
    const decodedBytes =
      (row.dataBase64.length * 3) / 4 -
      (row.dataBase64.endsWith("==")
        ? 2
        : row.dataBase64.endsWith("=")
          ? 1
          : 0);
    if (
      !transactions.get(row.transactionId)?.attachmentIds?.includes(row.id) ||
      decodedBytes !== row.sizeBytes
    )
      throw new Error("Invalid attachment data or owner.");
  }
  for (const row of b.transferProposals ?? []) {
    const debit = transactions.get(row.debitTxId),
      credit = transactions.get(row.creditTxId);
    if (
      !debit ||
      !credit ||
      debit.accountId === credit.accountId ||
      debit.amount >= 0 ||
      credit.amount <= 0 ||
      (debit.currency === credit.currency && debit.amount !== -credit.amount) ||
      (debit.currency !== credit.currency && !row.crossCurrency) ||
      (row.status === "confirmed" &&
        (!debit.transferPairId ||
          debit.transferPairId !== credit.transferPairId ||
          !links.has(debit.transferPairId)))
    )
      throw new Error("Invalid transfer proposal.");
  }
  const tableNames = new Set([
    "accounts",
    "statements",
    "transactions",
    "categories",
    "rules",
    "transferLinks",
    "settings",
    ...extraTables.filter((name) => name !== "changeLog"),
  ]);
  for (const entry of b.changeLog ?? [])
    if (
      entry.changes.some(
        (change) =>
          !tableNames.has(change.table) ||
          (change.table === "settings" && securityKey(change.key)),
      )
    )
      throw new Error("Invalid audit history.");
  for (const entry of b.changeLog ?? [])
    for (const change of entry.changes) {
      for (const side of ["before", "after"] as const)
        if (change[side] !== undefined) {
          const parsed = auditRecordSchemas[change.table].parse(
            change[side],
          ) as Record<string, unknown>;
          const rowKey =
            parsed[
              change.table === "settings"
                ? "key"
                : change.table === "monthCloses"
                  ? "month"
                  : "id"
            ];
          if (rowKey !== change.key)
            throw new Error(
              "Audit history contains an invalid record identifier.",
            );
          change[side] = parsed;
        }
    }
  return b;
}

const blobBytes = async (blob: Blob): Promise<ArrayBuffer> => {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Attachment could not be read."));
    reader.readAsArrayBuffer(blob);
  });
};
const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blobBytes(blob));
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(""));
};
const fromBase64 = (base64: string, mime: string) => {
  const decoded = atob(base64);
  const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
};
async function encodeAuditValue(value: unknown): Promise<unknown> {
  if (value instanceof Blob)
    return {
      __fengBlob: { mime: value.type, dataBase64: await toBase64(value) },
    };
  if (Array.isArray(value)) return Promise.all(value.map(encodeAuditValue));
  if (value && typeof value === "object")
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, entry]) => [
          key,
          await encodeAuditValue(entry),
        ]),
      ),
    );
  return value;
}
function decodeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeAuditValue);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const marker = object.__fengBlob as
      { mime?: unknown; dataBase64?: unknown } | undefined;
    if (
      marker &&
      typeof marker.mime === "string" &&
      typeof marker.dataBase64 === "string"
    )
      return fromBase64(marker.dataBase64, marker.mime);
    return Object.fromEntries(
      Object.entries(object).map(([key, entry]) => [
        key,
        decodeAuditValue(entry),
      ]),
    );
  }
  return value;
}
export async function createBackup(
  options: { includeAttachments?: boolean } = {},
  database: FinanceDB = db,
): Promise<Backup> {
  const includeAttachments = options.includeAttachments !== false;
  const snapshot = await database.transaction(
    "r",
    database.tables,
    async () => ({
      format: "feng-finance" as const,
      version: 1 as const,
      schemaVersion: SCHEMA_VERSION,
      moneyUnit: "minor" as const,
      exportedAt: new Date().toISOString(),
      accounts: await database.accounts.toArray(),
      statements: await database.statements.toArray(),
      transactions: (await database.transactions.toArray()).map(
        (transaction) => ({
          ...transaction,
          tags: transaction.tags ?? [],
          occurrence: transaction.occurrence ?? 0,
          isReviewed: transaction.isReviewed ?? false,
        }),
      ),
      categories: await database.categories.toArray(),
      rules: await database.rules.toArray(),
      transferLinks: await database.transferLinks.toArray(),
      settings: (await database.settings.toArray()).filter(
        (setting) => !securityKey(setting.key),
      ),
      valuations: await database.valuations.toArray(),
      pots: await database.pots.toArray(),
      budgets: await database.budgets.toArray(),
      tags: await database.tags.toArray(),
      recurringSeries: await database.recurringSeries.toArray(),
      monthCloses: await database.monthCloses.toArray(),
      attachments: includeAttachments
        ? await database.attachments.toArray()
        : [],
      fxRates: await database.fxRates.toArray(),
      transferProposals: await database.transferProposals.toArray(),
      savedViews: await database.savedViews.toArray(),
      savedReports: await database.savedReports.toArray(),
      scenarios: await database.scenarios.toArray(),
      changeLog: await database.changeLog.toArray(),
      layoutTemplates: await database.layoutTemplates.toArray(),
    }),
  );
  const portableAttachments: SerializedAttachment[] = await Promise.all(
    snapshot.attachments.map(async ({ blob, ...metadata }) => ({
      ...metadata,
      dataBase64: await toBase64(blob),
    })),
  );
  const portableAudit = snapshot.changeLog.filter(
    (entry) =>
      !entry.changes.some(
        (change) =>
          ["safetyBackups", "importDiagnostics"].includes(change.table) ||
          (change.table === "settings" && securityKey(change.key)) ||
          (!includeAttachments &&
            (change.table === "attachments" ||
              (change.table === "transactions" &&
                [change.before, change.after].some(
                  (value) =>
                    !!(value as Transaction | undefined)?.attachmentIds?.length,
                )))),
      ),
  );
  return {
    ...snapshot,
    transactions: includeAttachments
      ? snapshot.transactions
      : snapshot.transactions.map((transaction) => ({
          ...transaction,
          attachmentIds: [],
        })),
    attachments: portableAttachments,
    changeLog: (await encodeAuditValue(portableAudit)) as ChangeLog[],
  };
}
export async function restoreBackup(input: unknown, database: FinanceDB = db) {
  const backup = validateBackup(input);
  const attachments = (backup.attachments ?? []).map(
    ({ dataBase64, ...metadata }) => ({
      ...metadata,
      blob: fromBase64(dataBase64, metadata.mime),
    }),
  );
  const history = decodeAuditValue(backup.changeLog ?? []) as ChangeLog[];
  return auditedMutation(
    "Restore backup",
    database.tables.map((table) => table.name),
    async () => {
      const localSecurity = await database.settings
        .filter((setting) => securityKey(setting.key))
        .toArray();
      for (const table of database.tables) await table.clear();
      await database.accounts.bulkAdd(backup.accounts);
      await database.statements.bulkAdd(backup.statements);
      await database.transactions.bulkAdd(backup.transactions);
      await database.categories.bulkAdd(backup.categories);
      await database.rules.bulkAdd(backup.rules);
      await database.transferLinks.bulkAdd(backup.transferLinks);
      await database.settings.bulkPut(
        backup.settings.filter((setting) => !securityKey(setting.key)),
      );
      await database.settings.bulkPut(localSecurity);
      for (const name of extraTables)
        if (name !== "attachments" && name !== "changeLog")
          await database.table(name).bulkAdd(backup[name] ?? []);
      await database.attachments.bulkAdd(attachments);
      await database.changeLog.bulkAdd(history);
      await database.settings.put({ key: "initialized", value: "true" });
    },
    database,
  );
}
export async function clearLocalData() {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
    await db.categories.bulkPut(defaultCategories);
    await db.rules.bulkPut(defaultRules);
    await db.settings.put({ key: "initialized", value: "true" });
  });
  window.dispatchEvent(new Event(SECURITY_CHANGE_EVENT));
}
/** Remove statement history but retain accounts, user categories, rules, budgets and goals. */
export async function deleteImportedRecords() {
  return auditedMutation(
    "Delete imported records",
    [
      "statements",
      "transactions",
      "transferLinks",
      "transferProposals",
      "attachments",
      "monthCloses",
    ],
    async () => {
      const all = await db.transactions.toArray();
      const manualParents = new Set(
        all
          .filter((transaction) => transaction.source === "manual")
          .map((transaction) => transaction.id),
      );
      const imported = all.filter(
        (transaction) =>
          transaction.source !== "manual" &&
          !(transaction.parentId && manualParents.has(transaction.parentId)),
      );
      const ids = new Set(imported.map((transaction) => transaction.id));
      if (
        all.some(
          (transaction) =>
            !ids.has(transaction.id) &&
            transaction.refundAllocations?.some((allocation) =>
              ids.has(allocation.transactionId),
            ),
        )
      )
        throw new Error(
          "A manually entered refund is linked to an imported purchase. Unlink or delete that refund before deleting imported records.",
        );
      for (const link of await db.transferLinks.toArray())
        if (link.transactionIds.some((id) => ids.has(id))) {
          for (const retainedId of link.transactionIds.filter(
            (id) => !ids.has(id),
          ))
            await db.transactions.update(retainedId, {
              transferPairId: undefined,
              linkId: undefined,
            });
          await db.transferLinks.delete(link.id);
        }
      await db.transferProposals
        .filter(
          (proposal) =>
            ids.has(proposal.debitTxId) || ids.has(proposal.creditTxId),
        )
        .delete();
      await db.attachments
        .where("transactionId")
        .anyOf([...ids])
        .delete();
      await db.transactions.bulkDelete([...ids]);
      await db.statements.clear();
      await db.monthCloses.clear();
    },
  );
}

export function download(contents: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function backupExportSettings(
  backup: Pick<Backup, "exportedAt" | "transactions">,
) {
  return [
    { key: "backup:lastExportAt", value: backup.exportedAt },
    {
      key: "backup:lastExportCount",
      value: String(backup.transactions.length),
    },
    { key: "backup:importsSinceExport", value: "0" },
  ];
}
/** Call only after a download handoff succeeds; this does not prove that Files saved it. */
export async function markBackupExported(
  backup: Pick<Backup, "exportedAt" | "transactions">,
  database: FinanceDB = db,
) {
  return auditedMutation(
    "Record backup export",
    ["settings"],
    async () => database.settings.bulkPut(backupExportSettings(backup)),
    database,
  );
}
export async function exportBackupFile(
  options: { includeAttachments?: boolean } = {},
) {
  const backup = await createBackup(options);
  const metadata = backupExportSettings(backup);
  backup.settings = [
    ...backup.settings.filter(
      (setting) => !metadata.some((entry) => entry.key === setting.key),
    ),
    ...metadata,
  ];
  const contents = JSON.stringify(backup, null, 2);
  if (new Blob([contents]).size > MAX_BACKUP_FILE_BYTES)
    throw new BackupFileTooLargeError();
  download(
    contents,
    "application/json",
    `feng-finance-backup-${backup.exportedAt.slice(0, 10)}.json`,
  );
  await markBackupExported(backup);
  return backup;
}
/** Portable native-money rows: split children replace their parent; refunds retain their arrival row. */
export async function exportCsv(database: FinanceDB = db) {
  const snapshot = await database.transaction(
    "r",
    database.transactions,
    database.accounts,
    database.categories,
    database.tags,
    async () => ({
      transactions: await database.transactions.orderBy("date").toArray(),
      accounts: await database.accounts.toArray(),
      categories: await database.categories.toArray(),
      tags: await database.tags.toArray(),
    }),
  );
  const splitParents = new Set(
    snapshot.transactions
      .filter((transaction) => !!transaction.parentId)
      .map((transaction) => transaction.parentId!),
  );
  const transactions = snapshot.transactions.filter(
    (transaction) =>
      transaction.kind !== "split_parent" && !splitParents.has(transaction.id),
  );
  const accounts = new Map(
    snapshot.accounts.map((account) => [account.id, account]),
  );
  const categories = new Map(
    snapshot.categories.map((category) => [category.id, category]),
  );
  const tags = new Map(snapshot.tags.map((tag) => [tag.id, tag.name]));
  const cell = (value: unknown, numeric = false) => {
    const str = String(value ?? "");
    return (
      '"' +
      (!numeric && /^[\s]*[=+\-@\t\r]/.test(str) ? "'" + str : str).replaceAll(
        '"',
        '""',
      ) +
      '"'
    );
  };
  const header = [
    "Date",
    "Description",
    "Merchant",
    "Amount",
    "Currency",
    "Account",
    "Institution",
    "Type",
    "Category",
    "Subcategory",
    "Tags",
    "Statement ID",
    "Transaction ID",
    "Parent ID",
    "Kind",
    "Source",
    "Reviewed",
    "Note",
  ];
  const rows = transactions.map((transaction) => {
    const account = accounts.get(transaction.accountId);
    return [
      transaction.date,
      transaction.description,
      transaction.merchant,
      decimalMoney(transaction.amount, transaction.currency),
      transaction.currency,
      account?.displayName,
      account?.institution,
      transaction.type,
      categories.get(transaction.categoryId ?? "")?.name,
      categories.get(transaction.subcategoryId ?? "")?.name,
      (transaction.tags ?? []).map((tag) => tags.get(tag) ?? tag).join("|"),
      transaction.statementId,
      transaction.id,
      transaction.parentId,
      transaction.kind ?? (transaction.isTransfer ? "transfer" : "normal"),
      transaction.source ?? "pdf",
      transaction.isReviewed ? "Yes" : "No",
      transaction.note,
    ]
      .map((value, index) => cell(value, index === 3))
      .join(",");
  });
  return (
    "\uFEFF" +
    header.map((value) => cell(value)).join(",") +
    "\r\n" +
    rows.join("\r\n")
  );
}
