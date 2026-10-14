import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "../storage/database";
import { ThemeSetting, ThemeSync } from "./Theme";

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await db.delete();
});

it("uses System for a missing preference and offers local Undo after changing appearance", async () => {
  render(<ThemeSetting />);
  expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Light" }));
  await screen.findByText("Appearance saved.");
  expect((await db.settings.get("theme"))?.value).toBe("light");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect(await db.settings.get("theme")).toBeUndefined(),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
});

it("follows the system for an unset theme without replacing explicit light or dark preferences", async () => {
  const media = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  document.documentElement.dataset.theme = "dark";
  render(<ThemeSync />);
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("light"),
  );
  expect(await db.settings.get("theme")).toBeUndefined();
  expect(localStorage.getItem("feng-theme-preference")).toBe("system");
  expect(media.addEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );
  await db.settings.put({ key: "theme", value: "dark" });
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("dark"),
  );
  expect((await db.settings.get("theme"))?.value).toBe("dark");
  expect(localStorage.getItem("feng-theme-preference")).toBe("dark");
  await db.settings.put({ key: "theme", value: "light" });
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("light"),
  );
  expect((await db.settings.get("theme"))?.value).toBe("light");
  expect(localStorage.getItem("feng-theme-preference")).toBe("light");
});

it("restores the previous system preference instead of forcing a default", async () => {
  await db.settings.put({ key: "theme", value: "system" });
  render(<ThemeSetting />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Light" }));
  await screen.findByText("Appearance saved.");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect((await db.settings.get("theme"))?.value).toBe("system"),
  );
});
