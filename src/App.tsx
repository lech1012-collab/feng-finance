import {
  importReviewGeneration,
  subscribeImportReplacement,
  readInterruptedReview,
  rememberImportFiles,
} from "./import/interrupted-review";
import Accounts from "./pages/Accounts";
import { autoCloseEligibleMonths } from "./storage/month-review";
import { ImportPickerContext } from "./components/ImportPicker";
import {
  useGlobalCurrency,
  CurrencyViewNotice,
} from "./components/CurrencySetting";
import { sectionForPath } from "./navigation/section";
import { ThemeSync } from "./components/Theme";
import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useSyncExternalStore,
  lazy,
  Suspense,
  Component,
  type ReactNode,
  type ErrorInfo,
  type MouseEvent,
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
import { statementBalanceDate } from "./analytics/statement-balances";
import Home from "./pages/Home";
import { AppLock } from "./components/AppLock";
import { MonthReview } from "./components/MonthReview";
import { CURRENT_RELEASE } from "./beta/release";
import { isExactRecovery } from "./storage/safety-backup";
import {
  hasPendingFinancialWrites,
  subscribeFinancialWrites,
} from "./storage/write-activity";
import { APP_VERSION, type Setting } from "./domain/models";
import { BetaNotice } from "./beta/BetaNotice";
import { BackupCentre } from "./components/BackupCentre";
import { InstallBanner, InstallHelp } from "./beta/InstallGuidance";
import { DataNotices } from "./beta/DataNotices";
import {
  needsFirstBackupReminder,
  needsSeparateStorageWarning,
} from "./beta/policy";
import { WhatsNew } from "./beta/WhatsNew";
import { useWhatsNewPrompt } from "./beta/useWhatsNewPrompt";
import { useDesktopInstall } from "./beta/useDesktopInstall";
import { installUpdateChecks, useSafeUpdateVisibility } from "./beta/updates";
import {
  betaPreferences,
  currentRuntimeMode,
  needsBetaNotice,
  needsWhatsNew,
  noticeAcknowledgedSettings,
  requestPersistentStorage,
  firstRealImportAt,
} from "./beta/policy";
import { ToastProvider } from "./components/Toast";
import { AppHeader, DemoChip } from "./components/UIPrimitives";
import { localToday } from "./analytics/reminders";
import "./beta/beta.css";
import {
  activateLedger,
  currentLedger,
  openDemoLedger,
  type Ledger,
} from "./storage/ledgers";
import { periodMonth } from "./domain/period";
import { requestedMonth } from "./domain/dates";
import { useSearchParams } from "react-router-dom";
const Subscriptions = lazy(() => import("./pages/Subscriptions"));
const Category = lazy(() => import("./pages/Category"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Detail = lazy(() => import("./pages/TransactionDetail"));
const Analysis = lazy(() => import("./pages/Analysis"));
const Settings = lazy(() => import("./pages/Settings"));
const Import = lazy(() => import("./pages/Import"));
const Planning = lazy(() => import("./pages/Planning"));
// The main landmark is present while a lazy screen loads.
const navigationTitles: Record<string, string> = {
  "/": "Home",
  "/transactions": "Transactions",
  "/analysis": "Analyse",
  "/planning": "Planning",
  "/import": "Import statements",
  "/settings": "Settings",
};
let applyUpdate: (reload?: boolean) => Promise<void>;
function ReviewRoute({ month, currency }: { month: string; currency: string }) {
  const [params] = useSearchParams();
  return (
    <MonthReview
      month={requestedMonth(params.get("month"), month)}
      currency={currency}
    />
  );
}
function Shell() {
  const location = useLocation();
  const activeSection = sectionForPath(
    location.pathname,
    location.state?.returnTo,
  );
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const mobileNavigation = useRef<HTMLElement>(null);
  const focusDestination = useRef<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [importMounted, setImportMounted] = useState(false);
  const [pendingImportCount, setPendingImportCount] = useState(0);
  const [interruptedFiles, setInterruptedFiles] = useState(
    readInterruptedReview,
  );
  useEffect(() => {
    if (pendingImportCount)
      setInterruptedFiles((files) => (files.length ? [] : files));
  }, [pendingImportCount]);
  const hasPendingImport = useRef(false);
  hasPendingImport.current = !!selectedFiles.length || !!pendingImportCount;
  const [importMessage, setImportMessage] = useState("");
  const generation = useSyncExternalStore(
    subscribeImportReplacement,
    importReviewGeneration,
  );
  const previousGeneration = useRef(generation);
  useLayoutEffect(() => {
    if (previousGeneration.current === generation) return;
    previousGeneration.current = generation;
    rememberImportFiles([]);
    setInterruptedFiles([]);
    setSelectedFiles([]);
    setPendingImportCount(0);
    setImportMessage("");
  }, [generation]);
  const importActive = location.pathname === "/import";
  const preparingSelection = useRef(false);
  const selectPersonalFiles = async (files: File[]) => {
    if (!files.length || preparingSelection.current) return;
    preparingSelection.current = true;
    setImportMessage("");
    try {
      // A cancelled native picker never reaches the ledger switch.
      const selectionGeneration = importReviewGeneration();
      await activateLedger("personal");
      if (selectionGeneration !== importReviewGeneration()) return;
      setImportMounted(true);
      setSelectedFiles(files);
      if (!importActive) navigate("/import");
    } catch {
      setImportMessage(
        "Your personal finances could not be opened. Choose your statements again.",
      );
    } finally {
      preparingSelection.current = false;
    }
  };
  const previousPath = useRef(location.pathname);
  const openImportPicker = () => fileInput.current?.click();
  const openImport = () => {
    if (pendingImportCount || selectedFiles.length) {
      setImportMounted(true);
      navigate("/import");
    } else openImportPicker();
  };
  const activateNavigation = (event: MouseEvent, path: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const opensPicker = path === "/import" && !hasPendingImport.current;
    // Keyboard and assistive activation use a click count of zero. Move into the
    // destination on arrival. A native file picker owns focus until it closes.
    focusDestination.current = event.detail === 0 && !opensPicker ? path : null;
    if (focusDestination.current === location.pathname) {
      document.getElementById("main")?.focus({ preventScroll: true });
      focusDestination.current = null;
    }
    if (path === "/import") {
      event.preventDefault();
      openImport();
    }
  };
  useEffect(() => {
    if (importActive) setImportMounted(true);
  }, [importActive]);
  useEffect(() => {
    if (!pendingImportCount && !selectedFiles.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingImportCount, selectedFiles.length]);
  const ledger = useLiveQuery(() => currentLedger(), []);
  const [chosenMonths, setChosenMonths] = useState<
    Partial<Record<Ledger, string>>
  >({});
  const latestMonth = useLiveQuery(async () => {
    const today = localToday();
    const [latestTransaction, statements] = await Promise.all([
      db.transactions.where("date").belowOrEqual(today).last(),
      db.statements.toArray(),
    ]);
    const latestDate = [
      ...(latestTransaction ? [latestTransaction.date] : []),
      ...statements.map(statementBalanceDate),
    ]
      .filter((date) => date <= today)
      .sort()
      .at(-1);
    if (!latestDate || latestDate !== latestTransaction?.date)
      return latestDate?.slice(0, 7);
    return periodMonth(
      latestDate,
      await db.settings.toArray(),
      await db.transactions.where("categoryId").equals("salary").toArray(),
    );
  }, []);
  const month =
    (ledger && chosenMonths[ledger]) ?? latestMonth ?? localToday().slice(0, 7);
  const chooseMonth = (value: string) => {
    if (ledger) setChosenMonths((months) => ({ ...months, [ledger]: value }));
  };
  const currency = useGlobalCurrency();
  const [initialized, setInitialized] = useState(false);
  const [initError, setInitError] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const [betaBusy, setBetaBusy] = useState(false);
  const [betaFlowError, setBetaFlowError] = useState(false);
  const [exactRecovery, setExactRecovery] = useState(false);
  const [actualStoragePersisted, setActualStoragePersisted] =
    useState<boolean>();
  const [runtimeMode] = useState(currentRuntimeMode);
  const desktopInstall = useDesktopInstall();
  const betaData = useLiveQuery(async () => {
    if (!initialized) return undefined;
    const settings = await db.settings.toArray();
    const statements = await db.statements.filter((s) => !s.isDemo).toArray();
    const prefs = betaPreferences(settings);
    prefs.firstRealImportAt = firstRealImportAt(
      statements,
      prefs.firstRealImportAt,
    );
    return { prefs, hasRealImports: statements.length > 0 };
  }, [initialized]);
  useEffect(() => {
    if (!betaData) return;
    let active = true;
    void (navigator.storage?.persisted?.() ?? Promise.resolve(false))
      .then((protectedStorage) => {
        if (active) setActualStoragePersisted(protectedStorage);
      })
      .catch(() => {
        if (active) setActualStoragePersisted(false);
      });
    return () => {
      active = false;
    };
  }, [!!betaData, betaData?.prefs.storagePersisted]);
  const pendingFinancialWrite = useSyncExternalStore(
    subscribeFinancialWrites,
    hasPendingFinancialWrites,
    hasPendingFinancialWrites,
  );
  const safeUpdate = useSafeUpdateVisibility(
    location.pathname,
    betaBusy ||
      !!selectedFiles.length ||
      !!pendingImportCount ||
      pendingFinancialWrite,
  );
  const saveBetaSettings = async (settings: Setting[]) => {
    await db.transaction("rw", db.settings, () =>
      db.settings.bulkPut(settings),
    );
  };
  const whatsNewPrompt = useWhatsNewPrompt(
    !!betaData &&
      !exactRecovery &&
      !betaBusy &&
      safeUpdate &&
      !needsBetaNotice(betaData.prefs) &&
      needsWhatsNew(betaData.prefs, APP_VERSION),
    APP_VERSION,
    () => saveBetaSettings([{ key: "lastSeenVersion", value: APP_VERSION }]),
  );
  const requestBetaStorage = async () => {
    const persisted = await requestPersistentStorage(navigator.storage);
    setActualStoragePersisted(persisted);
    try {
      await saveBetaSettings([
        { key: "storagePersisted", value: String(persisted) },
      ]);
    } catch {
      setStorageWarning(
        "Storage protection could not be recorded. Save a backup before importing more statements.",
      );
    }
  };
  const acceptBeta = async (choice: "demo" | "import") => {
    // Keep the native Files picker in the user's synchronous tap gesture.
    if (choice === "import") openImportPicker();
    setBetaBusy(true);
    setBetaFlowError(false);
    try {
      await saveBetaSettings([
        ...noticeAcknowledgedSettings(),
        ...(betaData?.prefs.lastSeenVersion
          ? []
          : [
              {
                key: "lastSeenVersion",
                value: betaData?.hasRealImports ? "previous" : APP_VERSION,
              },
            ]),
      ]);
      await requestBetaStorage();
      if (choice === "demo") {
        await openDemoLedger();
        navigate("/");
      }
    } catch (error) {
      setBetaFlowError(true);
      throw error;
    } finally {
      setBetaBusy(false);
    }
  };

  const previousLedger = useRef<Ledger | undefined>(undefined);
  useLayoutEffect(() => {
    if (!ledger) return;
    const previous = previousLedger.current;
    previousLedger.current = ledger;
    if (previous && previous !== ledger) {
      if (ledger === "demo") {
        if (hasPendingImport.current)
          setImportMessage(
            "Demo data was opened in another tab. Reselect your statements to resume in your personal finances.",
          );
        setSelectedFiles([]);
        setPendingImportCount(0);
      }
    }
    if (ledger === "demo") {
      rememberImportFiles([]);
      setInterruptedFiles([]);
    }
  }, [ledger]);
  const [online, setOnline] = useState(navigator.onLine);
  const [storageWarning, setStorageWarning] = useState("");
  useEffect(() => {
    const searchShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
            !!target.closest("dialog[open]")))
      )
        return;
      event.preventDefault();
      navigate("/transactions?allDates=1");
      const focusSearch = () => {
        const input = document.querySelector<HTMLInputElement>(
          "#transaction-search",
        );
        if (!input) return false;
        input.focus();
        return true;
      };
      if (focusSearch()) return;
      const observer = new MutationObserver(() => {
        if (focusSearch()) observer.disconnect();
      });
      observer.observe(document.getElementById("main") ?? document.body, {
        childList: true,
        subtree: true,
      });
      window.setTimeout(() => observer.disconnect(), 5000);
    };
    window.addEventListener("keydown", searchShortcut);
    return () => window.removeEventListener("keydown", searchShortcut);
  }, [navigate]);
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
    let cleanupUpdateChecks: (() => void) | undefined;
    void initializeDatabase()
      .then(async () => {
        const recovered = await isExactRecovery(db);
        setExactRecovery(recovered);
        setInitialized(true);
        if (!recovered) void autoCloseEligibleMonths().catch(() => {});
        try {
          if (
            !recovered &&
            navigator.storage?.persisted &&
            (await db.settings.get("betaNoticeAcceptedVersion"))
          ) {
            const protectedStorage = await navigator.storage
              .persisted()
              .catch(() => false);
            const previous = await db.settings.get("storagePersisted");
            if (previous?.value !== String(protectedStorage))
              await db.settings.put({
                key: "storagePersisted",
                value: String(protectedStorage),
              });
          }
        } catch {
          setStorageWarning(
            "Storage protection could not be checked. Save a backup before importing more statements.",
          );
        }
      })
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
          if (registration)
            cleanupUpdateChecks = installUpdateChecks(registration);
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
      cleanupUpdateChecks?.();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    const leavingImport = previousPath.current === "/import" && !importActive;
    previousPath.current = location.pathname;
    if (!importActive) window.scrollTo(0, 0);
    // WebKit can retain its sequential Tab starting point inside the now inert
    // import workspace. Put focus on the visible page after leaving review.
    if (leavingImport || focusDestination.current === location.pathname)
      document.getElementById("main")?.focus({ preventScroll: true });
    focusDestination.current = null;
    let targetId: string;
    try {
      targetId = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
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
    observer.observe(document.getElementById("main") ?? document.body, {
      childList: true,
      subtree: true,
    });
    const timeout = window.setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [location.pathname, location.hash]);
  // Keep the Settings switch/restore result visible after a successful switch.
  // Remount financial forms so drafts and selected record IDs stay in their ledger.
  const ledgerActionPage =
    location.pathname === "/settings" &&
    ["demo", "backup", "danger"].includes(
      new URLSearchParams(location.search).get("section") ?? "",
    );
  const updateApp = async () => {
    const permitted = () =>
      ["", "#", "#/"].includes(window.location.hash.split("?")[0]) &&
      location.pathname === "/" &&
      !betaBusy &&
      !hasPendingImport.current &&
      !hasPendingFinancialWrites() &&
      !document.querySelector("dialog[open], [aria-modal='true']");
    if (!permitted()) return;
    const registration = await navigator.serviceWorker.getRegistration();
    // Navigation or a save can begin while the browser resolves registration.
    if (!permitted()) return;
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
    <ImportPickerContext.Provider value={openImport}>
      <div className="app" data-page={activeSection}>
        <input
          ref={fileInput}
          className="sr-only"
          tabIndex={-1}
          type="file"
          accept="application/pdf,.pdf,text/csv,.csv,.ofx,.qfx,.qif"
          multiple
          aria-label="Quick import statements"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void selectPersonalFiles(files);
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
          <NavLink className="brand" to="/" aria-label="Feng Finance">
            <img
              className="brand-icon"
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt=""
            />
            <span>
              Feng<span className="brand-finance">Finance</span>
            </span>
          </NavLink>
          {initialized && ledger === "demo" && (
            <DemoChip to="/settings?section=demo#demo" />
          )}
          <button
            className="primary sidebar-import"
            onClick={(event) => activateNavigation(event, "/import")}
            aria-current={activeSection === "import" ? "page" : undefined}
          >
            <Plus size={20} />
            {pendingImportCount
              ? `Resume import (${pendingImportCount})`
              : "Import statement"}
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
              const active = activeSection === sectionForPath(String(path));
              return (
                <Link
                  key={String(path)}
                  to={String(path)}
                  onClick={(event) => activateNavigation(event, String(path))}
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
          {(
            [
              [
                "/import",
                pendingImportCount
                  ? `Import (${pendingImportCount})`
                  : "Import",
                Plus,
              ],
              ["/transactions", "Activity", List],
              ["/", "Home", HomeIcon],
              ["/analysis", "Analyse", ChartNoAxesCombined],
              ["/planning", "Planning", CalendarClock],
            ] as const
          ).map(([path, label, Icon]) => {
            const active = activeSection === sectionForPath(path);
            return (
              <Link
                key={path}
                to={path}
                aria-label={label}
                className={active ? "active" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={(event) => activateNavigation(event, path)}
              >
                <Icon size={21} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="main-wrap">
          <AppHeader
            className="mobile-header"
            actions={
              <>
                <div className="header-states">
                  {initialized && ledger === "demo" && (
                    <DemoChip to="/settings?section=demo#demo" />
                  )}
                  {initialized && !initError && (
                    <CurrencyViewNotice
                      currency={currency}
                      allowAutomaticDownload={
                        !exactRecovery &&
                        !!betaData &&
                        !needsBetaNotice(betaData.prefs) &&
                        !betaBusy
                      }
                    />
                  )}
                  {!online && (
                    <button
                      className="header-status"
                      type="button"
                      aria-label="Offline. Feng works offline; exchange rates cannot update."
                      title="Feng works offline. Exchange rates cannot update."
                      onClick={() =>
                        setStorageWarning(
                          "Feng works offline. Exchange rates cannot update until you reconnect.",
                        )
                      }
                    >
                      ↯
                    </button>
                  )}
                </div>
                <Link
                  to="/settings"
                  onClick={(event) => activateNavigation(event, "/settings")}
                  className="mobile-settings"
                  aria-label="Settings"
                  aria-current={
                    location.pathname === "/settings" ? "page" : undefined
                  }
                >
                  <SettingsIcon size={22} />
                </Link>
              </>
            }
          >
            <NavLink className="brand" to="/" aria-label="Feng Finance">
              <img
                className="brand-icon"
                src={`${import.meta.env.BASE_URL}favicon.svg`}
                alt=""
              />
              <span>
                Feng<span className="brand-finance"> Finance</span>
              </span>
            </NavLink>
          </AppHeader>
          {updateAvailable &&
            safeUpdate &&
            betaData &&
            !needsBetaNotice(betaData.prefs) && (
              <div className="notice update-notice" role="status">
                <span>A new version of Feng is ready</span>
                <button onClick={() => void updateApp()}>Reload</button>
              </div>
            )}
          {importMessage && (
            <div className="notice" role="status">
              {importMessage}
            </div>
          )}
          {storageWarning && (
            <div className="notice warning" role="status">
              {storageWarning}
            </div>
          )}
          {betaData &&
            !exactRecovery &&
            !betaBusy &&
            !needsBetaNotice(betaData.prefs) &&
            location.pathname === "/" &&
            location.state?.importedCount === undefined &&
            !(
              betaData.hasRealImports &&
              (needsSeparateStorageWarning(betaData.prefs, runtimeMode, true) ||
                needsFirstBackupReminder(betaData.prefs))
            ) && (
              <InstallBanner
                prefs={betaData.prefs}
                mode={runtimeMode}
                onSave={saveBetaSettings}
              />
            )}
          {betaData &&
            !exactRecovery &&
            !betaBusy &&
            !needsBetaNotice(betaData.prefs) &&
            location.pathname === "/" &&
            location.state?.importedCount === undefined && (
              <DataNotices
                prefs={betaData.prefs}
                mode={runtimeMode}
                hasRealImports={betaData.hasRealImports}
                onSave={saveBetaSettings}
                onBackup={async () => {
                  navigate("/settings?section=backup&save=1#backup");
                }}
              />
            )}
          {whatsNewPrompt.visible && (
            <WhatsNew
              release={CURRENT_RELEASE}
              onClose={whatsNewPrompt.dismiss}
            />
          )}
          <main
            id="main"
            tabIndex={-1}
            aria-label={navigationTitles[location.pathname]}
          >
            {initError ? (
              <p role="alert">{initError}</p>
            ) : !initialized || !betaData || !ledger ? (
              <p role="status">Opening your local finances…</p>
            ) : needsBetaNotice(betaData.prefs) || betaBusy || betaFlowError ? (
              location.pathname === "/settings" &&
              (new URLSearchParams(location.search).get("section") ===
                "backup" ||
                location.hash === "#backup") ? (
                <>
                  <div className="page-heading">
                    <h1>Restore your backup</h1>
                  </div>
                  <section className="card">
                    <p>
                      Choose your Feng backup from Files. You can check its
                      contents before replacing data on this device. Feng is in
                      beta. Check restored figures against your statements.
                    </p>
                    <BackupCentre
                      firstLaunch
                      onRestored={() => setBetaFlowError(false)}
                    />
                  </section>
                  <Link className="back-link" to="/">
                    Back to Welcome
                  </Link>
                </>
              ) : (
                <BetaNotice
                  onAccept={acceptBeta}
                  recovery={
                    <BackupCentre
                      firstLaunch
                      onRestored={() => setBetaFlowError(false)}
                    />
                  }
                  installHelp={
                    runtimeMode.ios && !runtimeMode.installed ? (
                      <InstallHelp mode={runtimeMode} />
                    ) : undefined
                  }
                />
              )
            ) : (
              <>
                {ledger === "personal" &&
                  !!interruptedFiles.length &&
                  !pendingImportCount &&
                  !selectedFiles.length &&
                  (importActive || location.pathname === "/") && (
                    <section
                      className="notice interrupted-review"
                      aria-labelledby="interrupted-heading"
                    >
                      <h2 id="interrupted-heading">Reselect your statements</h2>
                      <p>
                        The previous review was interrupted. Choose the files
                        you still want to import. Feng checks for duplicates
                        again.
                      </p>
                      <ul>
                        {interruptedFiles.map((name, index) => (
                          <li key={index}>{name}</li>
                        ))}
                      </ul>
                      <div className="actions">
                        <button className="primary" onClick={openImport}>
                          Choose files again
                        </button>
                        <button
                          onClick={() => {
                            rememberImportFiles([]);
                            setInterruptedFiles([]);
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    </section>
                  )}
                {!!pendingImportCount && !importActive && (
                  <div className="notice" role="status">
                    <span>
                      {pendingImportCount} statement
                      {pendingImportCount === 1 ? "" : "s"} in your pending
                      review.
                    </span>
                    <button type="button" onClick={openImport}>
                      Resume import
                    </button>
                  </div>
                )}
                <Suspense
                  key={
                    ledgerActionPage
                      ? location.pathname
                      : location.pathname + ledger
                  }
                  fallback={<p role="status">Loading…</p>}
                >
                  <Routes>
                    <Route path="/accounts" element={<Accounts />} />
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
                    <Route path="/import" element={null} />
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
                    <Route
                      path="/settings"
                      element={
                        <Settings
                          importPending={
                            !!pendingImportCount || !!selectedFiles.length
                          }
                          beta={{
                            mode: runtimeMode,
                            storagePersisted:
                              actualStoragePersisted ??
                              betaData.prefs.storagePersisted,
                            desktopInstall,
                            onRequestStorage: requestBetaStorage,
                          }}
                        />
                      }
                    />
                    <Route
                      path="/review"
                      element={
                        <ReviewRoute month={month} currency={currency} />
                      }
                    />
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
                {(importMounted || importActive) && (
                  <div hidden={!importActive} inert={!importActive}>
                    <Suspense
                      fallback={
                        importActive ? (
                          <p role="status">Opening your import review…</p>
                        ) : null
                      }
                    >
                      <Import
                        key={`${ledger}-${generation}`}
                        onSelectFiles={selectPersonalFiles}
                        active={importActive}
                        selectedFiles={
                          ledger === "personal" ? selectedFiles : undefined
                        }
                        onFilesStarted={() => setSelectedFiles([])}
                        onPendingChange={setPendingImportCount}
                        onImported={(latest) => chooseMonth(latest)}
                      />
                    </Suspense>
                  </div>
                )}
              </>
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
        <AppLock>
          <ToastProvider>
            <Shell />
          </ToastProvider>
        </AppLock>
      </HashRouter>
    </ErrorBoundary>
  );
}
