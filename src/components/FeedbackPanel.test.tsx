import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportDiagnostics } from "../domain/models";
import { FeedbackPanel } from "./FeedbackPanel";

const configuration = {
  appVersion: "2.2.0",
  buildDate: "2026-10-11T12:00:00.000Z",
};
const secret = "PRIVATE-REAL-STATEMENT-DATA";
const diagnostic: ImportDiagnostics = {
  id: secret,
  createdAt: "2026-09-30T00:00:00Z",
  parserVersion: "2.2.0",
  method: "text",
  table: {
    columns: [
      {
        id: "description",
        x0: 20,
        x1: 400,
        alignment: "left",
        headerText: secret,
        inferredRole: "description",
      },
    ],
    pages: [{ page: 1, width: 595, height: 842, rotation: 0 }],
    rows: [
      {
        id: secret,
        kind: "transaction",
        rect: { page: 1, x: 20, y: 80, width: 380, height: 12 },
        cells: [
          {
            columnId: "description",
            text: secret,
            rect: { page: 1, x: 20, y: 80, width: 380, height: 12 },
            parseSource: "text",
          },
        ],
      },
    ],
  },
  rows: [],
  checks: {
    policy: "exact-v2.2",
    reconciliation: { status: "unavailable" },
    calculatedMoneyIn: 123456789,
    calculatedMoneyOut: 123456789,
    balanceRowsPassed: 0,
    balanceRowsFailed: 0,
    totalCheckedRows: 0,
    needsReviewRows: 1,
    unreadPages: [],
    evidence: [],
    reconciledExactly: false,
  },
};
const writeText = vi.fn<(value: string) => Promise<void>>();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("feedback consent and private context", () => {
  it("shows the real-figures warning before a configured form can open and prefills only context", () => {
    render(
      <FeedbackPanel
        configuration={{
          ...configuration,
          feedbackUrl: "https://forms.office.com/r/synthetic",
          feedbackContextParameter: "rVersionDevice",
        }}
        diagnostics={[diagnostic]}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(screen.getByRole("dialog", { name: "Send feedback" })).toBeVisible();
    expect(
      screen.getByText(
        "Please don't send real statements or screenshots showing real figures.",
      ),
    ).toBeVisible();
    const link = screen.getByRole("link", { name: "Open feedback form" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.searchParams.get("rVersionDevice")).toContain("Feng 2.2.0");
    expect(url.href).not.toContain(secret);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(writeText).not.toHaveBeenCalled();
  });
  it("only includes diagnostics after opt-in and copies placeholders before opening feedback", async () => {
    render(
      <FeedbackPanel
        configuration={{
          ...configuration,
          feedbackUrl: "https://forms.office.com/r/synthetic",
          feedbackContextParameter: "rContext",
        }}
        diagnostics={[diagnostic]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    const checkbox = screen.getByRole("checkbox", {
      name: /Include diagnostics/,
    });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(
      screen.queryByRole("link", { name: "Open feedback form" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy details and diagnostics" }),
    );
    await screen.findByText(
      /Technical details and redacted diagnostics copied/,
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("feng-redacted-import-diagnostics-bundle");
    expect(copied).toContain("[text]");
    expect(copied).not.toContain(secret);
    expect(copied).not.toContain("123456789");
    expect(
      screen.getByRole("link", { name: "Open feedback form" }),
    ).toBeVisible();
  });
  it("provides an honest paste fallback when a form has no actual prefill parameter", async () => {
    render(
      <FeedbackPanel
        configuration={{
          ...configuration,
          feedbackUrl: "https://forms.office.com/r/synthetic",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(
      screen.getByText(/The form has no configured pre-fill field/),
    ).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    writeText.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy technical details" }),
    );
    await screen.findByRole("alert");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Technical details to copy",
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("Feng 2.2.0");
    expect(
      screen.getByRole("link", { name: "Open feedback form" }),
    ).toBeVisible();
  });
  it("does not invent a destination when feedback is not configured and restores focus", async () => {
    render(<FeedbackPanel configuration={configuration} />);
    const opener = screen.getByRole("button", { name: "Send feedback" });
    opener.focus();
    fireEvent.click(opener);
    expect(
      screen.getByText(
        /A feedback form or email address has not been configured/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy technical details" }),
    );
    await screen.findByText(/Technical details copied/);
    expect(writeText.mock.calls[0][0]).not.toContain("Mozilla");
    fireEvent.click(screen.getByRole("button", { name: "Close feedback" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
