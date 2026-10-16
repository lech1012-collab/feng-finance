import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SettingsNavigation } from "./SettingsNavigation";

afterEach(cleanup);

it("orders Settings groups according to the release layout and keeps advanced tools reachable", () => {
  render(
    <MemoryRouter>
      <SettingsNavigation />
    </MemoryRouter>,
  );
  const menu = screen.getByRole("navigation", { name: "Settings sections" });
  expect(
    within(menu)
      .getAllByRole("heading")
      .map((heading) => heading.textContent),
  ).toEqual([
    "Appearance",
    "Money",
    "Transfers",
    "Categorisation",
    "Reminders",
    "Security",
    "Backup and restore",
    "About and feedback",
    "Demo data",
    "Danger zone",
  ]);
  expect(
    within(menu).queryByRole("link", { name: "Accounts" }),
  ).not.toBeInTheDocument();
  expect(
    within(menu).queryByRole("link", { name: "Tags" }),
  ).not.toBeInTheDocument();
  const categorisation = screen.getByRole("region", { name: "Categorisation" });
  expect(
    within(categorisation)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual([
    "Categories",
    "Rules",
    "Import layouts",
    "Statement history",
    "Import diagnostics",
  ]);
  const backup = screen.getByRole("region", { name: "Backup and restore" });
  expect(
    within(backup)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Backup and restore", "Export", "Recent changes"]);
});
