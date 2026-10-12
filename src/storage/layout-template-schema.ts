import { z } from "zod";

export const layoutTemplateSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    fingerprint: z.string().min(1).max(20000),
    institution: z
      .enum(["Barclays", "American Express", "Revolut", "Other"])
      .optional(),
    bankProfileId: z
      .enum(["barclays-current", "barclaycard", "amex", "revolut"])
      .optional(),
    columnRoles: z
      .array(
        z
          .object({
            x0: z.number().min(0).max(1),
            x1: z.number().min(0).max(1),
            role: z.enum([
              "date",
              "description",
              "in",
              "out",
              "amount",
              "balance",
              "ignore",
            ]),
          })
          .refine(
            (band) => band.x0 < band.x1,
            "Column bands must have a positive width.",
          ),
      )
      .min(2)
      .max(100),
    coordinateSpace: z.literal("page-width-fraction"),
    signConvention: z.enum([
      "in_out_columns",
      "signed_positive_in",
      "signed_positive_out",
    ]),
    balanceSign: z.union([z.literal(1), z.literal(-1)]).optional(),
    dateFormat: z.enum([
      "day-first",
      "month-first",
      "iso",
      "named-month",
      "auto",
    ]),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime(),
    status: z.enum(["active", "check_needed"]),
  })
  .refine((template) => {
    const bands = [...template.columnRoles].sort((a, b) => a.x0 - b.x0);
    return bands.every(
      (band, index) => index === 0 || band.x0 >= bands[index - 1].x1,
    );
  }, "Column bands must not overlap.")
  .refine((template) => {
    const roles = new Set(template.columnRoles.map((band) => band.role));
    return (
      roles.has("date") &&
      roles.has("description") &&
      (template.signConvention === "in_out_columns"
        ? roles.has("in") || roles.has("out")
        : roles.has("amount"))
    );
  }, "A layout needs date, description and money columns matching its sign convention.");
