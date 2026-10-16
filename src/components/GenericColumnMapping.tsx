import { money } from "../domain/money";
import { useEffect, useId, useState } from "react";
import { useSwipe } from "./useSwipe";
import { SheetFooter } from "./Sheet";
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
  const [name, setName] = useState(() =>
    result.parsed
      ? `${result.parsed.institution} ${result.parsed.accountType === "credit" ? "credit card" : "current account"}`
      : "Current account statement",
  );
  const [columnIndex, setColumnIndex] = useState(0);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const layoutFormId = useId();
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
  const previews = pages.flatMap((page) => {
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
    return result.table.columns
      .filter((column) => ids.has(column.id))
      .map((column) => ({ page, column, rows }));
  });
  const activeIndex = Math.min(columnIndex, Math.max(0, previews.length - 1));
  const changeColumn = (offset: number) =>
    setColumnIndex(
      Math.max(0, Math.min(previews.length - 1, activeIndex + offset)),
    );
  const swipe = useSwipe((direction) =>
    changeColumn(direction === "left" ? 1 : -1),
  );
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
            <option value="in_out_columns">In and out columns</option>
            <option value="signed_positive_in">One signed column</option>
            <option value="signed_positive_out">Card spending column</option>
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
            <option value="auto">Automatic</option>
            <option value="day-first" aria-label="Day / month / year">
              DD/MM/YYYY
            </option>
            <option value="month-first" aria-label="Month / day / year">
              MM/DD/YYYY
            </option>
            <option value="iso" aria-label="Year / month / day">
              YYYY-MM-DD
            </option>
            <option value="named-month">Named month</option>
          </select>
        </label>
      </div>
      {previews.length > 0 && (
        <div
          className="generic-column-navigation"
          aria-label="Column navigation"
        >
          <button
            type="button"
            disabled={busy || activeIndex === 0}
            onClick={() => changeColumn(-1)}
          >
            Previous column
          </button>
          <span role="status">
            Column {activeIndex + 1} of {previews.length}
          </span>
          <button
            type="button"
            disabled={busy || activeIndex === previews.length - 1}
            onClick={() => changeColumn(1)}
          >
            Next column
          </button>
        </div>
      )}
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
            data-active-page={previews[activeIndex]?.page === page}
            key={page}
            role="region"
            tabIndex={0}
            aria-label={`Column preview, page ${page}`}
          >
            <h3>Page {page} columns</h3>
            {columns.map((column, index) => (
              <section
                className={`generic-mapping-column${previews[activeIndex]?.page === page && previews[activeIndex]?.column.id === column.id ? " is-current" : ""}`}
                key={column.id}
                {...swipe.bind}
                onClickCapture={(event) => {
                  if (swipe.consumeClick()) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
              >
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
                        .join(" ") || "No value"}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        );
      })}
      <SheetFooter>
        <p className="generic-live-check" role="status">
          {result.checks.reconciledExactly
            ? "These columns reconcile exactly to the statement."
            : `${result.checks.balanceRowsPassed} rows match their running balance. The statement is not verified yet.`}
          {result.checks.reconciliation.difference !== undefined && (
            <>
              {" "}
              Difference{" "}
              <span className="amount">
                {money(
                  result.checks.reconciliation.difference,
                  result.parsed?.currency ?? currency,
                )}
              </span>
              .
            </>
          )}
        </p>
        <button
          type="submit"
          form={layoutFormId}
          disabled={busy || !completeMapping(mapping) || !name.trim()}
        >
          Save layout
        </button>
      </SheetFooter>
      <form
        id={layoutFormId}
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
      </form>
      {!completeMapping(mapping) && (
        <p className="muted">
          Choose date, description and money columns to enable Save layout.
        </p>
      )}
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
