import { describe, expect, it } from "vitest";
import {
  feedbackContext,
  feedbackDestination,
  technicalContextText,
} from "./feedback";

const release = { appVersion: "2.2.0", buildDate: "2026-10-11T12:00:00.000Z" };
const runtime = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
  standalone: false,
  screenWidth: 390,
};
describe("private beta feedback", () => {
  it("includes only allowlisted technical context and detects iPhone Safari", () => {
    const context = feedbackContext(release, runtime);
    expect(context).toEqual({
      ...release,
      deviceType: "iphone",
      operatingSystem: "iOS",
      browser: "Safari 18.6",
      displayMode: "tab",
      screenWidth: 390,
    });
    expect(JSON.stringify(context)).not.toContain("Mozilla");
    expect(technicalContextText(context)).not.toContain("https://");
  });
  it("detects desktop-mode iPad and iOS Chrome without calling it Safari", () => {
    expect(
      feedbackContext(release, {
        ...runtime,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.6 Safari/605.1",
        platform: "MacIntel",
        standalone: true,
      }).deviceType,
    ).toBe("ipad");
    const context = feedbackContext(release, {
      ...runtime,
      userAgent: runtime.userAgent.replace("Version/18.6", "CriOS/142.0.0.0"),
    });
    expect(context.browser).toBe("Chrome 142.0.0.0");
  });
  it("prefills only the owner's actual configured form question", () => {
    const context = feedbackContext(release, runtime);
    const target = feedbackDestination(
      {
        feedbackUrl:
          "https://forms.office.com/Pages/ResponsePage.aspx?id=synthetic",
        feedbackContextParameter: "r123456",
      },
      context,
    );
    expect(target?.contextPrefilled).toBe(true);
    expect(new URL(target!.href).searchParams.get("r123456")).toBe(
      technicalContextText(context),
    );
    expect(new URL(target!.href).searchParams.get("id")).toBe("synthetic");
  });
  it("does not pretend an unknown Forms field is prefilled", () => {
    const context = feedbackContext(release, runtime);
    const target = feedbackDestination(
      { feedbackUrl: "https://forms.office.com/r/synthetic" },
      context,
    );
    expect(target).toEqual({
      kind: "form",
      contextPrefilled: false,
      href: "https://forms.office.com/r/synthetic",
    });
  });
  it("rejects script/http/credential URLs and falls back to a safe mailto", () => {
    const context = feedbackContext(release, runtime);
    for (const feedbackUrl of [
      "javascript:alert(1)",
      "http://forms.office.com/",
      "https://user:password@forms.office.com/",
    ]) {
      const destination = feedbackDestination(
        { feedbackUrl, feedbackEmail: "beta@example.test" },
        context,
      );
      expect(destination?.kind).toBe("email");
      const params = new URLSearchParams(destination!.href.split("?")[1]);
      expect(params.get("body")).toContain(technicalContextText(context));
      expect(params.get("body")).not.toContain(runtime.userAgent);
    }
    expect(
      feedbackDestination(
        { feedbackEmail: "beta@example.test\nBcc:other@example.test" },
        context,
      ),
    ).toBeUndefined();
    expect(feedbackDestination({}, context)).toBeUndefined();
  });
});
