import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImportTransferReview } from "./ImportTransferReview";
import { accounts, transaction } from "../tests/helpers";
import type { ImportTransferPreview } from "../import/transfer-review";
afterEach(cleanup);

function preview(automatic = false, conflict = false): ImportTransferPreview {
  return {
    mode: automatic ? "automatic" : "manual",
    accounts,
    transactions: [
      transaction({ id: "debit", accountId: "a1", amount: -1000 }),
      transaction({ id: "credit", accountId: "a2", amount: 1000 }),
      transaction({ id: "other", accountId: "a3", amount: 1000 }),
    ],
    proposals: [
      {
        id: "pair",
        debitTxId: "debit",
        creditTxId: "credit",
        score: 100,
        status: "pending",
      },
      ...(conflict
        ? [
            {
              id: "other-pair",
              debitTxId: "debit",
              creditTxId: "other",
              score: 90,
              status: "pending" as const,
            },
          ]
        : []),
    ],
    automaticProposalIds: automatic ? ["pair"] : [],
  };
}
function show(
  value = preview(),
  selectedIds: string[] = [],
  rejectedAutomaticIds: string[] = [],
) {
  const onChange = vi.fn(),
    onRejectedAutomaticChange = vi.fn();
  const result = render(
    <ImportTransferReview
      preview={value}
      selectedIds={selectedIds}
      rejectedAutomaticIds={rejectedAutomaticIds}
      onChange={onChange}
      onRejectedAutomaticChange={onRejectedAutomaticChange}
      busy={false}
    />,
  );
  return { ...result, onChange, onRejectedAutomaticChange };
}
it("starts optional transfer choices collapsed and defers them without mutation", () => {
  const { container, onChange, onRejectedAutomaticChange } = show();
  expect(container.querySelector("details")).not.toHaveAttribute("open");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  expect(onRejectedAutomaticChange).not.toHaveBeenCalled();
});
it("links only the selected manual pair and retains competing-match protection", () => {
  const { container, onChange } = show(preview(false, true), ["other-pair"]);
  fireEvent.click(container.querySelector("summary")!);
  expect(
    screen.getByRole("button", { name: "Link Barclays to Revolut £10.00" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Leave unlinked Barclays to American Express £10.00",
    }),
  );
  expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
});
it("keeps automatic preference decisions in the rejected-automatic list", () => {
  const { container, onChange, onRejectedAutomaticChange } = show(
    preview(true),
  );
  fireEvent.click(container.querySelector("summary")!);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Leave unlinked Barclays to Revolut £10.00",
    }),
  );
  expect(onRejectedAutomaticChange).toHaveBeenCalledExactlyOnceWith(["pair"]);
  expect(onChange).not.toHaveBeenCalled();
});
it("can explicitly restore a deferred automatic pair", () => {
  const { container, onRejectedAutomaticChange } = show(
    preview(true),
    [],
    ["pair"],
  );
  fireEvent.click(container.querySelector("summary")!);
  fireEvent.click(
    screen.getByRole("button", { name: "Link Barclays to Revolut £10.00" }),
  );
  expect(onRejectedAutomaticChange).toHaveBeenCalledExactlyOnceWith([]);
});
