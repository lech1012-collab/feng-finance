import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { db, initializeDatabase } from "../storage/database";
import { accounts, transaction } from "../tests/helpers";
import { TagManager, TagPicker, BulkTagPicker } from "./TagManager";
import { ToastProvider } from "./Toast";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await initializeDatabase();
  await db.accounts.bulkPut(accounts);
});
afterEach(async () => {
  cleanup();
  await db.delete();
});

it("shows tags as objects first and creates a tag only after the sheet is saved", async () => {
  render(
    <ToastProvider>
      <TagManager />
    </ToastProvider>,
  );
  expect(
    screen.queryByRole("textbox", { name: "Tag name" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
  const sheet = await screen.findByRole("dialog", { name: "Add tag" });
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Tag name" }), {
    target: { value: "Lisbon trip" },
  });
  expect(await db.tags.count()).toBe(0);
  fireEvent.click(within(sheet).getByRole("button", { name: "Create tag" }));
  await waitFor(async () =>
    expect((await db.tags.toArray())[0]?.name).toBe("Lisbon trip"),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () => expect(await db.tags.count()).toBe(0));
});

it("archives a tag reversibly from its edit sheet and leaves transaction references intact", async () => {
  await db.tags.put({
    id: "trip",
    name: "Lisbon trip",
    colour: "#A99BD6",
    archived: false,
  });
  await db.transactions.put(transaction({ tags: ["trip"] }));
  render(
    <ToastProvider>
      <TagManager />
    </ToastProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Lisbon trip" }));
  const sheet = await screen.findByRole("dialog", { name: "Edit tag" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Archive tag" }));
  await waitFor(async () =>
    expect((await db.tags.get("trip"))?.archived).toBe(true),
  );
  expect((await db.transactions.get("t1"))?.tags).toEqual(["trip"]);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect((await db.tags.get("trip"))?.archived).toBe(false),
  );
});

it("keeps selected tag names accessible without announcing decorative ticks", async () => {
  await db.tags.put({
    id: "trip",
    name: "Lisbon trip",
    colour: "#A99BD6",
    archived: false,
  });
  render(<TagPicker value={["trip"]} onChange={() => undefined} />);
  const choice = await screen.findByRole("checkbox", { name: "Lisbon trip" });
  expect(choice).toBeChecked();
  expect(choice.closest("label")).toHaveTextContent("✓");
  expect(choice).toHaveAccessibleName("Lisbon trip");
});

it("opens bulk tagging in a sheet and undoes only the tag change", async () => {
  await db.tags.put({
    id: "trip",
    name: "Lisbon trip",
    colour: "#A99BD6",
    archived: false,
  });
  await db.transactions.put(transaction({ tags: [] }));
  render(
    <ToastProvider>
      <BulkTagPicker transactionIds={["t1"]} />
    </ToastProvider>,
  );
  expect(
    screen.queryByRole("checkbox", { name: "Lisbon trip" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tag 1 transaction" }));
  const sheet = await screen.findByRole("dialog", {
    name: "Tag selected transactions",
  });
  fireEvent.click(
    await within(sheet).findByRole("checkbox", { name: "Lisbon trip" }),
  );
  fireEvent.click(
    within(sheet).getByRole("button", { name: "Tag 1 transaction" }),
  );
  await waitFor(async () =>
    expect((await db.transactions.get("t1"))?.tags).toEqual(["trip"]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(async () =>
    expect((await db.transactions.get("t1"))?.tags).toEqual([]),
  );
  expect((await db.transactions.get("t1"))?.amount).toBe(-1000);
});
