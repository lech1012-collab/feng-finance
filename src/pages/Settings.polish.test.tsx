import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { db, initializeDatabase } from "../storage/database";
import Settings from "./Settings";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
});
afterEach(async () => {
  cleanup();
  await db.delete();
});

it("offers local Undo for the property-report preference", async () => {
  await db.settings.put({ key: "property-tax-report", value: "false" });
  render(
    <MemoryRouter initialEntries={["/settings?section=reports"]}>
      <Settings />
    </MemoryRouter>,
  );
  const toggle = await screen.findByRole("switch", {
    name: "Enable property tax summary",
  });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  await screen.findByText("Report preference saved.");
  expect((await db.settings.get("property-tax-report"))?.value).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect((await db.settings.get("property-tax-report"))?.value).toBe("false"),
  );
  await waitFor(() => expect(toggle).not.toBeChecked());
});
