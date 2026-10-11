import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CurrencySetting } from "./CurrencySetting";
import { db, initializeDatabase } from "../storage/database";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
});
afterEach(async () => {
  cleanup();
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
  const toggle = await screen.findByRole("checkbox", {
    name: "Download public ECB rates",
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
      screen.getByRole("checkbox", { name: "Download public ECB rates" }),
    ).not.toBeChecked(),
  );
});
