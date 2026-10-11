import Dexie, { type EntityTable } from "dexie";
import type {
  Account,
  Statement,
  Transaction,
  Category,
  Rule,
  TransferLink,
  Setting,
  ManualValuation,
  Pot,
  MonthlyBudget,
  Tag,
  RecurringSeries,
  MonthClose,
  Attachment,
  FxRate,
  TransferProposal,
  SavedView,
  SavedReport,
  Scenario,
  ChangeLog,
} from "../domain/models";
export class FinanceDB extends Dexie {
  accounts!: EntityTable<Account, "id">;
  statements!: EntityTable<Statement, "id">;
  transactions!: EntityTable<Transaction, "id">;
  categories!: EntityTable<Category, "id">;
  rules!: EntityTable<Rule, "id">;
  transferLinks!: EntityTable<TransferLink, "id">;
  settings!: EntityTable<Setting, "key">;
  valuations!: EntityTable<ManualValuation, "id">;
  pots!: EntityTable<Pot, "id">;
  budgets!: EntityTable<MonthlyBudget, "id">;
  tags!: EntityTable<Tag, "id">;
  recurringSeries!: EntityTable<RecurringSeries, "id">;
  monthCloses!: EntityTable<MonthClose, "month">;
  attachments!: EntityTable<Attachment, "id">;
  fxRates!: EntityTable<FxRate, "id">;
  transferProposals!: EntityTable<TransferProposal, "id">;
  savedViews!: EntityTable<SavedView, "id">;
  savedReports!: EntityTable<SavedReport, "id">;
  scenarios!: EntityTable<Scenario, "id">;
  changeLog!: EntityTable<ChangeLog, "id">;
  constructor(name = "feng-finance") {
    super(name);
    this.version(1).stores({
      accounts: "id,institution,currency",
      statements:
        "id,accountId,sourceFileHash,statementPeriodEnd,[accountId+statementPeriodStart+statementPeriodEnd]",
      transactions:
        "id,date,accountId,statementId,categoryId,transactionFingerprint,[currency+date],[accountId+date]",
      categories: "id,parentId",
      rules: "id,priority",
      transferLinks: "id",
      settings: "key",
    });
    this.version(2)
      .stores({
        transactions:
          "id,date,accountId,statementId,categoryId,transactionFingerprint,[currency+date],[accountId+date],merchant",
      })
      .upgrade(async (tx) => {
        await tx
          .table<Transaction>("transactions")
          .toCollection()
          .modify((t) => {
            t.occurrence ??= 0;
            t.isReviewed ??= false;
            t.tags ??= [];
          });
      });
    this.version(3)
      .stores({
        accounts: "id,institution,currency,accountType,tracking",
        transactions:
          "id,date,accountId,statementId,categoryId,transactionFingerprint,[currency+date],[accountId+date],merchant,parentId,kind,source,*tags",
        valuations: "id,accountId,date,[accountId+date]",
        pots: "id,type,linkedAccountId,linkedCategoryId",
        budgets: "id,month,categoryId,[currency+month],[categoryId+month]",
        tags: "id,name",
        recurringSeries: "id,accountId,nextDue,status,matchKey",
        monthCloses: "month,closedAt",
        attachments: "id,transactionId",
        fxRates: "id,date,[base+quote+date]",
        transferProposals: "id,debitTxId,creditTxId,status",
        savedViews: "id,name",
        savedReports: "id,name",
        scenarios: "id,createdAt",
        changeLog: "id,createdAt,undoneAt",
      })
      .upgrade(async (tx) => {
        await tx
          .table<Account>("accounts")
          .toCollection()
          .modify((a) => {
            a.tracking ??= "statement";
            a.includeInNetWorth ??= true;
          });
        await tx
          .table<Transaction>("transactions")
          .toCollection()
          .modify((t) => {
            t.kind ??= t.isTransfer ? "transfer" : "normal";
            t.source ??= "pdf";
            t.attachmentIds ??= [];
          });
        await tx
          .table<Rule>("rules")
          .toCollection()
          .modify((r) => {
            r.enabled ??= true;
            r.stopProcessing ??= true;
            r.singleUse ??= false;
          });
        // Existing links are financial history, so changing the matching default must not unlink them.
        await tx
          .table<Setting>("settings")
          .put({ key: "transferMatching", value: "manual" });
        await tx
          .table<Setting>("settings")
          .put({ key: "transferDateWindowDays", value: "4" });
      });
  }
}
export const db = new FinanceDB();
export async function initializeDatabase(database = db) {
  await database.transaction(
    "rw",
    database.categories,
    database.rules,
    database.settings,
    database.changeLog,
    async () => {
      await database.changeLog
        .where("createdAt")
        .below(new Date(Date.now() - 90 * 86400000).toISOString())
        .delete();
      for (const setting of [
        { key: "transferMatching", value: "manual" },
        { key: "transferDateWindowDays", value: "4" },
        {
          key: "reportingCurrency",
          value: (await database.settings.get("currency"))?.value ?? "GBP",
        },
        { key: "fxSource", value: "download" },
      ])
        if (!(await database.settings.get(setting.key)))
          await database.settings.put(setting);
      if (await database.settings.get("initialized")) {
        if (!(await database.settings.get("defaults-1.1"))) {
          const cleaning = defaultCategories.find((c) => c.id === "cleaning")!;
          if (!(await database.categories.get(cleaning.id)))
            await database.categories.add(cleaning);
          for (const r of defaultRules.filter((r) =>
            ["XIAOMI", "REFERENCE: RENT", "TAX FREE CHILDCARE"].includes(
              r.pattern,
            ),
          ))
            if (!(await database.rules.get(r.id))) await database.rules.add(r);
          await database.settings.put({ key: "defaults-1.1", value: "true" });
        }
        return;
      }
      await database.categories.bulkPut(defaultCategories);
      await database.rules.bulkPut(defaultRules);
      await database.settings.put({ key: "initialized", value: "true" });
      await database.settings.put({ key: "defaults-1.1", value: "true" });
    },
  );
}
const expenses = [
  "Groceries",
  "Shopping",
  "Restaurants",
  "Takeaway",
  "Transport",
  "Travel",
  "Childcare",
  "Utilities",
  "Subscriptions",
  "Insurance",
  "Healthcare",
  "Entertainment",
  "Household",
  "Cleaning",
  "Property",
  "Fees",
  "Cash withdrawal",
  "Other",
];
const incomes = [
  "Salary",
  "Property income",
  "Interest",
  "Refund",
  "Other income",
];
const colors = [
  "#536079",
  "#48708b",
  "#a07650",
  "#86689c",
  "#526ea1",
  "#4b5f86",
];
export function categoryId(name: string) {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}
export const defaultCategories: Category[] = [
  ...incomes.map((name, i) => ({
    id: categoryId(name),
    name,
    kind: "income" as const,
    archived: false,
    color: colors[i % colors.length],
  })),
  ...expenses.map((name, i) => ({
    id: categoryId(name),
    name,
    kind: "expense" as const,
    archived: false,
    color: colors[i % colors.length],
  })),
  ...[
    "Mortgage / financing",
    "Service charge",
    "Repairs",
    "Maintenance",
    "Insurance",
    "Utilities",
    "Tax",
    "Management fees",
    "Other property cost",
  ].map((name) => ({
    id: `property-${categoryId(name)}`,
    parentId: "property",
    name,
    kind: "expense" as const,
    archived: false,
    color: "#536079",
  })),
];
const mappings: Record<string, string[]> = {
  Groceries: ["WAITROSE", "SAINSBURY", "TESCO", "LIDL", "ALDI"],
  Shopping: ["JOHN LEWIS", "IKEA", "XIAOMI"],
  Transport: ["TFL", "UBER"],
  Subscriptions: ["NETFLIX", "SPOTIFY"],
  Salary: ["SIEMENS", "SALARY"],
  "Property income": ["RENT RECEIVED", "RENTAL INCOME", "REFERENCE: RENT"],
  Childcare: ["NURSERY", "TAX FREE CHILDCARE"],
  Property: ["MORTGAGE", "SERVICE CHARGE"],
  Restaurants: ["RESTAURANT"],
  Utilities: ["OCTOPUS ENERGY"],
};
export const defaultRules: Rule[] = Object.entries(mappings).flatMap(
  ([name, patterns]) =>
    patterns.map((pattern) => ({
      id: `builtin-${categoryId(pattern)}`,
      name: `${pattern} → ${name}`,
      match: "contains" as const,
      pattern,
      direction: incomes.includes(name)
        ? ("positive" as const)
        : ("negative" as const),
      categoryId: categoryId(name),
      subcategoryId:
        pattern === "MORTGAGE"
          ? "property-mortgage-financing"
          : pattern === "SERVICE CHARGE"
            ? "property-service-charge"
            : undefined,
      priority: 0,
      builtIn: true,
    })),
);
