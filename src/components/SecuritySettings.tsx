import { useEffect, useState } from "react";
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
import "../security/security.css";
export function SecuritySettings() {
  const [configuration, setConfiguration] = useState<AppLockConfiguration>();
  const [pin, setPin] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [delay, setDelay] = useState<LockDelay>(1);
  const [biometrics, setBiometrics] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
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
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setPin("");
      setConfirmation("");
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
      <h2>Security</h2>
      <p>
        App lock protects against casual access. Your local database is not
        encrypted by this lock.
      </p>
      {configuration && !configuration.enabled ? (
        <form
          className="security-fields"
          onSubmit={(event) => {
            event.preventDefault();
            if (pin !== confirmation) {
              setError("The PINs do not match.");
              return;
            }
            void run(
              () => enableAppLock(pin, delay),
              "App lock enabled. Keep your PIN safe.",
            );
          }}
        >
          <label>
            Choose a 6-digit app PIN
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="new-password"
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replaceAll(/\D/g, ""))
              }
              disabled={busy}
            />
          </label>
          <label>
            Confirm PIN
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmation}
              onChange={(event) =>
                setConfirmation(event.target.value.replaceAll(/\D/g, ""))
              }
              disabled={busy}
            />
          </label>
          <label>
            Lock after being away
            <select
              value={delay}
              onChange={(event) =>
                setDelay(Number(event.target.value) as LockDelay)
              }
              disabled={busy}
            >
              {[0, 1, 5, 15].map((minutes) => (
                <option value={minutes} key={minutes}>
                  {minutes === 0
                    ? "Immediately"
                    : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="primary"
            disabled={busy || pin.length !== 6 || confirmation.length !== 6}
          >
            Enable app lock
          </button>
          <p className="muted">
            There is no PIN recovery. Keep an encrypted backup before enabling
            app lock.
          </p>
        </form>
      ) : configuration?.enabled ? (
        <div className="security-fields">
          <p role="status">App lock is on.</p>
          <label>
            Lock after being away
            <select
              value={delay}
              disabled={busy}
              onChange={(event) =>
                void run(
                  () => setLockDelay(Number(event.target.value) as LockDelay),
                  "Lock delay saved.",
                )
              }
            >
              {[0, 1, 5, 15].map((minutes) => (
                <option value={minutes} key={minutes}>
                  {minutes === 0
                    ? "Immediately"
                    : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`}
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
          <details>
            <summary>Turn app lock off</summary>
            <form
              className="security-fields"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => disableAppLock(pin), "App lock disabled.");
              }}
            >
              <label>
                Current PIN
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replaceAll(/\D/g, ""))
                  }
                />
              </label>
              <button disabled={busy || pin.length !== 6}>
                Disable app lock
              </button>
            </form>
          </details>
        </div>
      ) : (
        <p>Loading security settings…</p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
