import { db, type FinanceDB } from "./database";
import type { LayoutTemplate } from "../domain/models";
import { layoutTemplateSchema } from "./layout-template-schema";
import { auditedMutation } from "./audit";

export async function saveLayoutTemplate(
  template: LayoutTemplate,
  database: FinanceDB = db,
) {
  const validated = layoutTemplateSchema.parse(template);
  return auditedMutation(
    "Save import layout",
    ["layoutTemplates"],
    () => database.layoutTemplates.put(validated),
    database,
  );
}

export async function renameLayoutTemplate(
  id: string,
  name: string,
  database: FinanceDB = db,
) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200)
    throw new Error("Enter a layout name of 1 to 200 characters.");
  return auditedMutation(
    "Rename import layout",
    ["layoutTemplates"],
    async () => {
      const template = await database.layoutTemplates.get(id);
      if (!template) throw new Error("This import layout no longer exists.");
      await database.layoutTemplates.update(id, { name: trimmed });
    },
    database,
  );
}

export async function deleteLayoutTemplate(
  id: string,
  database: FinanceDB = db,
) {
  return auditedMutation(
    "Delete import layout",
    ["layoutTemplates"],
    async () => {
      if (!(await database.layoutTemplates.get(id)))
        throw new Error("This import layout no longer exists.");
      await database.layoutTemplates.delete(id);
    },
    database,
  );
}

/** A template is a reading hint, never independent evidence of financial accuracy. */
export async function markLayoutTemplateChecked(
  id: string,
  exact: boolean,
  database: FinanceDB = db,
) {
  return auditedMutation(
    exact ? "Check import layout" : "Flag changed import layout",
    ["layoutTemplates"],
    async () => {
      if (!(await database.layoutTemplates.get(id)))
        throw new Error("This import layout no longer exists.");
      await database.layoutTemplates.update(id, {
        status: exact ? "active" : "check_needed",
        lastUsedAt: new Date().toISOString(),
      });
    },
    database,
  );
}
