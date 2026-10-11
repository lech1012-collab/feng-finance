import type {
  Account,
  Category,
  RuleCondition,
  SavedReport,
  Setting,
  Tag,
  Transaction,
} from "../domain/models";
import { filterTransactions } from "../domain/query";
import { effectiveTransactions } from "./effective-transactions";
import { safeSum, currencyPrecision } from "../domain/money";
import { financialType } from "../domain/transaction-type";
import { normalizeMerchant } from "../domain/normalize";
import { reportingPeriod } from "../domain/period";
import { monthLabel, monthOffset } from "../domain/dates";

export interface ReportRow {
  key: string;
  label: string;
  count: number;
  sum: number;
  average: number;
  value: number;
  converted: boolean;
  conversionDates: string[];
  originalCurrencies: string[];
}
export function reportRows(
  transactions: Transaction[],
  report: Pick<SavedReport, "groupBy" | "measure" | "conditions">,
  currency: string,
  categories: Category[] = [],
  accounts: Account[] = [],
  tags: Tag[] = [],
  options: { settings?: Setting[]; periodRows?: Transaction[] } = {},
): ReportRow[] {
  const list = filterTransactions(
    effectiveTransactions(transactions),
    report.conditions,
  ).filter((t) => t.currency === currency && financialType(t) !== "transfer");
  const groups = new Map<string, Transaction[]>();
  // A payday-aligned boundary scans salary history only once per month.
  const periodBounds = new Map<string, [string, string]>();
  const reportMonth = (date: string) => {
    const month = date.slice(0, 7);
    if (!options.settings) return month;
    for (const candidate of [
      monthOffset(month, -1),
      month,
      monthOffset(month, 1),
      monthOffset(month, 2),
    ]) {
      const bounds =
        periodBounds.get(candidate) ??
        reportingPeriod(
          candidate,
          options.settings,
          options.periodRows ?? transactions,
        );
      periodBounds.set(candidate, bounds);
      if (date >= bounds[0] && date < bounds[1]) return candidate;
    }
    return month;
  };
  for (const t of list) {
    const keys =
      report.groupBy === "category"
        ? [t.categoryId ?? "uncategorized"]
        : report.groupBy === "tag"
          ? t.tags.length
            ? t.tags
            : ["untagged"]
          : report.groupBy === "account"
            ? [t.accountId]
            : report.groupBy === "month"
              ? [reportMonth(t.date)]
              : [normalizeMerchant(t.merchant) || "Unknown merchant"];
    for (const key of keys) {
      const rows = groups.get(key) ?? [];
      rows.push(t);
      groups.set(key, rows);
    }
  }
  return [...groups.entries()]
    .map(([key, values]) => {
      const sum = safeSum(values.map((t) => t.amount));
      const count = values.length;
      const average = Math.round(sum / count);
      const label =
        report.groupBy === "category"
          ? (categories.find((c) => c.id === key)?.name ?? "Uncategorized")
          : report.groupBy === "account"
            ? (accounts.find((a) => a.id === key)?.displayName ??
              "Missing account")
            : report.groupBy === "tag"
              ? (tags.find((t) => t.id === key)?.name ?? "Untagged")
              : report.groupBy === "month"
                ? monthLabel(key)
                : key;
      return {
        key,
        label,
        count,
        sum,
        average,
        value:
          report.measure === "count"
            ? count
            : report.measure === "average"
              ? average
              : sum,
        converted: values.some(
          (t) => "originalCurrency" in t && !!t.originalCurrency,
        ),
        conversionDates: [
          ...new Set(
            values.flatMap((t) =>
              "conversion" in t &&
              t.conversion &&
              typeof t.conversion === "object" &&
              "date" in t.conversion
                ? [String(t.conversion.date)]
                : [],
            ),
          ),
        ].sort(),
        originalCurrencies: [
          ...new Set(
            values.flatMap((t) =>
              "originalCurrency" in t && t.originalCurrency
                ? [String(t.originalCurrency)]
                : [],
            ),
          ),
        ].sort(),
      };
    })
    .sort((a, b) =>
      report.groupBy === "month"
        ? a.key.localeCompare(b.key)
        : Math.abs(b.value) - Math.abs(a.value),
    );
}

export function reportGroupCondition(
  row: ReportRow,
  groupBy: SavedReport["groupBy"],
  settings: Setting[] = [],
  transactions: Transaction[] = [],
): RuleCondition {
  if (groupBy === "month") {
    const [from, to] = reportingPeriod(row.key, settings, transactions);
    return {
      field: "date",
      operator: "between",
      value: from,
      valueTo: new Date(Date.parse(to) - 86400000).toISOString().slice(0, 10),
    };
  }
  return {
    field:
      groupBy === "category"
        ? "categoryId"
        : groupBy === "account"
          ? "accountId"
          : groupBy === "tag"
            ? "tag"
            : "displayMerchant",
    operator: "equals",
    value: row.key === "uncategorized" || row.key === "untagged" ? "" : row.key,
  };
}

export function ukTaxYear(year: number) {
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2100)
    throw new Error("Choose a valid UK tax year.");
  return {
    from: `${year}-04-06`,
    to: `${year + 1}-04-05`,
    label: `${year}/${String(year + 1).slice(2)}`,
  };
}

export function propertyTaxSummary(
  transactions: Transaction[],
  year: number,
  allowableCategoryIds: string[],
  currency: string,
) {
  const period = ukTaxYear(year);
  const list = effectiveTransactions(transactions).filter(
    (t) =>
      t.currency === currency &&
      t.date >= period.from &&
      t.date <= period.to &&
      financialType(t) !== "transfer",
  );
  const incomeRows = list.filter(
    (t) => t.categoryId === "property-income" && t.amount > 0,
  );
  const expenseRows = list.filter(
    (t) =>
      t.amount < 0 &&
      (allowableCategoryIds.includes(t.categoryId ?? "") ||
        allowableCategoryIds.includes(t.subcategoryId ?? "")),
  );
  const income = safeSum(incomeRows.map((t) => t.amount));
  const expenses = -safeSum(expenseRows.map((t) => t.amount));
  return {
    ...period,
    income,
    expenses,
    net: income - expenses,
    transactions: [...incomeRows, ...expenseRows],
  };
}

const csv = (value: unknown) => {
  const text = String(value ?? "");
  // Spreadsheet formula defence applies to arbitrary imported text, not numbers.
  const safe =
    typeof value === "number"
      ? text
      : /^[=+\-@\t\r]/.test(text)
        ? `'${text}`
        : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
function decimal(amount: number, currency: string) {
  const precision = currencyPrecision(currency);
  const factor = 10 ** precision;
  return `${amount < 0 ? "-" : ""}${Math.floor(Math.abs(amount) / factor)}${precision ? `.${String(Math.abs(amount) % factor).padStart(precision, "0")}` : ""}`;
}
/** Export original ledger amounts, replacing split parents with their child rows. */
export function transactionsCsv(
  transactions: Transaction[],
  accounts: Account[] = [],
  categories: Category[] = [],
  tags: Tag[] = [],
  conditions: RuleCondition[] = [],
) {
  const splitIds = new Set(
    transactions.filter((t) => t.parentId).map((t) => t.parentId),
  );
  const list = filterTransactions(
    transactions.filter(
      (t) => t.kind !== "split_parent" && !splitIds.has(t.id),
    ),
    conditions,
  );
  const fields = [
    "Date",
    "Description",
    "Merchant",
    "Amount",
    "Currency",
    "Account",
    "Institution",
    "Type",
    "Kind",
    "Category",
    "Subcategory",
    "Tags",
    "Statement ID",
    "Transaction ID",
    "Parent ID",
    "Source",
    "Source page",
    "Reviewed",
    "Rule ID",
    "Note",
    "Booking date",
    "Balance after transaction",
    "Confidence",
    "Transfer pair ID",
    "Refund allocations",
    "Created at",
    "Updated at",
    "Account ID",
    "Category ID",
    "Subcategory ID",
    "Tag IDs",
    "Source merchant",
    "Category source",
    "Applied rule IDs",
    "Fingerprint",
    "Occurrence",
    "Is transfer",
    "Link ID",
    "Recurring series ID",
    "Attachment IDs",
    "Demo",
  ];
  const rows = list.map((t) => {
    const account = accounts.find((a) => a.id === t.accountId);
    const amount = decimal(t.amount, t.currency);
    const values = [
      t.date,
      t.description,
      t.merchant,
      amount,
      t.currency,
      account?.displayName ?? t.accountId,
      account?.institution,
      financialType(t),
      t.kind ?? "normal",
      categories.find((c) => c.id === t.categoryId)?.name ?? "",
      categories.find((c) => c.id === t.subcategoryId)?.name ?? "",
      t.tags
        .map((id) => tags.find((tag) => tag.id === id)?.name ?? id)
        .join("|"),
      t.statementId,
      t.id,
      t.parentId,
      t.source ?? "pdf",
      t.sourcePage,
      t.isReviewed,
      t.categoryRuleId,
      t.note,
      t.bookingDate,
      t.balanceAfterTransaction === undefined
        ? undefined
        : decimal(t.balanceAfterTransaction, t.currency),
      t.extractionConfidence,
      t.transferPairId,
      JSON.stringify(t.refundAllocations ?? []),
      t.createdAt,
      t.updatedAt,
      t.accountId,
      t.categoryId,
      t.subcategoryId,
      t.tags.join("|"),
      t.sourceMerchant,
      t.categorySource,
      t.appliedRuleIds?.join("|"),
      t.transactionFingerprint,
      t.occurrence,
      t.isTransfer,
      t.linkId,
      t.recurringSeriesId,
      t.attachmentIds?.join("|"),
      t.isDemo ?? false,
    ];
    return values
      .map((value, i) =>
        i === 3 || i === 21 ? `"${String(value ?? "")}"` : csv(value),
      )
      .join(",");
  });
  return "\uFEFF" + [fields.map(csv).join(","), ...rows].join("\r\n");
}
