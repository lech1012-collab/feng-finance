import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { BackupCentre } from "./BackupCentre";
import { db, initializeDatabase } from "../storage/database";
import * as backupApi from "../storage/backup";
import { encryptBackup } from "../security/backup-encryption";
import { accounts, transaction } from "../tests/helpers";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.bulkPut(accounts);
  await db.transactions.put(
    transaction({
      id: "original",
      source: "manual",
      statementId: "",
      sourcePage: 0,
      merchant: "FICTITIOUS SHOP",
    }),
  );
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await db.delete();
});
const view = () =>
  render(
    <MemoryRouter>
      <BackupCentre />
    </MemoryRouter>,
  );
function file(payload: unknown, name: string) {
  const input = new File([JSON.stringify(payload)], name, {
    type: "application/json",
  });
  Object.defineProperty(input, "text", {
    value: () => Promise.resolve(JSON.stringify(payload)),
  });
  return input;
}

it("saves encrypted by default, requires a strong confirmed password and exports no readable financial text", async () => {
  const download = vi.spyOn(backupApi, "download").mockImplementation(() => {});
  view();
  fireEvent.click(screen.getByRole("button", { name: "Save backup" }));
  const sheet = await screen.findByRole("dialog", {
      name: "Save backup",
    }),
    ui = within(sheet);
  expect(
    ui.getByRole("switch", { name: /Protect with a password/ }),
  ).toBeChecked();
  expect(ui.getByRole("button", { name: "Save backup" })).toBeDisabled();
  fireEvent.change(ui.getByLabelText("Backup password", { exact: true }), {
    target: { value: "a strong synthetic password" },
  });
  fireEvent.change(ui.getByLabelText("Confirm backup password"), {
    target: { value: "a strong synthetic password" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save backup" }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  const [content, mime, name] = download.mock.calls[0];
  expect(mime).toBe("application/vnd.feng.backup+json");
  expect(name).toMatch(/\.feng$/);
  expect(String(content)).not.toContain("FICTITIOUS SHOP");
  expect(JSON.parse(String(content)).format).toBe("feng-encrypted-backup");
  await waitFor(async () =>
    expect((await db.settings.get("backup:lastExportCount"))?.value).toBe("1"),
  );
});

it("previews an old JSON backup without overwriting, cancels safely and replaces only after acknowledgement", async () => {
  const backup = await backupApi.createBackup();
  await db.transactions.put(
    transaction({
      id: "later",
      source: "manual",
      statementId: "",
      sourcePage: 0,
    }),
  );
  view();
  const picker = screen.getByLabelText("Choose Feng backup");
  fireEvent.change(picker, {
    target: { files: [file(backup, "legacy.json")] },
  });
  let sheet = await screen.findByRole("dialog", { name: "Restore backup" });
  expect(
    within(sheet).getByRole("button", { name: "Replace data with backup" }),
  ).toBeDisabled();
  expect(await db.transactions.count()).toBe(2);
  fireEvent.click(
    within(sheet).getByRole("button", { name: "Cancel restore" }),
  );
  expect(await db.transactions.count()).toBe(2);
  fireEvent.change(picker, {
    target: { files: [file(backup, "legacy.json")] },
  });
  sheet = await screen.findByRole("dialog", { name: "Restore backup" });
  fireEvent.click(
    within(sheet).getByRole("checkbox", { name: /I understand/ }),
  );
  fireEvent.click(
    within(sheet).getByRole("button", { name: "Replace data with backup" }),
  );
  await waitFor(async () => expect(await db.transactions.count()).toBe(1));
  expect(await db.transactions.get("original")).toBeDefined();
  expect(await db.transactions.get("later")).toBeUndefined();
});

it("accepts older encrypted backups with an eight-character password and keeps wrong-password attempts read-only", async () => {
  const backup = await backupApi.createBackup(),
    encrypted = await encryptBackup(backup, "old-pass");
  view();
  fireEvent.change(screen.getByLabelText("Choose Feng backup"), {
    target: { files: [file(encrypted, "old.feng")] },
  });
  const sheet = await screen.findByRole("dialog", { name: "Unlock backup" }),
    ui = within(sheet);
  fireEvent.change(ui.getByLabelText("Backup password", { exact: true }), {
    target: { value: "incorrect" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Unlock and preview" }));
  await screen.findByRole("alert");
  expect(await db.transactions.count()).toBe(1);
  expect(
    screen.queryByRole("dialog", { name: "Restore backup" }),
  ).not.toBeInTheDocument();
  fireEvent.change(ui.getByLabelText("Backup password", { exact: true }), {
    target: { value: "old-pass" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Unlock and preview" }));
  await screen.findByRole("dialog", { name: "Restore backup" });
  expect(await db.transactions.count()).toBe(1);
});
