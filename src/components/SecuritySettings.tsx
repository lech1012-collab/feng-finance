import { useEffect, useId, useState } from "react";
import {
  appLockConfiguration,
  disableAppLock,
  enableAppLock,
  platformAuthenticatorAvailable,
  registerPlatformAuthenticator,
  setLockDelay,
  type AppLockConfiguration,
  type LockDelay,
} from "../security/app-lock";
import { useAppLock } from "./AppLock";
import { Sheet } from "./Sheet";
import { Toast } from "./Toast";
import { ContextHelp } from "./ContextHelp";
import { StatusChip } from "./UIPrimitives";
import "../security/security.css";

const delays: LockDelay[] = [0, 1, 5, 15];
const delayLabel = (minutes: LockDelay) =>
  minutes === 0
    ? "Immediately"
    : String(minutes) + (minutes === 1 ? " minute" : " minutes");

function PinField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label>
      {label}
      <span className="pin-entry">
        <span className="pin-slots" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i}>{i < value.length ? "●" : ""}</span>
          ))}
        </span>
        <input
          aria-label={label}
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="new-password"
          value={value}
          onChange={(event) =>
            onChange(event.target.value.replaceAll(/\D/g, ""))
          }
          disabled={disabled}
        />
      </span>
    </label>
  );
}

export function SecuritySettings() {
  const [configuration, setConfiguration] = useState<AppLockConfiguration>();
  const [pin, setPin] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [delay, setDelay] = useState<LockDelay>(1);
  const [biometrics, setBiometrics] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<() => Promise<void>>();
  const [noticeId, setNoticeId] = useState("");
  const [edit, setEdit] = useState<"enable" | "disable">();
  const formId = useId();
  const { lockNow } = useAppLock();
  const refresh = async () => {
    const next = await appLockConfiguration();
    setConfiguration(next);
    setDelay(next.delayMinutes);
  };
  useEffect(() => {
    void refresh().catch(() =>
      setError("App lock settings could not be loaded."),
    );
    void platformAuthenticatorAvailable()
      .then(setBiometrics)
      .catch(() => setBiometrics(false));
  }, []);
  const close = () => {
    if (busy) return;
    setEdit(undefined);
    setPin("");
    setConfirmation("");
    setError("");
  };
  const run = async (
    action: () => Promise<void>,
    success: string,
    reverse?: () => Promise<void>,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setUndo(undefined);
    try {
      await action();
      await refresh();
      setPin("");
      setConfirmation("");
      setEdit(undefined);
      setUndo(
        reverse
          ? () => async () => {
              await reverse();
              await refresh();
              setNotice("");
            }
          : undefined,
      );
      setNoticeId(crypto.randomUUID());
      setNotice(success);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Security settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" id="security">
      <div className="section-heading">
        <div className="context-help-heading">
          <h2>Security</h2>
          <ContextHelp title="App lock">
            <p>App lock protects against casual access to Feng.</p>
          </ContextHelp>
        </div>
        {configuration && (
          <StatusChip>
            {configuration.enabled ? "App lock is on." : "App lock is off."}
          </StatusChip>
        )}
      </div>
      <p className="muted">App lock does not encrypt your local database.</p>
      {configuration && !configuration.enabled ? (
        <button className="primary" onClick={() => setEdit("enable")}>
          Set up app lock
        </button>
      ) : configuration?.enabled ? (
        <div className="security-fields">
          <label>
            Lock after being away
            <select
              value={delay}
              disabled={busy}
              onChange={(event) => {
                const previous = configuration.delayMinutes;
                const next = Number(event.target.value) as LockDelay;
                if (previous === next) return;
                void run(
                  () => setLockDelay(next),
                  "Lock delay saved.",
                  async () => {
                    const current = await appLockConfiguration();
                    if (!current.enabled || current.delayMinutes !== next)
                      throw new Error(
                        "Security settings changed. Review the current lock delay before undoing.",
                      );
                    await setLockDelay(previous);
                  },
                );
              }}
            >
              {delays.map((minutes) => (
                <option value={minutes} key={minutes}>
                  {delayLabel(minutes)}
                </option>
              ))}
            </select>
          </label>
          {biometrics && (
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  registerPlatformAuthenticator,
                  "Device authentication is ready.",
                )
              }
            >
              {configuration.credentialId
                ? "Set up device authentication again"
                : "Set up Face ID or Touch ID"}
            </button>
          )}
          <button onClick={lockNow} disabled={busy}>
            Lock now
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => setEdit("disable")}
          >
            Turn app lock off
          </button>
        </div>
      ) : (
        <p role="status">Loading security settings…</p>
      )}
      {edit && (
        <Sheet
          title={edit === "enable" ? "Set up app lock" : "Turn app lock off"}
          onClose={close}
          footer={
            <>
              <button type="button" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button
                form={formId}
                type="submit"
                className={edit === "enable" ? "primary" : "danger"}
                disabled={
                  busy ||
                  pin.length !== 6 ||
                  (edit === "enable" && confirmation.length !== 6)
                }
              >
                {edit === "enable" ? "Enable app lock" : "Disable app lock"}
              </button>
            </>
          }
        >
          <form
            id={formId}
            className="security-fields"
            onSubmit={(event) => {
              event.preventDefault();
              if (edit === "enable") {
                if (pin !== confirmation) {
                  setError("The PINs do not match.");
                  return;
                }
                void run(
                  () => enableAppLock(pin, delay),
                  "App lock enabled. Keep your PIN safe.",
                );
              } else {
                void run(() => disableAppLock(pin), "App lock disabled.");
              }
            }}
          >
            <PinField
              label={
                edit === "enable" ? "Choose a 6-digit app PIN" : "Current PIN"
              }
              value={pin}
              onChange={setPin}
              disabled={busy}
            />
            {edit === "enable" && (
              <>
                <PinField
                  label="Confirm PIN"
                  value={confirmation}
                  onChange={setConfirmation}
                  disabled={busy}
                />
                <label>
                  Lock after being away
                  <select
                    value={delay}
                    onChange={(event) =>
                      setDelay(Number(event.target.value) as LockDelay)
                    }
                    disabled={busy}
                  >
                    {delays.map((minutes) => (
                      <option value={minutes} key={minutes}>
                        {delayLabel(minutes)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  App lock does not encrypt stored data. There is no PIN
                  recovery. Keep an encrypted backup before enabling app lock.
                </p>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </form>
        </Sheet>
      )}
      {error && !edit && <p role="alert">{error}</p>}
      {notice && <Toast message={notice} id={noticeId} undo={undo} />}
    </section>
  );
}
