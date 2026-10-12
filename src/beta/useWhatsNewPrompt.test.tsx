import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutLifecycle } from "./AboutLifecycle";
import { CURRENT_RELEASE } from "./release";
import { useSafeUpdateVisibility } from "./updates";
import { useWhatsNewPrompt } from "./useWhatsNewPrompt";
import { WhatsNew } from "./WhatsNew";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

function Journey({
  save,
  version = CURRENT_RELEASE.version,
}: {
  save: () => Promise<void>;
  version?: string;
}) {
  // The live-query snapshot deliberately remains stale after saving.
  const safe = useSafeUpdateVisibility("/", false);
  const prompt = useWhatsNewPrompt(safe, version, save);
  const [showAbout, setShowAbout] = useState(false);
  return (
    <>
      <p role="status">{safe ? "Home available" : "Dialog open"}</p>
      <button onClick={() => setShowAbout(true)}>Open About</button>
      {prompt.visible && (
        <WhatsNew
          release={{ ...CURRENT_RELEASE, version }}
          onClose={prompt.dismiss}
        />
      )}
      {showAbout && (
        <AboutLifecycle
          mode={{
            installed: true,
            ios: false,
            safari: false,
            device: "desktop",
          }}
          storagePersisted
          buildDate="2026-10-12"
          desktopInstall={{
            available: false,
            install: async () => {},
            busy: false,
            error: "",
          }}
          onRequestStorage={async () => {}}
        />
      )}
    </>
  );
}

describe("automatic release-notes acknowledgement", () => {
  it("stays dismissed when closing restores Home before preferences refresh, and shows a later version", async () => {
    let finishSave!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const page = render(<Journey save={save} version="2.2.0" />);
    await screen.findByRole("dialog", { name: "What's new in Feng" });
    await screen.findByText("Dialog open");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();

    await act(async () => finishSave());
    await screen.findByText("Home available");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Even a further stale snapshot cannot redisplay the acknowledged version.
    page.rerender(<Journey save={save} version="2.2.0" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    page.rerender(<Journey save={save} version="2.2.1" />);
    expect(
      await screen.findByRole("dialog", { name: "What's new in Feng" }),
    ).toHaveAttribute("open");
  });

  it("does not acknowledge a failed settings write and allows a successful retry", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("Storage unavailable"))
      .mockResolvedValue(undefined);
    render(<Journey save={save} />);
    await screen.findByText("Dialog open");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please try again.",
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Done" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByText("Home available");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("allows reopening What's new explicitly from About after automatic acknowledgement", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Journey save={save} />);
    await screen.findByText("Dialog open");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByText("Home available");
    fireEvent.click(screen.getByRole("button", { name: "Open About" }));
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(
      await screen.findByRole("dialog", { name: "What's new in Feng" }),
    ).toHaveAttribute("open");
    await screen.findByText("Dialog open");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByText("Home available");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).toHaveBeenCalledOnce();
  });
});
