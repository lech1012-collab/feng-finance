import { settingsSection } from "./flows";
import { test as base, expect, devices, type Page } from "@playwright/test";
import { rm } from "node:fs/promises";
import { acknowledgeBeta } from "./fixtures";

const test = base.extend<{ migrationPage: Page }>({
  migrationPage: async (
    { browserName, playwright, contextOptions, page },
    use,
    testInfo,
  ) => {
    if (browserName !== "webkit") {
      await use(page);
      return;
    }
    // Native Blob persistence is unavailable in Linux WebKit's ephemeral
    // profiles. A separate persistent profile models installed Safari storage.
    const { defaultBrowserType: _browserType, ...iphone } =
      devices["iPhone 13"];
    const profile = testInfo.outputPath("webkit-migration-profile");
    const context = await playwright.webkit.launchPersistentContext(profile, {
      ...iphone,
      ...contextOptions,
      viewport: testInfo.project.use.viewport ?? iphone.viewport,
    });
    try {
      await use(context.pages()[0] ?? (await context.newPage()));
    } finally {
      try {
        await context.close();
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    }
  },
});

const schema1 = {
  accounts: "id,institution,currency",
  statements:
    "id,accountId,sourceFileHash,statementPeriodEnd,[accountId+statementPeriodStart+statementPeriodEnd]",
  transactions:
    "id,date,accountId,statementId,categoryId,transactionFingerprint,[currency+date],[accountId+date]",
  categories: "id,parentId",
  rules: "id,priority",
  transferLinks: "id",
  settings: "key",
};
const schema3 = {
  accounts: "id,institution,currency,accountType,tracking",
  transactions:
    "id,date,accountId,statementId,categoryId,transactionFingerprint,[currency+date],[accountId+date],merchant,parentId,kind,source,*tags",
  valuations: "id,accountId,date,[accountId+date]",
  pots: "id,type,linkedAccountId,linkedCategoryId",
  budgets: "id,month,categoryId,[currency+month],[categoryId+month]",
  tags: "id,name",
  recurringSeries: "id,accountId,nextDue,status,matchKey",
  monthCloses: "month,closedAt",
  attachments: "id,transactionId",
  fxRates: "id,date,[base+quote+date]",
  transferProposals: "id,debitTxId,creditTxId,status",
  savedViews: "id,name",
  savedReports: "id,name",
  scenarios: "id,createdAt",
  changeLog: "id,createdAt,undoneAt",
};

async function rawRecords(page: Page, safety = false) {
  return page.evaluate(async (includeSafety) => {
    const request = indexedDB.open("feng-finance");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Synthetic database failed."));
    });
    const names = Array.from(database.objectStoreNames).filter(
      (name) => includeSafety || name !== "safetyBackups",
    );
    const transaction = database.transaction(names, "readonly");
    const entries = await Promise.all(
      names.map(
        (name) =>
          new Promise<[string, unknown[]]>((resolve, reject) => {
            const rows: unknown[] = [];
            const read = transaction.objectStore(name).openCursor();
            read.onerror = () => reject(new Error("Synthetic read failed."));
            read.onsuccess = () => {
              const cursor = read.result;
              if (!cursor) return resolve([name, rows]);
              rows.push({
                key: cursor.primaryKey,
                value: cursor.value as unknown,
              });
              cursor.continue();
            };
          }),
      ),
    );
    database.close();
    async function canonical(value: unknown): Promise<unknown> {
      if (value === undefined) return { type: "undefined" };
      if (value instanceof Blob)
        return { type: "Blob", mime: value.type, text: await value.text() };
      if (value instanceof Date)
        return { type: "Date", iso: value.toISOString() };
      if (value instanceof Uint8Array)
        return { type: "Uint8Array", bytes: Array.from(value) };
      if (value instanceof Map)
        return { type: "Map", entries: await canonical(Array.from(value)) };
      if (Array.isArray(value)) return Promise.all(value.map(canonical));
      if (value && typeof value === "object")
        return Object.fromEntries(
          await Promise.all(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(async ([key, item]) => [key, await canonical(item)]),
          ),
        );
      return value;
    }
    return Object.fromEntries(
      await Promise.all(
        entries.map(async ([name, rows]) => [name, await canonical(rows)]),
      ),
    );
  }, safety);
}

async function seedOldSchema(page: Page, version: 1 | 2 | 3) {
  await page.goto("/manifest.webmanifest");
  const schema: Record<string, string> = {
    ...schema1,
    ...(version >= 2
      ? { transactions: schema1.transactions + ",merchant" }
      : {}),
    ...(version >= 3 ? schema3 : {}),
  };
  await page.evaluate(
    async ({ schema, version }) => {
      const salt = new Uint8Array(16).fill(7);
      const material = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode("628391"),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      const digest = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600000 },
          material,
          256,
        ),
      );
      const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
      const request = indexedDB.open("feng-finance", version * 10);
      request.onupgradeneeded = () => {
        for (const [name, definition] of Object.entries(schema)) {
          const [primaryKey, ...indexes] = definition.split(",");
          const store = request.result.createObjectStore(name, {
            keyPath: primaryKey,
          });
          for (const index of indexes) {
            const multiEntry = index.startsWith("*");
            const indexName = multiEntry ? index.slice(1) : index;
            const keyPath = indexName.startsWith("[")
              ? indexName.slice(1, -1).split("+")
              : indexName;
            store.createIndex(indexName, keyPath, { multiEntry });
          }
        }
      };
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(new Error("Synthetic old schema failed."));
      });
      const transaction = database.transaction(
        Object.keys(schema),
        "readwrite",
      );
      const timestamp = "2026-10-01T12:00:00.000Z";
      transaction.objectStore("accounts").put({
        id: "synthetic-account",
        institution: "Other",
        displayName: "Synthetic account",
        accountType: "current",
        currency: "GBP",
        maskedAccountIdentifier: "•••• 0001",
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(version >= 3
          ? { tracking: "statement", includeInNetWorth: true }
          : {}),
      });
      transaction.objectStore("statements").put({
        id: "synthetic-statement",
        institution: "Other",
        accountId: "synthetic-account",
        statementPeriodStart: "2026-09-01",
        statementPeriodEnd: "2026-09-30",
        openingBalance: 10000,
        closingBalance: 9750,
        currency: "GBP",
        sourceFilename: "synthetic-statement.pdf",
        sourceFileHash: "synthetic-file-hash",
        importedAt: timestamp,
        parserVersion: "1.9.2",
        extractionMethod: "embedded-text",
        validationStatus: "reconciled",
        validationDifference: 0,
        transactionCount: 1,
        warnings: [],
      });
      transaction.objectStore("transactions").put({
        id: "synthetic-payment",
        accountId: "synthetic-account",
        statementId: "synthetic-statement",
        date: "2026-09-20",
        description: "SYNTHETIC PAYMENT",
        merchant: "SYNTHETIC PAYMENT",
        amount: -250,
        currency: "GBP",
        balanceAfterTransaction: 9750,
        type: "expense",
        categoryId: "custom",
        sourcePage: 1,
        extractionConfidence: 1,
        transactionFingerprint: "synthetic-payment-hash",
        isTransfer: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        originalUndefined: undefined,
        originalMap: new Map([["synthetic-key", new Date(timestamp)]]),
        originalBytes: new Uint8Array([3, 1, 4]),
        ...(version >= 2 ? { tags: [], occurrence: 0, isReviewed: false } : {}),
        ...(version >= 3
          ? {
              kind: "normal",
              source: "pdf",
              attachmentIds: ["synthetic-receipt"],
            }
          : {}),
      });
      transaction.objectStore("categories").put({
        id: "custom",
        name: "Synthetic category",
        kind: "expense",
        archived: false,
        color: "#ffffff",
      });
      for (const setting of [
        { key: "initialized", value: "true" },
        { key: "fxSource", value: "manual" },
        { key: "security:pinSalt", value: base64(salt) },
        { key: "security:pinHash", value: base64(digest) },
        { key: "security:enabled", value: "true" },
        { key: "security:delay", value: "1" },
        { key: "security:attempts", value: "0" },
        { key: "security:retryAt", value: "0" },
        { key: "security:credential", value: "synthetic-original-credential" },
        { key: "transferMatching", value: "automatic" },
      ])
        transaction.objectStore("settings").put(setting);
      if (version >= 3)
        transaction.objectStore("attachments").put({
          id: "synthetic-receipt",
          transactionId: "synthetic-payment",
          mime: "image/png",
          sizeBytes: 23,
          name: "synthetic-receipt.png",
          blob: new Blob(["synthetic local receipt"], { type: "image/png" }),
        });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(new Error("Synthetic records failed."));
      });
      database.close();
    },
    { schema, version },
  );
}

for (const version of [1, 2, 3] as const) {
  test(`old schema ${version} captures raw values before defaults and restores original PIN and receipt`, async ({
    migrationPage: page,
  }) => {
    test.setTimeout(90000);
    await seedOldSchema(page, version);
    const original = await rawRecords(page);
    await settingsSection(page, "backup");
    await expect(
      page.getByLabel("6-digit app PIN", { exact: true }),
    ).toBeVisible();
    const initial = await rawRecords(page, true);
    const safety = initial.safetyBackups as {
      key: string;
      value: {
        sourceNativeVersion: number;
        targetNativeVersion: number;
        tables: { name: string; rows: unknown[] }[];
      };
    }[];
    const snapshot = safety.find((row) => row.key === "latest")!.value;
    expect(snapshot.sourceNativeVersion).toBe(version * 10);
    expect(snapshot.targetNativeVersion).toBe(40);
    expect(
      Object.fromEntries(
        snapshot.tables.map((table) => [table.name, table.rows]),
      ),
    ).toEqual(original);
    await page.getByLabel("6-digit app PIN", { exact: true }).fill("628391");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Welcome to Feng" }),
    ).toBeVisible();
    await acknowledgeBeta(page);
    await expect(
      page.getByRole("heading", {
        name: "Backup and restore",
        level: 1,
        exact: true,
      }),
    ).toBeVisible();
    // Stay in the unlocked document: reloading correctly requires the PIN again.
    const recovery = page.locator("#previous-data");
    await expect(
      recovery.getByRole("heading", { name: "Previous data" }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const request = indexedDB.open("feng-finance");
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("Synthetic database failed."));
      });
      const transaction = database.transaction(
        [
          "transactions",
          "settings",
          "layoutTemplates",
          "importDiagnostics",
          "attachments",
        ],
        "readwrite",
      );
      transaction
        .objectStore("transactions")
        .put({ id: "post-update", amount: -199 });
      transaction
        .objectStore("settings")
        .put({ key: "security:pinHash", value: "synthetic-new-pin-hash" });
      transaction
        .objectStore("layoutTemplates")
        .put({ id: "post-update-layout" });
      transaction
        .objectStore("importDiagnostics")
        .put({ id: "post-update-diagnostic" });
      transaction.objectStore("attachments").clear();
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(new Error("Synthetic edits failed."));
      });
      database.close();
    });
    const edited = await rawRecords(page);
    await recovery
      .getByRole("button", { name: "Restore previous data", exact: true })
      .click();
    const restoreSheet = page.getByRole("dialog", {
      name: "Restore previous data",
      exact: true,
    });
    await expect(
      restoreSheet.getByRole("button", {
        name: "Restore previous data",
        exact: true,
      }),
    ).toBeDisabled();
    await restoreSheet
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(await rawRecords(page)).toEqual(edited);
    await recovery
      .getByRole("button", { name: "Restore previous data", exact: true })
      .click();
    await restoreSheet.getByRole("checkbox").check();
    await restoreSheet
      .getByRole("button", { name: "Restore previous data", exact: true })
      .click();
    await expect(
      page.getByLabel("6-digit app PIN", { exact: true }),
    ).toBeVisible();
    const restored = await rawRecords(page);
    for (const [name, rows] of Object.entries(original))
      expect(restored[name]).toEqual(rows);
    for (const [name, rows] of Object.entries(restored))
      if (!(name in original)) expect(rows).toEqual([]);
    expect((await rawRecords(page, true)).safetyBackups).toHaveLength(2);
    await page.getByLabel("6-digit app PIN", { exact: true }).fill("628391");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Welcome to Feng" }),
    ).toBeVisible();
    // Unlocking deliberately records the successful PIN attempt. It must not
    // insert category/rule/reporting defaults or modify the recovered ledger.
    const afterUnlock = await rawRecords(page);
    for (const [name, rows] of Object.entries(restored))
      if (name !== "settings") expect(afterUnlock[name]).toEqual(rows);
    const originalSettings = original.settings as {
      key: string;
      value: { value: string };
    }[];
    const restoredSettings = afterUnlock.settings as {
      key: string;
      value: { value: string };
    }[];
    expect(restoredSettings.map((row) => row.key)).toEqual(
      originalSettings.map((row) => row.key),
    );
    const attemptSettings = new Set(["security:attempts", "security:retryAt"]);
    expect(
      restoredSettings.filter((row) => !attemptSettings.has(row.key)),
    ).toEqual(originalSettings.filter((row) => !attemptSettings.has(row.key)));
  });
}
