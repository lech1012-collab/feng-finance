// @vitest-environment node
import { expect, it } from "vitest";
import { layoutTemplateSchema } from "./layout-template-schema";
const template = {
  id: "synthetic-layout",
  name: "Synthetic account",
  fingerprint: "synthetic-layout-fingerprint",
  coordinateSpace: "page-width-fraction",
  signConvention: "signed_positive_out",
  balanceSign: -1,
  dateFormat: "auto",
  createdAt: "2026-10-11T12:00:00.000Z",
  lastUsedAt: "2026-10-11T12:00:00.000Z",
  status: "active",
  columnRoles: [
    { x0: 0, x1: 0.2, role: "date" },
    { x0: 0.2, x1: 0.8, role: "description" },
    { x0: 0.8, x1: 1, role: "amount" },
  ],
};
it("accepts normalized layouts and only explicit balance sign hypotheses", () => {
  expect(layoutTemplateSchema.parse(template)).toEqual(template);
  const { balanceSign: _balance, ...legacy } = template;
  expect(layoutTemplateSchema.parse(legacy)).toEqual(legacy);
  expect(() =>
    layoutTemplateSchema.parse({ ...template, balanceSign: 0 }),
  ).toThrow();
});
it("rejects invalid bands and role/sign mismatches before any database mutation", () => {
  for (const column of [
    { x0: -0.1, x1: 0.2, role: "date" },
    { x0: 0.2, x1: 0.2, role: "date" },
    { x0: 0, x1: 1.1, role: "date" },
  ])
    expect(() =>
      layoutTemplateSchema.parse({
        ...template,
        columnRoles: [column, ...template.columnRoles.slice(1)],
      }),
    ).toThrow();
  expect(() =>
    layoutTemplateSchema.parse({
      ...template,
      signConvention: "in_out_columns",
    }),
  ).toThrow();
  expect(() =>
    layoutTemplateSchema.parse({ ...template, name: "   " }),
  ).toThrow();
  expect(() =>
    layoutTemplateSchema.parse({ ...template, dateFormat: "unrecognised" }),
  ).toThrow();
  expect(() =>
    layoutTemplateSchema.parse({
      ...template,
      columnRoles: [
        template.columnRoles[0],
        { ...template.columnRoles[1], x0: 0.1 },
        template.columnRoles[2],
      ],
    }),
  ).toThrow("Column bands must not overlap");
});
