import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AppLock } from "./AppLock";
import { db } from "../storage/database";
import { enableAppLock } from "../security/app-lock";
import * as appSecurity from "../security/app-lock";
let visibility = "visible";
beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await db.settings.clear();
});
it("withholds financial content until configured PIN authentication succeeds", async () => {
  await enableAppLock("527391", 1);
  render(
    <AppLock>
      <p>Confidential financial balance</p>
    </AppLock>,
  );
  expect(screen.queryByText("Confidential financial balance")).toBeNull();
  const input = await screen.findByLabelText("6-digit app PIN");
  fireEvent.change(input, { target: { value: "527391" } });
  fireEvent.submit(input.closest("form")!);
  expect(
    await screen.findByText("Confidential financial balance"),
  ).toBeInTheDocument();
});
it("hides app-switcher content immediately and locks after the configured background interval", async () => {
  await enableAppLock("527391", 1);
  let clock = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  render(
    <AppLock>
      <p>Confidential financial balance</p>
    </AppLock>,
  );
  const input = await screen.findByLabelText("6-digit app PIN");
  fireEvent.change(input, { target: { value: "527391" } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByText("Confidential financial balance");
  act(() => {
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(
    screen.getByText("Confidential financial balance").parentElement,
  ).toHaveClass("feng-private-content-hidden");
  clock += 2 * 60_000;
  act(() => {
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() =>
    expect(screen.getByLabelText("6-digit app PIN")).toBeInTheDocument(),
  );
  expect(screen.queryByText("Confidential financial balance")).toBeNull();
});
it("ignores authentication completed after a background lock and allows a fresh attempt", async () => {
  await enableAppLock("527391", 1);
  let clock = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  let complete: (valid: boolean) => void = () => undefined;
  vi.spyOn(appSecurity, "verifyAppPin").mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      complete = resolve;
    }),
  );
  render(
    <AppLock>
      <p>Confidential financial balance</p>
    </AppLock>,
  );
  const input = await screen.findByLabelText("6-digit app PIN");
  fireEvent.change(input, { target: { value: "527391" } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getByRole("button", { name: "Unlocking…" })).toBeDisabled();
  act(() => {
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    clock += 2 * 60_000;
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(screen.getByLabelText("6-digit app PIN")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Unlock" })).toBeDisabled();
  await act(async () => {
    complete(true);
    await Promise.resolve();
  });
  expect(screen.queryByText("Confidential financial balance")).toBeNull();
  const freshInput = screen.getByLabelText("6-digit app PIN");
  fireEvent.change(freshInput, { target: { value: "527391" } });
  fireEvent.submit(freshInput.closest("form")!);
  expect(
    await screen.findByText("Confidential financial balance"),
  ).toBeInTheDocument();
});
