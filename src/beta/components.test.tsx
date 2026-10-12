import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { BetaNotice } from "./BetaNotice";
import { InstallBanner, InstallHelp } from "./InstallGuidance";
import { DataNotices } from "./DataNotices";
import { betaPreferences, type RuntimeMode } from "./policy";
import { useDesktopInstall } from "./useDesktopInstall";
import { useSafeUpdateVisibility } from "./updates";
import { WhatsNew } from "./WhatsNew";
import { CURRENT_RELEASE } from "./release";

const mode: RuntimeMode = {
  installed: false,
  ios: true,
  safari: true,
  device: "iPhone",
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

describe("beta lifecycle components", () => {
  it("presents four plain notices and retains the modal until an acknowledgement succeeds", async () => {
    const accept = vi.fn().mockRejectedValue(new Error("storage blocked"));
    render(<BetaNotice onAccept={accept} />);
    const dialog = screen.getByRole("dialog", { name: "Welcome to Feng" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("Not financial advice.")).toBeVisible();
    expect(
      screen.getByText("Start with demo data to explore safely."),
    ).toBeVisible();
    const cancelled = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancelled);
    expect(cancelled.defaultPrevented).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Import my statements" }),
    );
    expect(accept).toHaveBeenCalledWith("import");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your data has not been cleared",
    );
    expect(dialog).toHaveAttribute("open");
  });

  it("records an install appearance once and persists permanent dismissal", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <InstallBanner prefs={betaPreferences([])} mode={mode} onSave={save} />,
    );
    expect(
      await screen.findByRole("region", { name: "Install Feng" }),
    ).toBeVisible();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContainEqual({
      key: "installBannerShowCount",
      value: "1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Don't show again" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Install Feng" })).toBeNull(),
    );
    expect(save.mock.calls[1][0]).toContainEqual({
      key: "installBannerNeverShow",
      value: "true",
    });
  });

  it("does not mark the separate-storage warning seen when backup preparation fails", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <DataNotices
        prefs={betaPreferences([])}
        mode={mode}
        hasRealImports
        onBackup={vi.fn().mockRejectedValue(new Error("disk full"))}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "existing data is safe",
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("marks separate storage acknowledged only after a successful backup", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const backup = vi.fn().mockResolvedValue(undefined);
    render(
      <DataNotices
        prefs={betaPreferences([])}
        mode={mode}
        hasRealImports
        onBackup={backup}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save backup" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([
        { key: "separateStorageWarningSeen", value: "true" },
      ]),
    );
    expect(backup).toHaveBeenCalledOnce();
    expect(backup.mock.invocationCallOrder[0]).toBeLessThan(
      save.mock.invocationCallOrder[0],
    );
  });

  it("offers actionable Safari guidance when copying is unavailable", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    render(<InstallHelp mode={{ ...mode, safari: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Copy the address from your browser and open it in Safari.",
    );
    vi.unstubAllGlobals();
  });

  it("keeps What's new open when read acknowledgement cannot be saved", async () => {
    const close = vi.fn().mockRejectedValue(new Error("Storage unavailable"));
    render(<WhatsNew release={CURRENT_RELEASE} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please try again.",
    );
    expect(
      screen.getByRole("dialog", { name: "What's new in Feng" }),
    ).toHaveAttribute("open");
  });

  it("retains desktop installation prompt in the shell until the user explicitly installs", async () => {
    const hook = renderHook(useDesktopInstall);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt,
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      },
    );
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(hook.result.current.available).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    await act(() => hook.result.current.install());
    expect(prompt).toHaveBeenCalledOnce();
    expect(hook.result.current.available).toBe(false);
  });

  it("suppresses update visibility while a Home dialog is open, then restores it after close", async () => {
    const hook = renderHook(() => useSafeUpdateVisibility("/", false));
    expect(hook.result.current).toBe(true);
    const dialog = document.createElement("dialog");
    document.body.appendChild(dialog);
    dialog.setAttribute("open", "");
    await waitFor(() => expect(hook.result.current).toBe(false));
    dialog.remove();
    await waitFor(() => expect(hook.result.current).toBe(true));
  });
});
import "@testing-library/jest-dom/vitest";
