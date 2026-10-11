import type {
  Account,
  MonthlyBudget,
  Pot,
  RecurringSeries,
  Scenario,
} from "../domain/models";
import { currencyPrecision } from "../domain/money";
import { parseDate } from "../domain/dates";
import { manualAccountTypes } from "../analytics/net-worth";
import { db, type FinanceDB } from "./database";
import { auditedMutation } from "./audit";

const minor = (amount: number, positive = false) => {
  if (!Number.isSafeInteger(amount) || (positive ? amount <= 0 : amount < 0))
    throw new Error("Enter a valid non-negative amount in minor units.");
};
const monthValid = (month: string) => {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Choose a valid month.");
  parseDate(`${month}-01`);
};
export async function saveManualAccount(
  input: {
    id?: string;
    name: string;
    type: Account["accountType"];
    currency: string;
    date: string;
    valueMinor: number;
    note?: string;
    includeInNetWorth?: boolean;
    apr?: number;
    minPaymentMinor?: number;
    valuationReminderDays?: number;
  },
  database: FinanceDB = db,
) {
  if (
    !input.name.trim() ||
    !manualAccountTypes.includes(
      input.type as (typeof manualAccountTypes)[number],
    )
  )
    throw new Error(
      "Choose a manual asset or liability type and enter its name.",
    );
  currencyPrecision(input.currency);
  parseDate(input.date);
  minor(input.valueMinor);
  if (
    input.apr !== undefined &&
    (!Number.isFinite(input.apr) || input.apr < 0 || input.apr > 100)
  )
    throw new Error("APR must be between 0 and 100%.");
  if (input.minPaymentMinor !== undefined) minor(input.minPaymentMinor);
  if (
    input.valuationReminderDays !== undefined &&
    (!Number.isInteger(input.valuationReminderDays) ||
      input.valuationReminderDays < 1 ||
      input.valuationReminderDays > 3650)
  )
    throw new Error("Choose a valuation reminder between 1 and 3650 days.");
  return auditedMutation(
    input.id ? "Update manual account valuation" : "Add manual account",
    ["accounts", "valuations"],
    async () => {
      const existing = input.id
        ? await database.accounts.get(input.id)
        : undefined;
      if (input.id && (!existing || existing.tracking !== "manual"))
        throw new Error("Choose a manual account.");
      if (
        existing &&
        existing.currency !== input.currency &&
        (await database.valuations
          .where("accountId")
          .equals(existing.id)
          .count())
      )
        throw new Error(
          "This account has valuation history in its original currency. Add a separate account for another currency.",
        );
      const now = new Date().toISOString(),
        id = existing?.id ?? crypto.randomUUID();
      const account: Account = {
        id,
        institution: "Other",
        displayName: input.name.trim(),
        accountType: input.type,
        tracking: "manual",
        includeInNetWorth: input.includeInNetWorth ?? true,
        currency: input.currency,
        maskedAccountIdentifier: "Manual",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        apr: input.apr,
        minPaymentMinor: input.minPaymentMinor,
        valuationReminderDays: input.valuationReminderDays,
      };
      await database.accounts.put(account);
      const prior = await database.valuations
        .where("[accountId+date]")
        .equals([id, input.date])
        .first();
      await database.valuations.put({
        id: prior?.id ?? crypto.randomUUID(),
        accountId: id,
        date: input.date,
        valueMinor: input.valueMinor,
        note: input.note?.trim(),
      });
      return account;
    },
    database,
  );
}
export async function deleteManualAccount(
  id: string,
  database: FinanceDB = db,
) {
  return auditedMutation(
    "Delete manual account",
    ["accounts", "valuations", "pots", "transactions"],
    async () => {
      const account = await database.accounts.get(id);
      if (!account || account.tracking !== "manual")
        throw new Error("Only manual accounts can be deleted here.");
      if (await database.transactions.where("accountId").equals(id).count())
        throw new Error(
          "This account has transactions. Remove its transactions first.",
        );
      await database.valuations.where("accountId").equals(id).delete();
      await database.accounts.delete(id);
      await database.pots.toCollection().modify((p) => {
        if (p.linkedAccountId === id) delete p.linkedAccountId;
      });
    },
    database,
  );
}
export async function savePot(pot: Pot, database: FinanceDB = db) {
  if (!pot.name.trim() || !["goal", "sinking"].includes(pot.type))
    throw new Error("Enter a pot name and type.");
  currencyPrecision(pot.currency);
  minor(pot.targetMinor, true);
  if (pot.targetDate) parseDate(pot.targetDate);
  parseDate(pot.createdAt.slice(0, 10));
  const seen = new Set<string>();
  for (const c of pot.contributions) {
    monthValid(c.month);
    minor(c.amountMinor);
    if (seen.has(c.month))
      throw new Error("There can only be one contribution per month.");
    seen.add(c.month);
  }
  return auditedMutation(
    "Save savings pot",
    ["pots", "accounts", "categories"],
    async () => {
      if (pot.linkedAccountId) {
        const account = await database.accounts.get(pot.linkedAccountId);
        if (
          !account ||
          account.currency !== pot.currency ||
          account.accountType !== "savings"
        )
          throw new Error("Link a savings account in the pot's currency.");
      }
      if (
        pot.linkedCategoryId &&
        !(await database.categories.get(pot.linkedCategoryId))
      )
        throw new Error("Choose an existing category.");
      await database.pots.put({ ...pot, name: pot.name.trim() });
    },
    database,
  );
}
export async function confirmPotContribution(
  id: string,
  month: string,
  amountMinor: number,
  database: FinanceDB = db,
) {
  monthValid(month);
  minor(amountMinor);
  return auditedMutation(
    "Confirm monthly pot contribution",
    ["pots"],
    async () => {
      const pot = await database.pots.get(id);
      if (!pot) throw new Error("This pot no longer exists.");
      if (pot.linkedAccountId)
        throw new Error(
          "A linked savings account supplies this pot's balance automatically.",
        );
      await database.pots.update(id, {
        contributions: [
          ...pot.contributions.filter((c) => c.month !== month),
          { month, amountMinor },
        ].sort((a, b) => a.month.localeCompare(b.month)),
      });
    },
    database,
  );
}
export async function removePot(id: string, database: FinanceDB = db) {
  return auditedMutation(
    "Delete savings pot",
    ["pots"],
    async () => {
      await database.pots.delete(id);
    },
    database,
  );
}
export async function saveMonthlyBudget(
  budget: MonthlyBudget,
  database: FinanceDB = db,
) {
  monthValid(budget.month);
  minor(budget.amountMinor);
  currencyPrecision(budget.currency);
  if (!["none", "surplus", "both"].includes(budget.rollover))
    throw new Error("Choose a valid rollover setting.");
  return auditedMutation(
    "Save monthly budget",
    ["budgets", "categories"],
    async () => {
      const category = await database.categories.get(budget.categoryId);
      if (
        !category ||
        category.archived ||
        category.parentId ||
        category.kind !== "expense"
      )
        throw new Error("Choose an active spending category.");
      await database.budgets.put({
        ...budget,
        id: `${budget.currency}:${budget.categoryId}:${budget.month}`,
      });
    },
    database,
  );
}
export async function saveRecurringSeries(
  series: RecurringSeries,
  database: FinanceDB = db,
) {
  if (
    !series.name.trim() ||
    !["weekly", "monthly", "quarterly", "annual"].includes(series.cadence) ||
    !["active", "ignored", "cancel-planned"].includes(series.status)
  )
    throw new Error("Enter a valid recurring series.");
  parseDate(series.nextDue);
  if (series.endDate) parseDate(series.endDate);
  currencyPrecision(series.currency);
  if (!Number.isSafeInteger(series.expectedAmountMinor))
    throw new Error("Enter a valid expected amount.");
  return auditedMutation(
    "Update recurring payments",
    ["recurringSeries", "accounts"],
    async () => {
      const account = await database.accounts.get(series.accountId);
      if (!account || account.currency !== series.currency)
        throw new Error("Choose an account in this currency.");
      const existing = await database.recurringSeries.get(series.id);
      if (
        existing?.amountHistory.length &&
        (existing.accountId !== series.accountId ||
          existing.currency !== series.currency)
      )
        throw new Error(
          "This series has history on its original account. Create a new series for another account.",
        );
      await database.recurringSeries.put({
        ...series,
        name: series.name.trim(),
      });
    },
    database,
  );
}
export async function saveDebtTerms(
  accountId: string,
  apr: number,
  minimumMinor: number | undefined,
  database: FinanceDB = db,
) {
  if (!Number.isFinite(apr) || apr < 0 || apr > 100)
    throw new Error("APR must be between 0 and 100%.");
  if (minimumMinor !== undefined) minor(minimumMinor, true);
  return auditedMutation(
    "Update debt payment terms",
    ["accounts"],
    async () => {
      const account = await database.accounts.get(accountId);
      if (!account) throw new Error("This account no longer exists.");
      await database.accounts.update(accountId, {
        apr,
        minPaymentMinor: minimumMinor,
        updatedAt: new Date().toISOString(),
      });
    },
    database,
  );
}
export async function saveScenario(
  scenario: Scenario,
  database: FinanceDB = db,
) {
  if (
    !scenario.name.trim() ||
    scenario.changes.length < 1 ||
    scenario.changes.length > 30
  )
    throw new Error("Name a scenario and add between 1 and 30 adjustments.");
  if (scenario.currency) currencyPrecision(scenario.currency);
  for (const c of scenario.changes) {
    parseDate(c.date);
    if (c.endDate) parseDate(c.endDate);
    if (
      !Number.isSafeInteger(c.amountMinor) ||
      !["one-off", "recurring-change", "pause", "new-recurring"].includes(
        c.type,
      )
    )
      throw new Error("Enter a valid scenario adjustment.");
  }
  return auditedMutation(
    "Save what-if scenario",
    ["scenarios"],
    async () => {
      if (
        !(await database.scenarios.get(scenario.id)) &&
        (await database.scenarios.count()) >= 5
      )
        throw new Error(
          "You can save up to five scenarios. Delete one before saving another.",
        );
      await database.scenarios.put({ ...scenario, name: scenario.name.trim() });
    },
    database,
  );
}
export async function removeScenario(id: string, database: FinanceDB = db) {
  return auditedMutation(
    "Delete what-if scenario",
    ["scenarios"],
    async () => {
      await database.scenarios.delete(id);
    },
    database,
  );
}
