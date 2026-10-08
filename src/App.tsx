import { ImportPickerContext } from "./components/ImportPicker";
import {
  useGlobalCurrency,
  CurrencyViewNotice,
} from "./components/CurrencySetting";
import { sectionForPath } from "./navigation/section";
import { ThemeSync } from "./components/Theme";
import {
  useEffect,
  useState,
  useRef,
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
  useNavigate,
} from "react-router-dom";
import {
  Home as HomeIcon,
  List,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  Plus,
  CalendarClock,
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
const Planning = lazy(() => import("./pages/Planning"));
let applyUpdate: (reload?: boolean) => Promise<void>;
function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const mobileNavigation = useRef<HTMLElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const openImportPicker = () => fileInput.current?.click();
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

  const [online, setOnline] = useState(navigator.onLine);
  const [storageWarning, setStorageWarning] = useState("");
  useEffect(() => {
    const navigation = mobileNavigation.current;
    if (!navigation) return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.target.getBoundingClientRect().height;
      document.documentElement.style.setProperty(
        "--mobile-nav-height",
        `${height}px`,
      );
    });
    observer.observe(navigation);
    return () => observer.disconnect();
  }, []);
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
    const targetId = decodeURIComponent(location.hash.slice(1));
    if (!targetId) return;
    const reveal = () => {
      const target = document.getElementById(targetId);
      if (!target) return false;
      target.scrollIntoView({ block: "center" });
      return true;
    };
    if (reveal()) return;
    // Settings is lazy loaded; keep its deep links reliable after rendering.
    const observer = new MutationObserver(() => {
      if (reveal()) observer.disconnect();
    });
    observer.observe(document.getElementById("main")!, {
      childList: true,
      subtree: true,
    });
    const timeout = window.setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [location.pathname, location.hash]);
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
    <ImportPickerContext.Provider value={openImportPicker}>
      <div className="app" data-page={sectionForPath(location.pathname)}>
        <input
          ref={fileInput}
          className="sr-only"
          tabIndex={-1}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          aria-label="Quick import PDFs"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) {
              setSelectedFiles(files);
              navigate("/import");
            }
          }}
        />
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
          <button
            className="primary sidebar-import"
            onClick={openImportPicker}
            aria-current={
              sectionForPath(location.pathname) === "import"
                ? "page"
                : undefined
            }
          >
            <Plus size={20} />
            Import statement
          </button>
          <nav aria-label="Main navigation">
            {[
              ["/", "Home", HomeIcon],
              ["/transactions", "Transactions", List],
              ["/analysis", "Analyse", ChartNoAxesCombined],
              ["/planning", "Planning", CalendarClock],
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
                  onClick={
                    path === "/import"
                      ? (e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                            return;
                          e.preventDefault();
                          openImportPicker();
                        }
                      : undefined
                  }
                  className={
                    `${path === "/planning" ? "planning-nav " : ""}${active ? "active" : ""}`.trim() ||
                    undefined
                  }
                  aria-current={active ? "page" : undefined}
                >
                  <I size={20} />
                  <span>{String(label)}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <nav
          ref={mobileNavigation}
          className="mobile-navigation"
          aria-label="Main navigation"
        >
          {[
            ["/import", "Import", Plus],
            ["/transactions", "Transactions", List],
            ["/", "Home", HomeIcon],
            ["/analysis", "Analyse", ChartNoAxesCombined],
            ["/planning", "Planning", CalendarClock],
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
                onClick={
                  path === "/import"
                    ? (event) => {
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        openImportPicker();
                      }
                    : undefined
                }
              >
                <I size={21} />
                <span>{String(label)}</span>
              </Link>
            );
          })}
        </nav>
        <div className="main-wrap">
          <header className="mobile-header">
            <NavLink className="brand" to="/">
              <span className="brand-icon">
                F<span>·</span>
              </span>
              Feng Finance
            </NavLink>
            <Link
              to="/settings"
              className="mobile-settings"
              aria-label="Settings"
              aria-current={
                location.pathname === "/settings" ? "page" : undefined
              }
            >
              <SettingsIcon size={22} />
            </Link>
            {!online && <span className="small-chip">Offline</span>}
          </header>
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
          {initialized && !initError && (
            <CurrencyViewNotice currency={currency} />
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
                      <Import
                        selectedFiles={selectedFiles}
                        onFilesStarted={() => setSelectedFiles([])}
                        onImported={(latest) => chooseMonth(latest)}
                      />
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
                  <Route
                    path="/planning"
                    element={
                      <Planning
                        month={month}
                        setMonth={chooseMonth}
                        currency={currency}
                      />
                    }
                  />
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
    </ImportPickerContext.Provider>
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
