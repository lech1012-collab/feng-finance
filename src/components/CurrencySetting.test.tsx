import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CurrencySetting, CurrencyViewNotice } from "./CurrencySetting";
import { db, initializeDatabase } from "../storage/database";
import * as fx from "../analytics/fx";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.delete();
});

it("undoes reporting currency locally without changing the account currency", async () => {
  await db.accounts.put({
    id: "fictitious-account",
    institution: "Barclays",
    displayName: "Everyday",
    accountType: "current",
    currency: "GBP",
    maskedAccountIdentifier: "Fictitious",
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
  });
  const original = await db.accounts.get("fictitious-account");
  render(<CurrencySetting />);
  const selector = await screen.findByRole("combobox", {
    name: "Reporting currency",
  });
  const settingsBeforeHelp = await db.settings.toArray();
  expect(
    screen.queryByText(/Totals convert all accounts/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "About Currency and exchange rates" }),
  );
  expect(await screen.findByText(/Totals convert all accounts/)).toBeVisible();
  expect(screen.getByText(/No personal data is sent/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Close Currency and exchange rates" }),
  );
  expect(await db.settings.toArray()).toEqual(settingsBeforeHelp);
  expect(selector).toHaveValue("GBP");
  fireEvent.change(selector, { target: { value: "EUR" } });
  await screen.findByText("Reporting currency saved.");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(selector).toHaveValue("GBP"));
  expect(await db.accounts.get("fictitious-account")).toEqual(original);
});

it("offers Undo beside the rate-download preference and restores its original state", async () => {
  await db.settings.put({ key: "fx:download", value: "true" });
  render(<CurrencySetting />);
  const toggle = await screen.findByRole("switch", {
    name: "Download daily rates (ECB)",
  });
  await waitFor(() => expect(toggle).toBeChecked());
  fireEvent.click(toggle);
  await screen.findByText("Rate preference saved.");
  expect(
    screen.queryByRole("button", { name: "Update rates" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(toggle).toBeChecked());
  expect((await db.settings.get("fx:download"))?.value).toBe("true");
});

it("keeps the manual-rate form in a sheet and Undo restores the previous rate", async () => {
  const original = {
    id: "manual:2026-10-01:EUR:GBP",
    date: "2026-10-01",
    base: "EUR",
    quote: "GBP",
    rate: "0.8",
    source: "manual" as const,
  };
  await db.fxRates.put(original);
  render(<CurrencySetting />);
  expect(screen.queryByLabelText("1 EUR equals")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Enter a manual rate" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Enter a manual rate",
  });
  expect(dialog).toContainElement(screen.getByLabelText("Date"));
  expect(screen.getByLabelText("Date")).toHaveAttribute("lang", "en-GB");
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText("1 EUR equals"), {
    target: { value: "-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save manual rate" }));
  await screen.findByRole("alert");
  expect(await db.fxRates.get(original.id)).toEqual(original);
  fireEvent.change(screen.getByLabelText("1 EUR equals"), {
    target: { value: "0.85" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save manual rate" }));
  await screen.findByText("Manual rate saved.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect((await db.fxRates.get(original.id))?.rate).toBe("0.85");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect(await db.fxRates.get(original.id)).toEqual(original),
  );
});

it("undoes downloaded-rate changes together with the last-download metadata", async () => {
  const original = {
    id: "ecb:2026-10-01:GBP",
    date: "2026-10-01",
    base: "EUR",
    quote: "GBP",
    rate: "0.8",
    source: "ecb" as const,
  };
  await db.fxRates.put(original);
  await db.settings.put({
    key: "fx:lastDownloaded",
    value: "2026-10-01T12:00:00Z",
  });
  vi.spyOn(fx, "downloadEcbRates").mockResolvedValue([
    { ...original, rate: "0.85" },
  ]);
  render(<CurrencySetting />);
  fireEvent.click(await screen.findByRole("button", { name: "Update rates" }));
  await screen.findByText("Exchange rates updated.");
  expect((await db.fxRates.get(original.id))?.rate).toBe("0.85");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect(await db.fxRates.get(original.id)).toEqual(original),
  );
  expect((await db.settings.get("fx:lastDownloaded"))?.value).toBe(
    "2026-10-01T12:00:00Z",
  );
});

it("persists the selected reporting currency before the controlled input resets", async () => {
  render(
    <MemoryRouter>
      <CurrencySetting />
    </MemoryRouter>,
  );
  const selector = await screen.findByRole("combobox", {
    name: "Reporting currency",
  });
  fireEvent.change(selector, { target: { value: "EUR" } });
  await waitFor(async () =>
    expect((await db.settings.get("currency"))?.value).toBe("EUR"),
  );
  await waitFor(() => expect(selector).toHaveValue("EUR"));
  cleanup();
  render(
    <MemoryRouter>
      <CurrencySetting />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Reporting currency" }),
    ).toHaveValue("EUR"),
  );
});

it("responds immediately to disabling public rate downloads and preserves that preference", async () => {
  render(
    <MemoryRouter>
      <CurrencySetting />
    </MemoryRouter>,
  );
  const toggle = await screen.findByRole("switch", {
    name: "Download daily rates (ECB)",
  });
  await waitFor(() => expect(toggle).toBeChecked());
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  await waitFor(async () =>
    expect((await db.settings.get("fx:download"))?.value).toBe("false"),
  );
  cleanup();
  render(
    <MemoryRouter>
      <CurrencySetting />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("switch", { name: "Download daily rates (ECB)" }),
    ).not.toBeChecked(),
  );
});

it("keeps exact recovery read-only until the user requests exchange rates", async () => {
  await db.accounts.put({
    id: "fictitious-euro-account",
    institution: "Revolut",
    displayName: "Travel",
    accountType: "current",
    currency: "EUR",
    maskedAccountIdentifier: "Fictitious",
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const before = await db.settings.toArray();
  render(
    <MemoryRouter>
      <CurrencyViewNotice currency="GBP" allowAutomaticDownload={false} />
    </MemoryRouter>,
  );
  await screen.findByRole("link", {
    name: "Exchange rates needed. Open currency settings.",
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await db.fxRates.count()).toBe(0);
  expect(await db.settings.toArray()).toEqual(before);
});
