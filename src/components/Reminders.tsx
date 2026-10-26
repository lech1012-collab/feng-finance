import { Toast } from "./Toast";
import { ContextHelp } from "./ContextHelp";
import { auditedMutation, undoChange } from "../storage/audit";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { ImportButton } from "./ImportPicker";
import { db } from "../storage/database";
import { download } from "../storage/backup";
import { SwitchRow } from "./UIPrimitives";
import {
  financeReminders,
  localToday,
  readReminderConfig,
  reminderCalendar,
  REMINDER_KEY,
  type ReminderConfig,
} from "../analytics/reminders";
export function Reminders({
  currency,
  settings = false,
}: {
  currency: string;
  settings?: boolean;
}) {
  const today = localToday();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [changeId, setChangeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [localConfig, setLocalConfig] = useState<ReminderConfig>();
  const data = useLiveQuery(
    async () => ({
      accounts: await db.accounts.where("currency").equals(currency).toArray(),
      statements: await db.statements.toArray(),
      transactions: await db.transactions
        .where("[currency+date]")
        .between(
          [currency, `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`],
          [currency, today],
          true,
          true,
        )
        .toArray(),
      config: readReminderConfig((await db.settings.get(REMINDER_KEY))?.value),
    }),
    [currency, today],
  );
  useEffect(() => {
    if (data) setLocalConfig(data.config);
  }, [data?.config.enabled, data?.config.day]);
  if (!data) return null;
  const config = localConfig ?? data.config;
  const reminders = financeReminders(
    data.accounts,
    data.statements,
    data.transactions,
    currency,
    today,
    config,
  );
  const save = async (patch: Partial<ReminderConfig>) => {
    if (busy) return;
    setBusy(true);
    setLocalConfig((current) => ({ ...(current ?? data.config), ...patch }));
    try {
      const receipt = await auditedMutation(
        "Change reminders",
        ["settings"],
        async () => {
          const current = readReminderConfig(
            (await db.settings.get(REMINDER_KEY))?.value,
          );
          await db.settings.put({
            key: REMINDER_KEY,
            value: JSON.stringify({ ...current, ...patch }),
          });
        },
      );
      setError("");
      setChangeId(receipt.changeId);
      setNotice(
        patch.day === undefined
          ? patch.enabled
            ? "Reminders turned on."
            : "Reminders turned off."
          : "Monthly review day saved.",
      );
    } catch {
      setLocalConfig(data.config);
      setError("Reminder settings could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  if (!settings && (!config.enabled || !reminders.length)) return null;
  return (
    <section className="card finance-reminders" id="reminders">
      <div className="section-heading">
        <div className="context-help-heading">
          <h2>Reminders</h2>
          {settings && (
            <ContextHelp title="Reminders and calendar alerts">
              <p>
                Reminders appear in Feng; export to your calendar for alerts
                while it is closed.
              </p>
              <p>
                Calendar files contain no merchant names, amounts or account
                details. Alerts depend on your calendar app. Re-export to
                refresh estimated bill dates.
              </p>
              <p>Expected bill dates need repeated payments in your history.</p>
            </ContextHelp>
          )}
        </div>
        {!settings && (
          <Link to="/settings#reminders">
            {reminders.length > 4
              ? `Manage · ${reminders.length - 4} more`
              : "Manage"}
          </Link>
        )}
      </div>
      {settings && (
        <>
          <SwitchRow
            label="Show statement and bill reminders"
            checked={config.enabled}
            onChange={(enabled) => void save({ enabled })}
            disabled={busy}
          />
          <label className="reminder-day">
            Monthly statement review day
            <select
              aria-label="Monthly statement review day"
              value={config.day}
              disabled={busy}
              onChange={(e) => void save({ day: Number(e.target.value) })}
            >
              {Array.from({ length: 28 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            In-app reminders; export for alerts while Feng is closed.
          </p>
          <button
            disabled={!config.enabled}
            onClick={() => {
              download(
                reminderCalendar(config, today, reminders),
                "text/calendar",
                "feng-finance-reminders.ics",
              );
              setChangeId("");
              setNotice(
                "Calendar file prepared. Import it into your calendar and enable alerts.",
              );
            }}
          >
            Export calendar reminders
          </button>
          <p className="muted">
            Disabling reminders here does not remove calendar events already
            imported.
          </p>
        </>
      )}
      {reminders.slice(0, settings ? 20 : 4).map((r) =>
        r.kind === "statement" ? (
          <ImportButton
            className="financial-insight reminder-import"
            key={r.id}
          >
            <strong>{r.title}</strong>
            <span>{r.detail}</span>
          </ImportButton>
        ) : (
          <Link className="financial-insight" key={r.id} to={r.href}>
            <strong>{r.title}</strong>
            <span>{r.detail}</span>
          </Link>
        ),
      )}
      {!reminders.length && settings && (
        <p className="muted">No reminders due.</p>
      )}
      {notice && (
        <Toast
          message={notice}
          id={changeId || notice}
          undo={
            changeId
              ? async () => {
                  await undoChange(changeId);
                  const restored = readReminderConfig(
                    (await db.settings.get(REMINDER_KEY))?.value,
                  );
                  setLocalConfig(restored);
                  setNotice("");
                  setChangeId("");
                }
              : undefined
          }
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
