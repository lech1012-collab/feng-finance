import type { FeedbackTechnicalContext, ReleaseConfiguration } from "./types";
import { formatLocalDateTime } from "../domain/dates";

export interface FeedbackRuntime {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
  screenWidth: number;
}

function version(ua: string, expression: RegExp): string {
  const match = expression.exec(ua);
  return match ? ` ${match[1].replaceAll("_", ".")}` : "";
}

/** Do not add raw user agents, location URLs, identifiers or finance to this object. */
export function feedbackContext(
  release: Pick<ReleaseConfiguration, "appVersion" | "buildDate">,
  runtime: FeedbackRuntime,
): FeedbackTechnicalContext {
  const ua = runtime.userAgent;
  const ipad =
    /iPad/i.test(ua) ||
    (runtime.platform === "MacIntel" && runtime.maxTouchPoints > 1);
  const iphone = /iPhone|iPod/i.test(ua);
  const ios = ipad || iphone;
  const android = /Android/i.test(ua);
  const operatingSystem = ios
    ? "iOS"
    : android
      ? `Android${version(ua, /Android ([\d.]+)/i)}`
      : /Windows/i.test(ua)
        ? `Windows${version(ua, /Windows NT ([\d.]+)/i)}`
        : /Macintosh|Mac OS X/i.test(ua)
          ? `macOS${version(ua, /Mac OS X ([\d_]+)/i)}`
          : /Linux/i.test(ua)
            ? "Linux"
            : "Other";
  const browser = /Edg(?:iOS|A)?\//i.test(ua)
    ? `Edge${version(ua, /Edg(?:iOS|A)?\/([\d.]+)/i)}`
    : /FxiOS\//i.test(ua)
      ? `Firefox${version(ua, /FxiOS\/([\d.]+)/i)}`
      : /Firefox\//i.test(ua)
        ? `Firefox${version(ua, /Firefox\/([\d.]+)/i)}`
        : /(?:Chrome|CriOS)\//i.test(ua)
          ? `Chrome${version(ua, /(?:Chrome|CriOS)\/([\d.]+)/i)}`
          : /Safari\//i.test(ua)
            ? `Safari${version(ua, /Version\/([\d.]+)/i)}`
            : "Other";
  return {
    appVersion: release.appVersion,
    buildDate: release.buildDate,
    deviceType: iphone
      ? "iphone"
      : ipad
        ? "ipad"
        : android || /Mobile/i.test(ua)
          ? "mobile"
          : "desktop",
    operatingSystem,
    browser,
    displayMode: runtime.standalone ? "installed" : "tab",
    screenWidth: Number.isFinite(runtime.screenWidth)
      ? Math.max(0, Math.round(runtime.screenWidth))
      : 0,
  };
}

export function browserFeedbackContext(
  release: Pick<ReleaseConfiguration, "appVersion" | "buildDate">,
): FeedbackTechnicalContext {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return feedbackContext(release, {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      iosNavigator.standalone === true,
    screenWidth: window.innerWidth,
  });
}

export function technicalContextText(
  context: FeedbackTechnicalContext,
): string {
  return [
    `Feng ${context.appVersion}`,
    `Build: ${formatLocalDateTime(context.buildDate)}`,
    `Device: ${context.deviceType === "iphone" ? "iPhone" : context.deviceType === "ipad" ? "iPad" : context.deviceType === "mobile" ? "Mobile" : "Desktop"}`,
    `OS: ${context.operatingSystem}`,
    `Browser: ${context.browser}`,
    `Mode: ${context.displayMode}`,
    `Screen width: ${context.screenWidth}px`,
  ].join("\n");
}

export interface FeedbackDestination {
  href: string;
  kind: "form" | "email";
  contextPrefilled: boolean;
}

/** Only fixed build configuration controls the destination. Runtime records never do. */
export function feedbackDestination(
  configuration: Pick<
    ReleaseConfiguration,
    "feedbackUrl" | "feedbackEmail" | "feedbackContextParameter"
  >,
  context: FeedbackTechnicalContext,
): FeedbackDestination | undefined {
  const technical = technicalContextText(context);
  if (configuration.feedbackUrl) {
    try {
      const url = new URL(configuration.feedbackUrl);
      if (url.protocol === "https:" && !url.username && !url.password) {
        const parameter = configuration.feedbackContextParameter?.trim();
        if (parameter && /^[a-zA-Z0-9_-]{1,120}$/.test(parameter)) {
          url.searchParams.set(parameter, technical);
          return { href: url.href, kind: "form", contextPrefilled: true };
        }
        return { href: url.href, kind: "form", contextPrefilled: false };
      }
    } catch {
      /* Invalid form configuration falls back to the configured email. */
    }
  }
  const email = configuration.feedbackEmail?.trim();
  if (
    email &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(
      email,
    )
  ) {
    const query = new URLSearchParams({
      subject: `Feng ${context.appVersion} beta feedback`,
      body: `What were you trying to do?\n\nWhat happened?\n\nWhich banks did you import?\n\nHow easy was the import (1 to 5)?\n\nAnything else?\n\nTechnical context\n${technical}`,
    });
    return {
      href: `mailto:${email}?${query}`,
      kind: "email",
      contextPrefilled: true,
    };
  }
  return undefined;
}
