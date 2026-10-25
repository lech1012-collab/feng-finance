import { Toast } from "./Toast";
import { ContextHelp } from "./ContextHelp";
import { SwitchRow } from "./UIPrimitives";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "../storage/database";
import { auditedMutation, undoChange } from "../storage/audit";
import { readPeriodStart, type PeriodStart } from "../domain/period";
import {
  changeReportingPeriod,
  ClosedPeriodChangeError,
} from "../storage/reporting-period";
export function PeriodSetting() {
  const settings = useLiveQuery(() => db.settings.toArray(), []);
  const config = readPeriodStart(settings ?? []);
  const autoClose = !settings?.some(
    (s) => s.key === "review:autoClose" && s.value === "false",
  );
  const [error, setError] = useState("");
  const [changeId, setChangeId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const saveAutoClose = async (enabled: boolean) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await auditedMutation(
        "Change automatic month close",
        ["settings"],
        () =>
          db.settings.put({
            key: "review:autoClose",
            value: String(enabled),
          }),
      );
      setChangeId(result.changeId);
      setNotice("Automatic month close preference saved.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Automatic month close preference could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async (value: PeriodStart) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let result;
      try {
        result = await changeReportingPeriod(value);
      } catch (failure) {
        if (!(failure instanceof ClosedPeriodChangeError)) throw failure;
        const count = failure.closedCount;
        if (
          !window.confirm(
            `Changing your reporting month will reopen all ${count} closed ${count === 1 ? "month" : "months"}. Their old snapshots will be removed until you review and close the new date ranges. Continue?`,
          )
        )
          return;
        result = await changeReportingPeriod(value, true);
      }
      setChangeId(result.changeId);
      setNotice(
        result.result.reopened
          ? `Month preference saved. ${result.result.reopened} ${result.result.reopened === 1 ? "month reopened" : "months reopened"}.`
          : "Month preference saved.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Month preference could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <div className="context-help-heading">
        <h2>Your month</h2>
        <ContextHelp title="Your reporting month">
          <p>
            Home, budgets and reviews use the same date range. Payday uses
            Salary entries, otherwise the last weekday.
          </p>
        </ContextHelp>
      </div>
      <label>
        Starts on
        <select
          value={config.mode}
          disabled={busy}
          onChange={(e) =>
            void save({
              ...config,
              mode: e.target.value as PeriodStart["mode"],
            })
          }
        >
          <option value="calendar">Calendar month</option>
          <option value="fixed">Fixed day</option>
          <option value="payday">Detected payday</option>
        </select>
      </label>
      {config.mode === "fixed" && (
        <label>
          Day
          <select
            value={config.day}
            disabled={busy}
            onChange={(e) =>
              void save({ ...config, day: Number(e.target.value) })
            }
          >
            {Array.from({ length: 28 }, (_, i) => (
              <option key={i + 1}>{i + 1}</option>
            ))}
          </select>
        </label>
      )}
      <SwitchRow
        label="Automatically close complete, reviewed months after 60 days"
        checked={autoClose}
        disabled={busy}
        onChange={(enabled) => void saveAutoClose(enabled)}
      />
      {notice && (
        <Toast
          id={changeId || notice}
          message={notice}
          undo={
            changeId
              ? async () => {
                  await undoChange(changeId);
                  setChangeId("");
                  setNotice("");
                }
              : undefined
          }
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
