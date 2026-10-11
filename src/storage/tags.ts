import type { Tag, Transaction } from "../domain/models";
import { id } from "../domain/normalize";
import { db } from "./database";
import { auditedMutation } from "./audit";
import { effectiveTransactions } from "../analytics/effective-transactions";
import { ensureMonthsOpen } from "./month-review";
import { safeSum } from "../domain/money";
import { financialType } from "../domain/transaction-type";

export async function saveTag(tag: Omit<Tag, "id"> & { id?: string }) {
  const name = tag.name.trim();
  if (!name || name.length > 100 || !/^#[\da-f]{6}$/i.test(tag.colour))
    throw new Error("Enter a name and a valid colour.");
  return auditedMutation("Save tag", ["tags"], async () => {
    const duplicate = await db.tags
      .filter(
        (t) =>
          t.id !== tag.id &&
          t.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
      .first();
    if (duplicate) throw new Error("A tag with this name already exists.");
    const result: Tag = { ...tag, id: tag.id ?? id(), name };
    await db.tags.put(result);
    return result;
  });
}

export async function mergeTags(sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new Error("Choose two different tags.");
  return auditedMutation(
    "Merge tags",
    [
      "tags",
      "transactions",
      "rules",
      "savedViews",
      "savedReports",
      "monthCloses",
      "settings",
    ],
    async () => {
      const [source, target] = await db.tags.bulkGet([sourceId, targetId]);
      if (!source || !target || target.archived)
        throw new Error("Choose an available target tag.");
      const replace = (values: string[]) => [
        ...new Set(values.map((v) => (v === sourceId ? targetId : v))),
      ];
      const transactions = await db.transactions
        .filter((t) => t.tags.includes(sourceId))
        .toArray();
      await ensureMonthsOpen(transactions);
      for (const t of transactions)
        await db.transactions.update(t.id, {
          tags: replace(t.tags),
          updatedAt: new Date().toISOString(),
        });
      for (const rule of await db.rules.toArray()) {
        let changed = false;
        const actions = rule.actions?.map((a) => {
          if (a.tagIds?.includes(sourceId)) {
            changed = true;
            return { ...a, tagIds: replace(a.tagIds) };
          }
          if (a.splits?.some((s) => s.tagIds?.includes(sourceId))) {
            changed = true;
            return {
              ...a,
              splits: a.splits.map((s) => ({
                ...s,
                tagIds: s.tagIds ? replace(s.tagIds) : undefined,
              })),
            };
          }
          return a;
        });
        const conditions = rule.conditions?.map((c) => {
          if (
            c.field === "tag" &&
            (c.value === sourceId ||
              (Array.isArray(c.value) && c.value.includes(sourceId)))
          ) {
            changed = true;
            return {
              ...c,
              value: Array.isArray(c.value) ? replace(c.value) : targetId,
            };
          }
          return c;
        });
        if (changed) await db.rules.update(rule.id, { actions, conditions });
      }
      for (const table of [db.savedViews, db.savedReports]) {
        for (const view of await table.toArray()) {
          const conditions = view.conditions.map((c) =>
            c.field === "tag"
              ? {
                  ...c,
                  value: Array.isArray(c.value)
                    ? replace(c.value)
                    : c.value === sourceId
                      ? targetId
                      : c.value,
                }
              : c,
          );
          await table.update(view.id, { conditions });
        }
      }
      await db.tags.delete(sourceId);
      return transactions.length;
    },
  );
}

export async function tagTransactions(
  ids: string[],
  tagIds: string[],
  remove = false,
) {
  return auditedMutation(
    remove ? "Remove transaction tags" : "Tag transactions",
    ["transactions", "tags", "monthCloses", "settings"],
    async () => {
      for (const id of tagIds)
        if (!(await db.tags.get(id)))
          throw new Error("This tag no longer exists.");
      const values = await db.transactions.bulkGet([...new Set(ids)]);
      await ensureMonthsOpen(values.filter((t): t is Transaction => !!t));
      for (const t of values)
        if (t)
          await db.transactions.update(t.id, {
            tags: remove
              ? t.tags.filter((tag) => !tagIds.includes(tag))
              : [...new Set([...t.tags, ...tagIds])],
            updatedAt: new Date().toISOString(),
          });
      return values.filter(Boolean).length;
    },
  );
}

export function tagSummary(
  transactions: Transaction[],
  tagId: string,
  currency: string,
) {
  const list = effectiveTransactions(transactions).filter(
    (t) =>
      t.tags.includes(tagId) &&
      t.currency === currency &&
      financialType(t) !== "transfer",
  );
  const categories: Record<string, number> = {};
  for (const t of list)
    categories[t.categoryId ?? "uncategorized"] = safeSum([
      categories[t.categoryId ?? "uncategorized"] ?? 0,
      t.amount,
    ]);
  const dates = list.map((t) => t.date).sort();
  return {
    total: safeSum(list.map((t) => t.amount)),
    count: list.length,
    converted: list.some(
      (t) => "originalCurrency" in t && !!t.originalCurrency,
    ),
    categories,
    from: dates[0],
    to: dates.at(-1),
  };
}
