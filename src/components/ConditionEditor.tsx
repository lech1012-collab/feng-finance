import type { Account, Category, RuleCondition, Tag } from "../domain/models";
import { decimalMoney, parseMoney } from "../domain/money";

const fields: { value: RuleCondition["field"]; name: string }[] = [
  { value: "description", name: "Description" },
  { value: "merchant", name: "Merchant" },
  { value: "displayMerchant", name: "Display name" },
  { value: "amount", name: "Amount" },
  { value: "direction", name: "Money in or out" },
  { value: "accountId", name: "Account" },
  { value: "day", name: "Day of month" },
  { value: "currency", name: "Currency" },
  { value: "tag", name: "Tag" },
  { value: "kind", name: "Kind" },
  { value: "reviewed", name: "Reviewed" },
  { value: "source", name: "Source" },
  { value: "date", name: "Date" },
  { value: "note", name: "Note" },
  { value: "categoryId", name: "Category" },
];
export function ConditionEditor({
  conditions,
  onChange,
  accounts = [],
  categories = [],
  tags = [],
  currency = "GBP",
  maxConditions = 20,
}: {
  conditions: RuleCondition[];
  onChange: (conditions: RuleCondition[]) => void;
  accounts?: Account[];
  categories?: Category[];
  tags?: Tag[];
  currency?: string;
  maxConditions?: number;
}) {
  function update(index: number, patch: Partial<RuleCondition>) {
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  return (
    <div className="condition-editor">
      {conditions.map((c, i) => {
        const choices =
          c.field === "accountId"
            ? accounts.map((a) => [a.id, a.displayName])
            : c.field === "categoryId"
              ? [
                  ["", "Uncategorized"],
                  ...categories
                    .filter((c) => !c.archived && !c.parentId)
                    .map((c) => [c.id, c.name]),
                ]
              : c.field === "tag"
                ? tags.filter((t) => !t.archived).map((t) => [t.id, t.name])
                : c.field === "direction"
                  ? [
                      ["positive", "Money in"],
                      ["negative", "Money out"],
                    ]
                  : c.field === "reviewed"
                    ? [
                        ["true", "Reviewed"],
                        ["false", "Not reviewed"],
                      ]
                    : c.field === "source"
                      ? ["pdf", "csv", "ofx", "qif", "manual", "split"].map(
                          (v) => [v, v.toUpperCase()],
                        )
                      : c.field === "kind"
                        ? [
                            "normal",
                            "transfer",
                            "card_repayment",
                            "refund",
                            "split_parent",
                          ].map((v) => [v, v.replaceAll("_", " ")])
                        : undefined;
        const numeric = c.field === "amount" || c.field === "day";
        const operators = choices
          ? [["equals", "is"]]
          : numeric || c.field === "date"
            ? [
                ["equals", "equals"],
                ["gt", "greater than"],
                ["lt", "less than"],
                ["between", "between"],
              ]
            : [
                ["contains", "contains"],
                ["starts-with", "starts with"],
                ["equals", "equals"],
                ["regex", "regular expression (advanced)"],
              ];
        const shown = (
          value: RuleCondition["value"] | RuleCondition["valueTo"],
        ) =>
          c.field === "amount" && typeof value === "number"
            ? decimalMoney(value, currency)
            : String(value ?? "");
        function value(raw: string) {
          if (c.field === "amount") {
            try {
              return parseMoney(raw, currency);
            } catch {
              return raw;
            }
          }
          return c.field === "day"
            ? Number(raw)
            : c.field === "reviewed"
              ? raw === "true"
              : raw;
        }
        return (
          <fieldset className="condition-row" key={i}>
            <legend className="sr-only">Condition {i + 1}</legend>
            <label>
              <span className="sr-only">Condition {i + 1} field</span>
              <select
                value={c.field}
                onChange={(e) =>
                  update(i, {
                    field: e.target.value as RuleCondition["field"],
                    operator: "equals",
                    value: "",
                  })
                }
              >
                {fields.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.name}
                    {f.value === "amount" ? ` (${currency})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Condition {i + 1} comparison</span>
              <select
                value={c.operator}
                onChange={(e) =>
                  update(i, {
                    operator: e.target.value as RuleCondition["operator"],
                  })
                }
              >
                {operators.map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Condition {i + 1} value</span>
              {choices ? (
                <select
                  value={String(c.value)}
                  onChange={(e) => update(i, { value: value(e.target.value) })}
                >
                  <option value="">Choose</option>
                  {choices.map(([v, text]) => (
                    <option key={v} value={v}>
                      {text}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={c.field === "date" ? "date" : "text"}
                  inputMode={numeric ? "decimal" : undefined}
                  value={shown(c.value)}
                  placeholder={c.field === "amount" ? "10.00" : "Match value"}
                  onChange={(e) => update(i, { value: value(e.target.value) })}
                />
              )}
            </label>
            {c.operator === "between" && (
              <label>
                <span className="sr-only">Condition {i + 1} range end</span>
                <input
                  type={c.field === "date" ? "date" : "text"}
                  inputMode={numeric ? "decimal" : undefined}
                  value={shown(c.valueTo)}
                  onChange={(e) =>
                    update(i, {
                      valueTo: value(e.target.value) as string | number,
                    })
                  }
                />
              </label>
            )}
            <button
              type="button"
              aria-label={`Remove condition ${i + 1}`}
              onClick={() =>
                onChange(conditions.filter((_, index) => index !== i))
              }
            >
              Remove
            </button>
          </fieldset>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...conditions,
            { field: "description", operator: "contains", value: "" },
          ])
        }
        disabled={conditions.length >= maxConditions}
      >
        Add condition
      </button>
    </div>
  );
}
