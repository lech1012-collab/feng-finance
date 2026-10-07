import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { ImportButton } from "./ImportPicker";
import { db } from "../storage/database";
import { download } from "../storage/backup";
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
    setLocalConfig((current) => ({ ...(current ?? data.config), ...patch }));
    try {
      await db.transaction("rw", db.settings, async () => {
        const current = readReminderConfig(
          (await db.settings.get(REMINDER_KEY))?.value,
        );
        await db.settings.put({
          key: REMINDER_KEY,
          value: JSON.stringify({ ...current, ...patch }),
        });
      });
      setError("");
    } catch {
      setLocalConfig(data.config);
      setError("Reminder settings could not be saved.");
    }
  };
  if (!settings && (!config.enabled || !reminders.length)) return null;
  return (
    <section className="card finance-reminders" id="reminders">
      <div className="section-heading">
        <h2>Reminders</h2>
        {!settings && <Link to="/settings#reminders">Manage</Link>}
      </div>
      {settings && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => void save({ enabled: e.target.checked })}
            />{" "}
            Show statement and bill reminders
          </label>
          <label className="reminder-day">
            Monthly statement review day
            <select
              aria-label="Monthly statement review day"
              value={config.day}
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
            Feng remains a website and installable web app. In-app reminders
            appear when you open it. For alerts while it is closed, import a
            calendar file into your preferred calendar—no App Store or
            notification server required.
          </p>
          <button
            disabled={!config.enabled}
            onClick={() => {
              download(
                reminderCalendar(config, today, reminders),
                "text/calendar",
                "feng-finance-reminders.ics",
              );
              setNotice(
                "Calendar file downloaded. Import it into your calendar and check that alerts are enabled. It contains no merchant names, amounts or account details.",
              );
            }}
          >
            Export calendar reminders
          </button>
          <p className="coverage-note">
            Calendar alerts depend on your calendar app. Re-export to refresh
            estimated bill dates; disabling reminders in Feng does not remove
            previously imported calendar events.
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
        <p className="muted">
          No reminders due. Upcoming bill dates need repeated imported payments;
          predictions do not prove a bill is unpaid.
        </p>
      )}
      {!settings && reminders.length > 4 && (
        <Link to="/settings#reminders">
          {reminders.length - 4} more reminders
        </Link>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
