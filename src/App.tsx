import { useGlobalCurrency } from "./components/CurrencySetting";
import { sectionForPath } from "./navigation/section";
import { ThemeSync } from "./components/Theme";
import {
  useEffect,
  useState,
  lazy,
  Suspense,
  Component,
  type ReactNode,
  type ErrorInfo,
} from "react";
import {
  HashRouter,
  Routes,
  Route,
  NavLink,
  Link,
  Navigate,
  useLocation,
} from "react-router-dom";
import {
  Home as HomeIcon,
  List,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  ShieldCheck,
  Plus,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { registerSW } from "virtual:pwa-register";
import { db, initializeDatabase } from "./storage/database";
import Home from "./pages/Home";
const Subscriptions = lazy(() => import("./pages/Subscriptions"));
const Category = lazy(() => import("./pages/Category"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Detail = lazy(() => import("./pages/TransactionDetail"));
const Analysis = lazy(() => import("./pages/Analysis"));
const Settings = lazy(() => import("./pages/Settings"));
const Import = lazy(() => import("./pages/Import"));
let applyUpdate: (reload?: boolean) => Promise<void>;
function Shell() {
  const location = useLocation();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [monthChosen, setMonthChosen] = useState(false);
  const latestDate = useLiveQuery(
    async () => (await db.transactions.orderBy("date").last())?.date,
    [],
  );
  useEffect(() => {
    if (!monthChosen && latestDate) setMonth(latestDate.slice(0, 7));
  }, [latestDate, monthChosen]);
  const chooseMonth = (value: string) => {
    setMonth(value);
    setMonthChosen(true);
  };
  const currency = useGlobalCurrency();
  const [initialized, setInitialized] = useState(false);
  const [initError, setInitError] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [storageWarning, setStorageWarning] = useState("");
  useEffect(() => {
    void initializeDatabase()
      .then(() => setInitialized(true))
      .catch(() =>
        setInitError(
          "Local storage could not be opened. Disable private browsing or allow website storage, then reload.",
        ),
      );
    if ("serviceWorker" in navigator)
      applyUpdate = registerSW({
        // The explicit Update action owns reloads, including first-session updates.
        onNeedReload: () => {},
        onNeedRefresh: () => setUpdateAvailable(true),
        onOfflineReady: () => setOfflineReady(true),
        onRegisteredSW: (_url, registration) => {
          if (registration) {
            void registration.update().catch(() => {});
            window.setInterval(
              () => {
                if (navigator.onLine)
                  void registration.update().catch(() => {});
              },
              60 * 60 * 1000,
            );
          }
        },
        onRegisterError: () =>
          !navigator.serviceWorker.controller &&
          setStorageWarning(
            "Offline installation did not complete. Reconnect and reload before using the app offline.",
          ),
      });
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if (navigator.storage?.estimate)
      void navigator.storage.estimate().then((s) => {
        if (s.quota && s.usage && s.usage / s.quota > 0.8)
          setStorageWarning(
            "Device storage is almost full. Export a backup before importing more statements.",
          );
      });
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const updateApp = async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.waiting) {
      window.location.reload();
      return;
    }
    const reload = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", reload, {
      once: true,
    });
    try {
      await applyUpdate(true);
    } catch {
      navigator.serviceWorker.removeEventListener("controllerchange", reload);
      setStorageWarning("Update failed. Reconnect and try again.");
    }
  };
  return (
    <div className="app" data-page={sectionForPath(location.pathname)}>
      <ThemeSync />
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <NavLink className="brand" to="/">
          <span className="brand-icon">
            F<span>·</span>
          </span>
          <span>
            Feng<span className="brand-finance">Finance</span>
          </span>
        </NavLink>
        <nav aria-label="Main navigation">
          {[
            ["/import", "Import", Plus],
            ["/transactions", "Transactions", List],
            ["/", "Home", HomeIcon],
            ["/analysis", "Analyse", ChartNoAxesCombined],
            ["/settings", "Settings", SettingsIcon],
          ].map(([path, label, Icon]) => {
            const I = Icon as typeof HomeIcon;
            const active =
              sectionForPath(location.pathname) ===
              sectionForPath(String(path));
            return (
              <Link
                key={String(path)}
                to={String(path)}
                className={active ? "active" : undefined}
                aria-current={active ? "page" : undefined}
              >
                <I size={20} />
                <span>{String(label)}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <span>
            Private by design
            <br />
            <small>Stored on your device</small>
          </span>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="mobile-header">
          <NavLink className="brand" to="/">
            <span className="brand-icon">
              F<span>·</span>
            </span>
            Feng Finance
          </NavLink>
          <span className="small-chip">{online ? "Private" : "Offline"}</span>
        </header>
        <div className="topline">
          <span className="muted">Personal finances</span>
          <div className="topline-controls">
            <span className="connection">
              {!online
                ? "Offline"
                : offlineReady
                  ? "Offline ready"
                  : "Local data"}
            </span>
          </div>
        </div>
        {updateAvailable && (
          <div className="notice update-notice" role="status">
            <span>
              Feng Finance update available. Save any import review first;
              updating reloads the app.
            </span>
            <button onClick={() => void updateApp()}>Update</button>
          </div>
        )}
        {storageWarning && (
          <div className="notice warning" role="status">
            {storageWarning}
          </div>
        )}
        <main id="main" tabIndex={-1}>
          {initError ? (
            <p role="alert">{initError}</p>
          ) : !initialized ? (
            <p role="status">Opening your local finances…</p>
          ) : (
            <Suspense fallback={<p role="status">Loading…</p>}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <Home
                      month={month}
                      setMonth={chooseMonth}
                      currency={currency}
                    />
                  }
                />
                <Route
                  path="/import"
                  element={
                    <Import onImported={(latest) => chooseMonth(latest)} />
                  }
                />
                <Route
                  path="/transactions"
                  element={
                    <Transactions
                      key={location.search + currency}
                      month={month}
                      currency={currency}
                    />
                  }
                />
                <Route path="/transactions/:id" element={<Detail />} />
                <Route
                  path="/analysis"
                  element={
                    <Analysis
                      month={month}
                      setMonth={chooseMonth}
                      currency={currency}
                    />
                  }
                />
                <Route
                  path="/property"
                  element={
                    <Analysis
                      key="property"
                      month={month}
                      setMonth={chooseMonth}
                      currency={currency}
                      property
                    />
                  }
                />
                <Route
                  path="/subscriptions"
                  element={<Subscriptions currency={currency} />}
                />
                <Route
                  path="/categories/:id"
                  element={
                    <Category
                      key={location.pathname + currency}
                      month={month}
                      currency={currency}
                      setMonth={chooseMonth}
                    />
                  }
                />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          )}
        </main>
        <footer className="desktop-footer">
          Feng Finance <span>Clarity, kept private.</span>
        </footer>
      </div>
    </div>
  );
}
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* No external or console financial logging. */
  }
  render() {
    return this.state.failed ? (
      <main className="empty">
        <h1>Feng Finance could not display this screen.</h1>
        <p>Your stored data has not been cleared. Reload to try again.</p>
        <button onClick={() => location.reload()}>Reload app</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Shell />
      </HashRouter>
    </ErrorBoundary>
  );
}
