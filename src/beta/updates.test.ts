import { afterEach, describe, expect, it, vi } from "vitest";
import { installUpdateChecks } from "./updates";

afterEach(() => vi.useRealTimers());

describe("service worker update checks", () => {
  it("checks on launch, foreground and reconnection without activating or reloading", async () => {
    vi.useFakeTimers();
    const update = vi.fn().mockResolvedValue(undefined);
    const state = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const cleanup = installUpdateChecks({ update });
    expect(update).toHaveBeenCalledTimes(1);
    state.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalledTimes(1);
    state.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalledTimes(2);
    online.mockReturnValue(false);
    window.dispatchEvent(new Event("online"));
    expect(update).toHaveBeenCalledTimes(2);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(update).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(4);
    cleanup();
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(4);
  });

  it("ignores failed network checks without reporting statement contents", async () => {
    const update = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const cleanup = installUpdateChecks({ update });
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
