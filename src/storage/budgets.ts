import { db, type FinanceDB } from "./database";
import { budgetKey } from "../analytics/planning";
import { currencyPrecision } from "../domain/money";
export async function saveBudget(
  categoryId: string,
  currency: string,
  amount: number | undefined,
  database: FinanceDB = db,
) {
  currencyPrecision(currency);
  if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0))
    throw new Error(
      "Enter a non-negative budget with valid currency precision.",
    );
  await database.transaction(
    "rw",
    database.categories,
    database.settings,
    async () => {
      const category = await database.categories.get(categoryId);
      if (
        !category ||
        category.archived ||
        category.parentId ||
        category.kind !== "expense"
      )
        throw new Error("Choose an active spending category.");
      const key = budgetKey(currency, categoryId);
      if (amount === undefined) await database.settings.delete(key);
      else await database.settings.put({ key, value: JSON.stringify(amount) });
    },
  );
}
