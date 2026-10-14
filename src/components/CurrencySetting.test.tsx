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

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await db.delete();
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
