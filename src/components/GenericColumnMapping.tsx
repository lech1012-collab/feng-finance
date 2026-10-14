import { money } from "../domain/money";
import { useEffect, useState } from "react";
import type { ColumnRole, LayoutMapping } from "../import/generic/types";
import {
  roles,
  initialMapping,
  completeMapping,
  type GenericImportReviewProps,
} from "./generic-review-view";
export function GenericColumnMapping({
  result,
  busy,
  onMapping,
  onSaveTemplate,
  currency = "GBP",
}: Pick<
  GenericImportReviewProps,
  "result" | "busy" | "onMapping" | "onSaveTemplate" | "currency"
>) {
  const [mapping, setMapping] = useState(() => initialMapping(result));
  const [name, setName] = useState("My statement layout");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const mappingKey = JSON.stringify(result.mapping);
  const columnsKey = JSON.stringify(
    result.table.columns.map((column) => column.id),
  );
  useEffect(() => {
    setMapping(initialMapping(result));
    setSaved(false);
  }, [mappingKey, columnsKey]);
  const update = (next: LayoutMapping) => {
    setMapping(next);
    setSaved(false);
    setError("");
    onMapping(next);
  };
  const pages = result.table.pages.length
    ? result.table.pages.map((page) => page.page)
    : [...new Set(result.table.rows.map((row) => row.rect.page))];
  return (
    <div className="generic-column-mapping">
      <p>
        The columns must add up to the statement figures. Choose what each
        column contains.
      </p>
      <div className="generic-mapping-controls">
        <label>
          Amount signs
          <select
            disabled={busy}
            value={mapping.signConvention}
            onChange={(event) =>
              update({
                ...mapping,
                signConvention: event.target
                  .value as LayoutMapping["signConvention"],
              })
            }
          >
            <option value="in_out_columns">
              Separate money-in and money-out columns
            </option>
            <option value="signed_positive_in">
              Signed amounts: positive means money in
            </option>
            <option value="signed_positive_out">
              Card amounts: positive means spending
            </option>
          </select>
        </label>
        <label>
          Date format
          <select
            disabled={busy}
            value={mapping.dateFormat}
            onChange={(event) =>
              update({
                ...mapping,
                dateFormat: event.target.value as LayoutMapping["dateFormat"],
              })
            }
          >
            <option value="auto">Detect from statement</option>
            <option value="day-first">Day / month / year</option>
            <option value="month-first">Month / day / year</option>
            <option value="iso">Year-month-day</option>
            <option value="named-month">Day and month name</option>
          </select>
        </label>
      </div>
      {pages.map((page) => {
        const rows = result.table.rows
          .filter(
            (row) =>
              row.rect.page === page &&
              ["transaction", "unknown", "continuation"].includes(row.kind),
          )
          .slice(0, 12);
        const ids = new Set(
          rows.flatMap((row) => row.cells.map((cell) => cell.columnId)),
        );
        const columns = result.table.columns.filter((column) =>
          ids.has(column.id),
        );
        if (!columns.length) return null;
        return (
          <div
            className="generic-mapping-columns"
            key={page}
            role="region"
            tabIndex={0}
            aria-label={`Column preview, page ${page}`}
          >
            <h3>Page {page} columns</h3>
            {columns.map((column, index) => (
              <section className="generic-mapping-column" key={column.id}>
                <label>
                  {column.headerText || `Column ${index + 1}`}
                  <select
                    aria-label={`Role for ${column.headerText || `column ${index + 1}`} on page ${page}`}
                    disabled={busy}
                    value={
                      mapping.columnRoles.find(
                        (role) => role.columnId === column.id,
                      )?.role ?? "ignore"
                    }
                    onChange={(event) =>
                      update({
                        ...mapping,
                        columnRoles: result.table.columns.map((entry) => ({
                          columnId: entry.id,
                          role:
                            entry.id === column.id
                              ? (event.target.value as ColumnRole)
                              : (mapping.columnRoles.find(
                                  (role) => role.columnId === entry.id,
                                )?.role ?? "ignore"),
                        })),
                      })
                    }
                  >
                    {roles.map((role) => (
                      <option value={role.value} key={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">Sample values</p>
                <ul>
                  {rows.slice(0, 3).map((row) => (
                    <li key={row.id}>
                      {row.cells
                        .filter((cell) => cell.columnId === column.id)
                        .map((cell) => cell.text)
                        .join(" ") || "—"}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        );
      })}
      <p className="generic-live-check" role="status">
        {result.checks.reconciledExactly
          ? "These columns reconcile exactly to the statement."
          : `${result.checks.balanceRowsPassed} rows match their running balance. The statement is not verified yet.`}
        {result.checks.reconciliation.difference !== undefined &&
          ` Difference ${money(result.checks.reconciliation.difference, result.parsed?.currency ?? currency)}.`}
      </p>
      <form
        className="generic-save-layout"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setError("Give this layout a name.");
            return;
          }
          if (!completeMapping(mapping)) {
            setError(
              "Choose a date, description and amount column before saving.",
            );
            return;
          }
          onSaveTemplate(name.trim(), mapping);
          setError("");
          setSaved(true);
        }}
      >
        <label>
          Layout name
          <input
            type="text"
            maxLength={80}
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            placeholder="For example, current account statement"
            required
          />
        </label>
        <button
          type="submit"
          disabled={busy || !completeMapping(mapping) || !name.trim()}
        >
          Save layout
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {saved && (
        <p role="status">
          Layout requested. Future statements will still be checked against
          their own figures.
        </p>
      )}
    </div>
  );
}
