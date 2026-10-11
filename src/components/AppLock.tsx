import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LockKeyhole } from "lucide-react";
import { flushSync } from "react-dom";
import {
  appLockConfiguration,
  authenticatePlatform,
  SECURITY_CHANGE_EVENT,
  shouldLockOnReturn,
  verifyAppPin,
  type AppLockConfiguration,
} from "../security/app-lock";
import "../security/security.css";
const LockContext = createContext({ lockNow: () => undefined as void });
export function useAppLock() {
  return useContext(LockContext);
}
/** The financial application is not mounted while locked or before configuration loads. */
export function AppLock({ children }: { children: ReactNode }) {
  const [configuration, setConfiguration] = useState<AppLockConfiguration>();
  const [locked, setLocked] = useState(true);
  const [hidden, setHidden] = useState(document.visibilityState === "hidden");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hiddenAt = useRef<number | undefined>(undefined);
  const authenticationGeneration = useRef(0);
  const configRef = useRef(configuration);
  configRef.current = configuration;
  const invalidateAndLock = useCallback(() => {
    authenticationGeneration.current += 1;
    setLocked(true);
    setPin("");
    setError("");
    setBusy(false);
  }, []);
  useEffect(() => {
    let active = true;
    const load = async (initial: boolean) => {
      try {
        const next = await appLockConfiguration();
        if (active) {
          setConfiguration(next);
          if (initial || !next.enabled) {
            authenticationGeneration.current += 1;
            setLocked(next.enabled);
          }
        }
      } catch {
        if (active)
          setError(
            "App security could not be loaded. Reload Feng to try again.",
          );
      }
    };
    void load(true);
    const changed = () => {
      void load(false);
    };
    window.addEventListener(SECURITY_CHANGE_EVENT, changed);
    return () => {
      active = false;
      window.removeEventListener(SECURITY_CHANGE_EVENT, changed);
    };
  }, []);
  useEffect(() => {
    const visibility = (event?: Event) => {
      const now = Date.now(),
        settings = configRef.current;
      if (document.visibilityState === "hidden" || event?.type === "pagehide") {
        hiddenAt.current ??= now;
        // Flush before the browser captures its app-switcher thumbnail.
        flushSync(() => {
          setHidden(true);
          if (settings?.enabled && settings.delayMinutes === 0)
            invalidateAndLock();
        });
      } else {
        // Setting the lock in the same render as removing the privacy cover prevents a data flash.
        flushSync(() => {
          if (
            settings?.enabled &&
            shouldLockOnReturn(hiddenAt.current, now, settings.delayMinutes)
          )
            invalidateAndLock();
          setHidden(false);
        });
        hiddenAt.current = undefined;
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", visibility);
    window.addEventListener("pageshow", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", visibility);
      window.removeEventListener("pageshow", visibility);
    };
  }, [invalidateAndLock]);
  const lockNow = useCallback(() => {
    if (configRef.current?.enabled) invalidateAndLock();
  }, [invalidateAndLock]);
  const unlock = async (biometric = false) => {
    const generation = ++authenticationGeneration.current;
    setBusy(true);
    setError("");
    try {
      if (biometric) await authenticatePlatform();
      else if (!(await verifyAppPin(pin)))
        throw new Error("The PIN is incorrect. Try again.");
      if (generation !== authenticationGeneration.current) return;
      setLocked(false);
      setPin("");
    } catch (failure) {
      if (generation === authenticationGeneration.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Authentication did not complete. Try your PIN.",
        );
    } finally {
      if (generation === authenticationGeneration.current) setBusy(false);
    }
  };
  if (!configuration)
    return (
      <main className="app-lock-screen" role="status">
        <LockKeyhole size={32} aria-hidden="true" />
        <h1>Feng Finance</h1>
        <p>{error || "Opening your secure workspace…"}</p>
      </main>
    );
  if (configuration.enabled && locked)
    return (
      <main className="app-lock-screen" aria-label="Feng Finance locked">
        <LockKeyhole size={40} aria-hidden="true" />
        <h1>Feng Finance</h1>
        <p>Unlock your finances</p>
        {configuration.credentialId && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void unlock(true)}
          >
            Use Face ID or Touch ID
          </button>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <label htmlFor="unlock-pin">6-digit app PIN</label>
          <input
            id="unlock-pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replaceAll(/\D/g, ""))
            }
            disabled={busy}
          />
          <button
            className="primary"
            disabled={busy || pin.length !== 6}
            type="submit"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <p className="muted">Your PIN stays on this device.</p>
      </main>
    );
  return (
    <LockContext.Provider value={{ lockNow }}>
      <div
        className={
          hidden
            ? "feng-private-content feng-private-content-hidden"
            : "feng-private-content"
        }
        aria-hidden={hidden || undefined}
        inert={hidden || undefined}
      >
        {children}
      </div>
      {hidden && (
        <div
          className="app-lock-screen app-privacy-cover"
          aria-label="Financial content hidden"
        >
          <LockKeyhole size={40} aria-hidden="true" />
          <h1>Feng Finance</h1>
        </div>
      )}
    </LockContext.Provider>
  );
}
