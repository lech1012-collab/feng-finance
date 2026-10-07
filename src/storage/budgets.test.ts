import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { FinanceDB, initializeDatabase } from "./database";
import { saveBudget } from "./budgets";
import { budgetKey, readBudget } from "../analytics/planning";
it("persists currency-scoped budgets without changing financial records and removes limits", async () => {
  const database = new FinanceDB(`budget-${crypto.randomUUID()}`);
  try {
    await initializeDatabase(database);
    await saveBudget("groceries", "GBP", 15000, database);
    await saveBudget("groceries", "EUR", 20000, database);
    expect(
      readBudget(
        (await database.settings.get(budgetKey("GBP", "groceries")))!.value,
      ),
    ).toBe(15000);
    expect(
      readBudget(
        (await database.settings.get(budgetKey("EUR", "groceries")))!.value,
      ),
    ).toBe(20000);
    await saveBudget("groceries", "GBP", undefined, database);
    expect(
      await database.settings.get(budgetKey("GBP", "groceries")),
    ).toBeUndefined();
    expect(await database.transactions.count()).toBe(0);
    for (const amount of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1])
      await expect(
        saveBudget("groceries", "GBP", amount, database),
      ).rejects.toThrow();
    await expect(saveBudget("salary", "GBP", 100, database)).rejects.toThrow(
      "active spending",
    );
    await expect(saveBudget("missing", "GBP", 100, database)).rejects.toThrow(
      "active spending",
    );
  } finally {
    await database.delete();
  }
});
