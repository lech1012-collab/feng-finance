import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { db } from "../storage/database";
import { PeriodSetting } from "./PeriodSetting";
beforeEach(async () => {
  await db.settings.clear();
  await db.monthCloses.clear();
  await db.changeLog.clear();
  await db.monthCloses.add({
    month: "2026-08",
    currency: "GBP",
    closedAt: "2026-10-08T00:00:00.000Z",
    snapshot: {
      income: 0,
      expenses: 4000,
      net: -4000,
      transactionCount: 1,
      categoryTotals: { shopping: 4000 },
    },
  });
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await db.settings.clear();
  await db.monthCloses.clear();
  await db.changeLog.clear();
});
it("cancel leaves closed months and period unchanged; confirming and Undo restores both", async () => {
  const before = await db.monthCloses.toArray();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<PeriodSetting />);
  const select = await screen.findByLabelText("Starts on");
  fireEvent.change(select, { target: { value: "fixed" } });
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  await waitFor(() => expect(select).not.toBeDisabled());
  expect(await db.monthCloses.toArray()).toEqual(before);
  expect(await db.settings.get("period:start")).toBeUndefined();
  confirm.mockReturnValue(true);
  fireEvent.change(select, { target: { value: "fixed" } });
  expect(
    await screen.findByText("Month preference saved. 1 month reopened."),
  ).toBeInTheDocument();
  expect(await db.monthCloses.count()).toBe(0);
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect(await db.settings.get("period:start")).toBeUndefined(),
  );
  expect(await db.monthCloses.toArray()).toEqual(before);
  expect(await db.settings.get("period:start")).toBeUndefined();
});

it("undoes the automatic month-close switch locally without changing closed snapshots", async () => {
  const before = await db.monthCloses.toArray();
  await db.settings.put({ key: "review:autoClose", value: "true" });
  render(<PeriodSetting />);
  const toggle = await screen.findByRole("switch", {
    name: "Automatically close complete, reviewed months after 60 days",
  });
  await waitFor(() => expect(toggle).toBeChecked());
  fireEvent.click(toggle);
  await screen.findByText("Automatic month close preference saved.");
  expect((await db.settings.get("review:autoClose"))?.value).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect((await db.settings.get("review:autoClose"))?.value).toBe("true"),
  );
  expect(await db.monthCloses.toArray()).toEqual(before);
});
