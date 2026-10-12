import type { Setting } from "../domain/models";

export const BETA_NOTICE_VERSION = "1";
export const INSTALL_INTERVAL_MS = 7 * 86400000;
export const MAX_INSTALL_BANNER_SHOWS = 3;

export interface RuntimeMode {
  installed: boolean;
  ios: boolean;
  safari: boolean;
  device: "iPhone" | "iPad" | "desktop" | "other";
}

export interface BetaPreferences {
  acceptedNoticeVersion?: string;
  acceptedAt?: string;
  installDismissCount: number;
  installShowCount: number;
  installNeverShow: boolean;
  installLastDismissedAt?: string;
  installLastShownAt?: string;
  storagePersisted: boolean;
  lastSeenVersion?: string;
  separateStorageWarningSeen: boolean;
  firstRealImportAt?: string;
  lastBackupAt?: string;
}

function nonnegativeCount(value?: string) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

export function betaPreferences(settings: readonly Setting[]): BetaPreferences {
  const values = new Map(settings.map((s) => [s.key, s.value]));
  return {
    acceptedNoticeVersion: values.get("betaNoticeAcceptedVersion"),
    acceptedAt: values.get("betaNoticeAcceptedAt"),
    installDismissCount: nonnegativeCount(
      values.get("installBannerDismissCount"),
    ),
    installShowCount: nonnegativeCount(
      values.get("installBannerShowCount") ??
        values.get("installBannerDismissCount"),
    ),
    installNeverShow: values.get("installBannerNeverShow") === "true",
    installLastDismissedAt: values.get("installBannerLastDismissedAt"),
    installLastShownAt: values.get("installBannerLastShownAt"),
    storagePersisted: values.get("storagePersisted") === "true",
    lastSeenVersion: values.get("lastSeenVersion"),
    separateStorageWarningSeen:
      values.get("separateStorageWarningSeen") === "true",
    firstRealImportAt: values.get("firstRealImportAt"),
    lastBackupAt: values.get("backup:lastExportAt"),
  };
}

export function needsBetaNotice(prefs: BetaPreferences) {
  return prefs.acceptedNoticeVersion !== BETA_NOTICE_VERSION;
}

export function detectRuntimeMode(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
  mediaStandalone: boolean,
  navigatorStandalone = false,
): RuntimeMode {
  const ipad =
    /iPad/i.test(userAgent) || (/Mac/i.test(platform) && maxTouchPoints > 1);
  const iphone = /iPhone|iPod/i.test(userAgent);
  const ios = ipad || iphone;
  // WebKit runs in every iOS browser; their vendor tokens identify the Safari alternatives.
  const safari =
    /Version\/[\d.]+.*Safari/i.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA/i.test(userAgent);
  return {
    installed: mediaStandalone || navigatorStandalone,
    ios,
    safari,
    device: ipad
      ? "iPad"
      : iphone
        ? "iPhone"
        : /Android/i.test(userAgent)
          ? "other"
          : "desktop",
  };
}

export function currentRuntimeMode(): RuntimeMode {
  const n = navigator as Navigator & { standalone?: boolean };
  return detectRuntimeMode(
    n.userAgent,
    n.platform,
    n.maxTouchPoints,
    window.matchMedia?.("(display-mode: standalone)").matches ?? false,
    n.standalone === true,
  );
}

export function shouldShowInstallBanner(
  prefs: BetaPreferences,
  mode: RuntimeMode,
  now = Date.now(),
) {
  if (
    !mode.ios ||
    mode.installed ||
    prefs.installNeverShow ||
    prefs.installShowCount >= MAX_INSTALL_BANNER_SHOWS
  )
    return false;
  const shown = Date.parse(prefs.installLastShownAt ?? "");
  const dismissed = Date.parse(prefs.installLastDismissedAt ?? "");
  const timestamps = [shown, dismissed].filter(Number.isFinite);
  const last = timestamps.length ? Math.max(...timestamps) : undefined;
  return last === undefined || now - last >= INSTALL_INTERVAL_MS;
}

export function installShownSettings(
  prefs: BetaPreferences,
  now = new Date(),
): Setting[] {
  return [
    {
      key: "installBannerShowCount",
      value: String(prefs.installShowCount + 1),
    },
    { key: "installBannerLastShownAt", value: now.toISOString() },
  ];
}

export function installDismissedSettings(
  prefs: BetaPreferences,
  never: boolean,
  now = new Date(),
): Setting[] {
  return [
    {
      key: "installBannerDismissCount",
      value: String(prefs.installDismissCount + 1),
    },
    { key: "installBannerLastDismissedAt", value: now.toISOString() },
    { key: "installBannerNeverShow", value: String(never) },
  ];
}

export function noticeAcknowledgedSettings(now = new Date()): Setting[] {
  return [
    { key: "betaNoticeAcceptedVersion", value: BETA_NOTICE_VERSION },
    { key: "betaNoticeAcceptedAt", value: now.toISOString() },
  ];
}

export function needsSeparateStorageWarning(
  prefs: BetaPreferences,
  mode: RuntimeMode,
  hasRealImports: boolean,
) {
  return (
    mode.ios &&
    mode.safari &&
    !mode.installed &&
    hasRealImports &&
    !prefs.separateStorageWarningSeen
  );
}

export function needsFirstBackupReminder(
  prefs: BetaPreferences,
  now = Date.now(),
) {
  const imported = Date.parse(prefs.firstRealImportAt ?? "");
  const exported = Date.parse(prefs.lastBackupAt ?? "");
  return (
    Number.isFinite(imported) &&
    !Number.isFinite(exported) &&
    now - imported >= INSTALL_INTERVAL_MS
  );
}

/** Real imports already on a device retain their original reminder date after an update. */
export function firstRealImportAt(
  statements: readonly { importedAt: string; isDemo?: boolean }[],
  existing?: string,
): string | undefined {
  const dates = [
    ...(existing ? [existing] : []),
    ...statements.filter((s) => !s.isDemo).map((s) => s.importedAt),
  ]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return dates.length ? new Date(Math.min(...dates)).toISOString() : undefined;
}

export function needsWhatsNew(prefs: BetaPreferences, appVersion: string) {
  // The first visit gets the beta notice rather than a second introductory sheet.
  return !!prefs.lastSeenVersion && prefs.lastSeenVersion !== appVersion;
}

export function mayShowUpdate(
  pathname: string,
  busy: boolean,
  openDialog: boolean,
) {
  return pathname === "/" && !busy && !openDialog;
}

export async function requestPersistentStorage(
  storage: Pick<StorageManager, "persist" | "persisted"> | undefined,
) {
  try {
    if (!storage) return false;
    if (await storage.persisted?.()) return true;
    return (await storage.persist?.()) ?? false;
  } catch {
    return false;
  }
}
