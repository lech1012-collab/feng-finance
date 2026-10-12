import { describe, expect, it, vi } from "vitest";
import {
  BETA_NOTICE_VERSION,
  INSTALL_INTERVAL_MS,
  betaPreferences,
  detectRuntimeMode,
  firstRealImportAt,
  installDismissedSettings,
  installShownSettings,
  mayShowUpdate,
  needsBetaNotice,
  needsFirstBackupReminder,
  needsSeparateStorageWarning,
  needsWhatsNew,
  noticeAcknowledgedSettings,
  requestPersistentStorage,
  shouldShowInstallBanner,
} from "./policy";

const safari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const safariMode = detectRuntimeMode(safari, "iPhone", 5, false);
const start = new Date("2026-10-11T12:00:00.000Z");

describe("beta notice and runtime detection", () => {
  it("requires an acknowledgement for new or changed wording, not for every app release", () => {
    const initial = betaPreferences([]);
    expect(needsBetaNotice(initial)).toBe(true);
    const prefs = betaPreferences(noticeAcknowledgedSettings(start));
    expect(prefs.acceptedNoticeVersion).toBe(BETA_NOTICE_VERSION);
    expect(prefs.acceptedAt).toBe(start.toISOString());
    expect(needsBetaNotice(prefs)).toBe(false);
    expect(
      needsBetaNotice({ ...prefs, acceptedNoticeVersion: "old-wording" }),
    ).toBe(true);
  });

  it("recognises Safari, alternative iOS browsers and an iPad with a desktop user agent", () => {
    expect(safariMode).toEqual({
      installed: false,
      ios: true,
      safari: true,
      device: "iPhone",
    });
    expect(
      detectRuntimeMode(
        safari.replace("Version/18.0", "CriOS/130.0"),
        "iPhone",
        5,
        false,
      ).safari,
    ).toBe(false);
    expect(
      detectRuntimeMode(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        "MacIntel",
        5,
        false,
      ).device,
    ).toBe("iPad");
    expect(detectRuntimeMode(safari, "iPhone", 5, false, true).installed).toBe(
      true,
    );
    expect(detectRuntimeMode(safari, "iPhone", 5, true).installed).toBe(true);
  });
});

describe("install guidance exposure", () => {
  it("appears initially, waits seven days after dismissal and never returns after opting out", () => {
    const prefs = betaPreferences([]);
    expect(shouldShowInstallBanner(prefs, safariMode, start.getTime())).toBe(
      true,
    );
    const dismissed = betaPreferences([
      ...installShownSettings(prefs, start),
      ...installDismissedSettings(prefs, false, start),
    ]);
    expect(
      shouldShowInstallBanner(
        dismissed,
        safariMode,
        start.getTime() + INSTALL_INTERVAL_MS - 1,
      ),
    ).toBe(false);
    expect(
      shouldShowInstallBanner(
        dismissed,
        safariMode,
        start.getTime() + INSTALL_INTERVAL_MS,
      ),
    ).toBe(true);
    expect(
      shouldShowInstallBanner(
        { ...dismissed, installNeverShow: true },
        safariMode,
        start.getTime() + 100 * INSTALL_INTERVAL_MS,
      ),
    ).toBe(false);
  });

  it("caps appearances at three even when visitors reload without dismissing", () => {
    const prefs = betaPreferences(
      installShownSettings(betaPreferences([]), start),
    );
    expect(
      shouldShowInstallBanner(prefs, safariMode, start.getTime() + 1),
    ).toBe(false);
    expect(
      shouldShowInstallBanner(
        { ...prefs, installShowCount: 3 },
        safariMode,
        start.getTime() + 100 * INSTALL_INTERVAL_MS,
      ),
    ).toBe(false);
  });

  it("waits another seven days after a second appearance even when the prior dismissal is older", () => {
    const nextAppearance = new Date(start.getTime() + INSTALL_INTERVAL_MS);
    const prefs = betaPreferences([
      { key: "installBannerShowCount", value: "2" },
      { key: "installBannerLastDismissedAt", value: start.toISOString() },
      { key: "installBannerLastShownAt", value: nextAppearance.toISOString() },
    ]);
    expect(
      shouldShowInstallBanner(prefs, safariMode, nextAppearance.getTime() + 1),
    ).toBe(false);
    expect(
      shouldShowInstallBanner(
        prefs,
        safariMode,
        nextAppearance.getTime() + INSTALL_INTERVAL_MS,
      ),
    ).toBe(true);
  });

  it("never appears in the installed app or on desktop", () => {
    expect(
      shouldShowInstallBanner(betaPreferences([]), {
        ...safariMode,
        installed: true,
      }),
    ).toBe(false);
    expect(
      shouldShowInstallBanner(betaPreferences([]), {
        ...safariMode,
        ios: false,
        device: "desktop",
      }),
    ).toBe(false);
  });
});

describe("data safety notices", () => {
  it("finds the original earliest real import, ignores demos and malformed dates, and preserves it after deletion", () => {
    const imports = [
      { importedAt: "2026-06-01T08:00:00Z", isDemo: true },
      { importedAt: "not-a-date" },
      { importedAt: "2026-09-12T18:00:00Z" },
      { importedAt: "2026-09-10T10:00:00Z" },
    ];
    expect(firstRealImportAt(imports)).toBe("2026-09-10T10:00:00.000Z");
    expect(firstRealImportAt([], "2026-09-10T10:00:00Z")).toBe(
      "2026-09-10T10:00:00.000Z",
    );
    expect(
      firstRealImportAt([{ importedAt: start.toISOString(), isDemo: true }]),
    ).toBeUndefined();
    expect(firstRealImportAt(imports, "2026-09-01T10:00:00Z")).toBe(
      "2026-09-01T10:00:00.000Z",
    );
  });
  it("separate storage notice is only for real imports in an unacknowledged Safari tab", () => {
    const prefs = betaPreferences([]);
    expect(needsSeparateStorageWarning(prefs, safariMode, true)).toBe(true);
    expect(needsSeparateStorageWarning(prefs, safariMode, false)).toBe(false);
    expect(
      needsSeparateStorageWarning(
        { ...prefs, separateStorageWarningSeen: true },
        safariMode,
        true,
      ),
    ).toBe(false);
    expect(
      needsSeparateStorageWarning(
        prefs,
        { ...safariMode, installed: true },
        true,
      ),
    ).toBe(false);
    expect(
      needsSeparateStorageWarning(
        prefs,
        { ...safariMode, safari: false },
        true,
      ),
    ).toBe(false);
  });

  it("reminds after seven days of the first real import only when no backup was exported", () => {
    const prefs = betaPreferences([
      { key: "firstRealImportAt", value: start.toISOString() },
    ]);
    expect(
      needsFirstBackupReminder(
        prefs,
        start.getTime() + INSTALL_INTERVAL_MS - 1,
      ),
    ).toBe(false);
    expect(
      needsFirstBackupReminder(prefs, start.getTime() + INSTALL_INTERVAL_MS),
    ).toBe(true);
    expect(
      needsFirstBackupReminder(
        { ...prefs, lastBackupAt: start.toISOString() },
        start.getTime() + 2 * INSTALL_INTERVAL_MS,
      ),
    ).toBe(false);
    expect(needsFirstBackupReminder(betaPreferences([]))).toBe(false);
  });

  it("requests persistence after checking if it was already granted, and survives unsupported or rejecting browsers", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    expect(
      await requestPersistentStorage({
        persisted: vi.fn().mockResolvedValue(true),
        persist,
      }),
    ).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(
      await requestPersistentStorage({
        persisted: vi.fn().mockResolvedValue(false),
        persist,
      }),
    ).toBe(true);
    expect(await requestPersistentStorage(undefined)).toBe(false);
    expect(
      await requestPersistentStorage({
        persisted: vi.fn().mockRejectedValue(new Error("blocked")),
        persist,
      }),
    ).toBe(false);
  });
});

describe("safe update policy", () => {
  it("allows update presentation only on idle Home and never during an open editor or sorting session", () => {
    expect(mayShowUpdate("/", false, false)).toBe(true);
    for (const route of [
      "/import",
      "/transactions",
      "/transactions/a",
      "/settings",
      "/analysis",
    ])
      expect(mayShowUpdate(route, false, false)).toBe(false);
    expect(mayShowUpdate("/", true, false)).toBe(false);
    expect(mayShowUpdate("/", false, true)).toBe(false);
  });

  it("shows What's new for an existing previous version, once, without a second fresh-visit welcome", () => {
    const prefs = betaPreferences([{ key: "lastSeenVersion", value: "2.0.0" }]);
    expect(needsWhatsNew(prefs, "2.2.0")).toBe(true);
    expect(needsWhatsNew({ ...prefs, lastSeenVersion: "2.2.0" }, "2.2.0")).toBe(
      false,
    );
    expect(needsWhatsNew(betaPreferences([]), "2.2.0")).toBe(false);
  });
});
