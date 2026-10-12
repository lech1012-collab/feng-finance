import { describe, it, expect } from "vitest";
import { parseGenericStatement } from "./engine";
import { genericFixture } from "./fixtures";
import { readMoney } from "./tokens";
import { textQuality } from "./table";
describe("generic proof-first parsing", () => {
  for (const id of [
    "T1",
    "T2",
    "T3",
    "T4",
    "T5GBP",
    "T5EUR",
    "T6",
    "T9",
    "T10",
  ] as const)
    it(id, () => {
      const fixture = genericFixture(id);
      const r = parseGenericStatement(fixture.items, fixture.pages);
      expect(r.parsed, JSON.stringify(r)).toBeDefined();
      expect(r.checks.reconciledExactly, JSON.stringify(r, null, 2)).toBe(true);
      expect(r.rowChecks.every((c) => c.resolved)).toBe(true);
      expect(r.parsed!.transactions).toHaveLength(
        id === "T9" || id === "T3" || id === "T4" ? 2 : 3,
      );
    });
  it("T7 and T8 require local OCR", () => {
    for (const id of ["T7", "T8"] as const) {
      const f = genericFixture(id);
      expect(textQuality(f.items, f.pages).some((p) => !p.usable)).toBe(true);
    }
  });
  it("T11 rejects even one penny", () => {
    const f = genericFixture("T11");
    const r = parseGenericStatement(f.items, f.pages);
    expect(r.checks.reconciledExactly).toBe(false);
    expect(r.checks.reconciliation.difference).toBe(-1);
    expect(
      r.rowChecks.find((c) => c.issues.includes("balance-difference"))
        ?.difference,
    ).toBe(-1);
  });
  it("parses all explicit money signs exactly", () => {
    expect(
      [
        "1,234.56",
        "-1,234.56",
        "1,234.56-",
        "(1,234.56)",
        "1,234.56 CR",
        "1,234.56 DR",
        "€1,234.56",
      ].map((t) => readMoney(t)),
    ).toEqual([123456, -123456, -123456, -123456, 123456, -123456, 123456]);
  });
});

describe("source row integrity and user review", () => {
  it("keeps all additional transactions with blank inherited dates", () => {
    const f = genericFixture("T5GBP");
    f.items = f.items.filter((item) => !(item.y === 240 && item.x === 30));
    const r = parseGenericStatement(f.items, f.pages);
    expect(r.parsed?.transactions).toHaveLength(3);
    expect(r.parsed?.transactions[1].date).toBe("2026-09-01");
    expect(r.checks.reconciledExactly).toBe(true);
  });
  it("retains malformed amount cells instead of swallowing them as a continuation", () => {
    const f = genericFixture("T5GBP");
    f.items.find((item) => item.y === 240 && item.x === 320)!.text = "1OO.OO";
    const r = parseGenericStatement(f.items, f.pages);
    expect(r.rowChecks).toHaveLength(3);
    expect(r.rowChecks[1].issues).toContain("invalid-amount");
    expect(r.rowChecks[1].resolved).toBe(false);
    expect(r.parsed?.transactions).toHaveLength(2);
    expect(r.checks.reconciledExactly).toBe(false);
  });
  it("retains malformed dates without making up a date", () => {
    const f = genericFixture("T5GBP");
    f.items.find((item) => item.y === 240 && item.x === 30)!.text = "32 Sep";
    const r = parseGenericStatement(f.items, f.pages);
    expect(r.rowChecks).toHaveLength(3);
    expect(r.rowChecks[1].issues).toContain("invalid-date");
    expect(r.parsed?.transactions).toHaveLength(2);
    expect(r.checks.reconciledExactly).toBe(false);
  });
  it("preserves a valid printed date outside the period and requires an Unverified import even after accepting it", () => {
    const f = genericFixture("T6");
    f.items.find((item) => item.y === 210 && item.x === 30)!.text =
      "31 Aug 2026";
    const original = parseGenericStatement(f.items, f.pages);
    expect(original.parsed?.transactions[0].date).toBe("2026-08-31");
    expect(original.rowChecks[0].issues).toContain("outside-period");
    expect(original.rowChecks[0].issues).not.toContain("invalid-date");
    expect(original.checks.reconciliation.difference).toBe(0);
    expect(original.checks.reconciledExactly).toBe(false);
    const row = original.rowChecks[0];
    const accepted = parseGenericStatement(f.items, f.pages, {
      actions: {
        [row.rowId]: { kind: "accept", readingId: row.selectedReadingId! },
      },
    });
    expect(accepted.rowChecks[0].resolved).toBe(true);
    expect(accepted.rowChecks[0].checkLevel).toBe("manual_override");
    expect(accepted.checks.reconciledExactly).toBe(false);
    expect(accepted.checks.reconciliation.status).toBe("warning");
    expect(accepted.parsed?.transactions[0].date).toBe("2026-08-31");
  });
  it("checks card coverage against posting date without rewriting the original purchase date", () => {
    const f = genericFixture("T4");
    f.items.find((item) => item.y === 215 && item.x === 30)!.text =
      "31 Aug 2026";
    for (const [y, text] of [
      [195, "Date"],
      [215, "2 Sep"],
      [245, "3 Sep"],
    ] as const)
      f.items.push({ ...f.items[0], y, x: 70, width: 30, text });
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.parsed?.transactions[0]).toMatchObject({
      date: "2026-08-31",
      bookingDate: "2026-09-02",
    });
    expect(result.rowChecks[0].issues).not.toContain("outside-period");
    expect(result.checks.reconciledExactly).toBe(true);
  });
  it("does not substitute a valid posting date for a malformed primary transaction date", () => {
    const f = genericFixture("T4");
    f.items.find((item) => item.y === 215 && item.x === 30)!.text =
      "32 Aug 2026";
    for (const [y, text] of [
      [195, "Date"],
      [215, "2 Sep"],
      [245, "3 Sep"],
    ] as const)
      f.items.push({ ...f.items[0], y, x: 70, width: 30, text });
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.rowChecks[0].issues).toContain("invalid-date");
    expect(result.rowChecks[0].readings[0].date).toBeUndefined();
    expect(result.parsed?.transactions).toHaveLength(1);
    expect(result.checks.reconciledExactly).toBe(false);
  });
  it("keeps an impossible manual calendar correction in source review without normalizing it", () => {
    const f = genericFixture("T11");
    const original = parseGenericStatement(f.items, f.pages);
    const result = parseGenericStatement(f.items, f.pages, {
      actions: {
        [original.rowChecks[1].rowId]: {
          kind: "correct",
          date: "2026-02-30",
          description: "FICTIONAL SHOP",
          amount: -10000,
        },
      },
    });
    expect(result.rowChecks[1].issues).toContain("invalid-date");
    expect(result.rowChecks[1].resolved).toBe(false);
    expect(result.parsed?.transactions).toHaveLength(2);
    expect(result.checks.reconciledExactly).toBe(false);
  });
  it("keeps numeric references in the description column", () => {
    const f = genericFixture("T5GBP");
    f.items.push({ ...f.items[0], x: 210, y: 240, text: "123", width: 15 });
    const r = parseGenericStatement(f.items, f.pages);
    expect(r.parsed?.transactions[1].description).toContain("123");
    expect(r.parsed?.transactions[1].amount).toBe(-10000);
    expect(r.checks.reconciledExactly).toBe(true);
  });
  it("reads a CR suffix on its own line exactly once", () => {
    const f = genericFixture("T3");
    f.items.find((item) => item.y === 215 && item.x === 470)!.text = "200.00";
    f.items.push({ ...f.items[0], x: 485, y: 225, text: "CR", width: 10 });
    const r = parseGenericStatement(f.items, f.pages);
    expect(r.parsed?.transactions[0].amount).toBe(20000);
    expect(r.parsed?.transactions).toHaveLength(2);
    expect(r.checks.reconciledExactly).toBe(true);
  });
  it("a correction reruns every penny check", () => {
    const f = genericFixture("T11");
    const original = parseGenericStatement(f.items, f.pages);
    const row = original.rowChecks[1];
    const result = parseGenericStatement(f.items, f.pages, {
      actions: {
        [row.rowId]: {
          kind: "correct",
          date: "2026-09-02",
          description: "FICTIONAL SHOP",
          amount: -10000,
        },
      },
    });
    expect(result.checks.reconciledExactly).toBe(true);
    expect(result.rowChecks[1].parseSource).toBe("user");
    expect(result.parsed?.transactions[1].amount).toBe(-10000);
  });
  it("explicit exclusion remains visible and changes source reconciliation", () => {
    const f = genericFixture("T5GBP");
    const original = parseGenericStatement(f.items, f.pages);
    const result = parseGenericStatement(f.items, f.pages, {
      actions: { [original.rowChecks[1].rowId]: { kind: "exclude" } },
    });
    expect(result.rowChecks).toHaveLength(3);
    expect(result.rowChecks[1].reviewAction?.kind).toBe("exclude");
    expect(result.rowChecks[1].resolved).toBe(true);
    expect(result.parsed?.transactions).toHaveLength(2);
    expect(result.checks.reconciledExactly).toBe(false);
    expect(result.checks.reconciliation.difference).toBe(10000);
  });
  it("honours the accepted alternative reading rather than the original candidate", () => {
    const f = genericFixture("T11");
    const original = parseGenericStatement(f.items, f.pages);
    const row = original.rowChecks[1];
    const alternative = row.readings.find(
      (reading) => reading.amount === 10001,
    )!;
    expect(alternative).toBeDefined();
    const result = parseGenericStatement(f.items, f.pages, {
      actions: { [row.rowId]: { kind: "accept", readingId: alternative.id } },
    });
    expect(result.parsed?.transactions[1].amount).toBe(10001);
    expect(result.checks.reconciledExactly).toBe(false);
  });
  it("cannot accept an invalid source amount as a transaction", () => {
    const f = genericFixture("T5GBP");
    f.items.find((item) => item.y === 240 && item.x === 320)!.text = "1OO.OO";
    const original = parseGenericStatement(f.items, f.pages);
    const row = original.rowChecks[1];
    const result = parseGenericStatement(f.items, f.pages, {
      actions: {
        [row.rowId]: { kind: "accept", readingId: row.selectedReadingId! },
      },
    });
    expect(result.rowChecks[1].resolved).toBe(false);
    expect(result.parsed?.transactions).toHaveLength(2);
  });
  it("rejects unsafe fractional corrections instead of persisting a fake amount", () => {
    const f = genericFixture("T11");
    const original = parseGenericStatement(f.items, f.pages);
    const result = parseGenericStatement(f.items, f.pages, {
      actions: {
        [original.rowChecks[1].rowId]: {
          kind: "correct",
          date: "2026-09-02",
          description: "FICTIONAL SHOP",
          amount: -10000.5,
        },
      },
    });
    expect(result.rowChecks[1].issues).toContain("invalid-amount");
    expect(result.parsed?.transactions).toHaveLength(2);
  });
  it("supports a manually mapped month-first date convention", () => {
    const f = genericFixture("T5GBP");
    for (const item of f.items.filter((item) => item.x === 30 && item.y >= 210))
      item.text =
        item.y === 210
          ? "09/01/2026"
          : item.y === 240
            ? "09/02/2026"
            : "09/03/2026";
    const first = parseGenericStatement(f.items, f.pages);
    const result = parseGenericStatement(f.items, f.pages, {
      mapping: { ...first.mapping!, dateFormat: "month-first" },
    });
    expect(result.checks.reconciledExactly).toBe(true);
    expect(
      result.parsed?.transactions.map((transaction) => transaction.date),
    ).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });
  it("does not claim an unread page was reconciled", () => {
    const f = genericFixture("T1");
    const result = parseGenericStatement(f.items, f.pages, {
      unreadPages: [3],
    });
    expect(result.checks.reconciledExactly).toBe(false);
    expect(result.checks.unreadPages).toEqual([3]);
    expect(result.checks.reconciliation.status).toBe("warning");
  });
  it("does not claim an empty unprocessed page was reconciled", () => {
    const f = genericFixture("T5GBP");
    f.pages.push({ page: 2, width: 600, height: 800, rotation: 0 });
    expect(
      parseGenericStatement(f.items, f.pages).checks.reconciledExactly,
    ).toBe(false);
  });
  it("labels card rows total-checked and never balance-checked", () => {
    const f = genericFixture("T4");
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.rowChecks.map((row) => row.checkLevel)).toEqual([
      "total",
      "total",
    ]);
    expect(result.checks.balanceRowsPassed).toBe(0);
    expect(result.checks.totalCheckedRows).toBe(2);
  });
  it("an independent total with opposite errors cannot cancel to a false reconciliation", () => {
    const f = genericFixture("T4");
    const result = parseGenericStatement(f.items, f.pages, {
      evidence: {
        openingBalance: undefined,
        closingBalance: undefined,
        printedMoneyIn: 19999,
        printedMoneyOut: 12551,
      },
    });
    expect(result.checks.reconciledExactly).toBe(false);
    expect(result.checks.moneyInDifference).toBe(1);
    expect(result.checks.moneyOutDifference).toBe(-1);
  });
  it("infers money-in, money-out and balances when headers are missing", () => {
    const f = genericFixture("T5GBP");
    f.items = f.items.filter((item) => item.y !== 180);
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.parsed?.transactions).toHaveLength(3);
    expect(result.checks.reconciledExactly, JSON.stringify(result)).toBe(true);
  });
  it("continues blank-date rows on a following page without repeating a header", () => {
    const f = genericFixture("T1");
    f.items = f.items.filter(
      (item) =>
        !(item.page === 2 && item.y === 60) &&
        !(item.page === 2 && item.y === 100 && item.x === 30),
    );
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.parsed?.transactions).toHaveLength(3);
    expect(result.parsed?.transactions[2].date).toBe("2026-09-02");
    expect(result.checks.reconciledExactly).toBe(true);
  });
  it("reuses a fractional saved layout but still rejects changed numeric geometry", () => {
    const f = genericFixture("T5GBP");
    const first = parseGenericStatement(f.items, f.pages);
    const template = {
      id: "fictitious-layout",
      name: "Fictional layout",
      fingerprint: first.layoutFingerprint,
      columnRoles: first.mapping!.columnRoles.map((role) => {
        const col = first.table.columns.find((c) => c.id === role.columnId)!;
        return { x0: col.x0 / 600, x1: col.x1 / 600, role: role.role };
      }),
      coordinateSpace: "page-width-fraction" as const,
      signConvention: first.mapping!.signConvention,
      balanceSign: first.mapping!.balanceSign,
      dateFormat: "auto",
      createdAt: "2026-10-11T00:00:00Z",
      lastUsedAt: "2026-10-11T00:00:00Z",
      status: "active" as const,
    };
    expect(
      parseGenericStatement(f.items, f.pages, { template }).checks
        .reconciledExactly,
    ).toBe(true);
    const changed = genericFixture("T2");
    const result = parseGenericStatement(changed.items, changed.pages, {
      template,
    });
    expect(result.checks.reconciledExactly).toBe(false);
    expect(result.errorCode).toBe("template-changed");
  });
  it("fingerprint contains no changing statement values or identifying text", () => {
    const f = genericFixture("T6");
    const result = parseGenericStatement(f.items, f.pages);
    for (const value of [
      "11112222",
      "FICTIONAL",
      "1,000.00",
      "September",
      "2026",
      "Birch",
    ])
      expect(result.layoutFingerprint).not.toContain(value);
    const changed = genericFixture("T6");
    changed.items.find((item) => /account number/i.test(item.text))!.text =
      "Account number 99990000";
    expect(
      parseGenericStatement(changed.items, changed.pages).layoutFingerprint,
    ).toBe(result.layoutFingerprint);
  });
});

describe("content inference does not depend on complete headers", () => {
  it("keeps a generated-PDF issuer banner above the repeated page table out of financial rows", () => {
    const f = genericFixture("T1");
    f.pages = f.pages.slice(0, 2);
    f.items = f.items.filter(
      (item) => item.page <= 2 && !(item.page === 2 && item.y === 35),
    );
    for (const item of f.items.filter((item) => item.page === 2))
      if (item.y === 60) item.y = 210;
      else if (item.y === 100) item.y = 240;
    // scripts/fixtures.mjs draws the issuer at x35 / baseline50 in 16pt on
    // subsequent pages. PDF.js top-left geometry is therefore y34 / h16.
    f.items.push({
      page: 2,
      x: 35,
      y: 34,
      width: 70,
      height: 16,
      fontSize: 16,
      parseSource: "text",
      text: "Barclays",
    });
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.parsed?.transactions).toHaveLength(3);
    expect(result.rowChecks).toHaveLength(3);
    expect(result.parsed?.transactions[2]).toMatchObject({
      date: "2026-09-03",
      amount: -2550,
    });
    expect(result.checks.reconciledExactly).toBe(true);
    expect(result.checks.reconciliation.difference).toBe(0);
    expect(
      result.table.rows.find((row) => row.rect.page === 2 && row.rect.y === 34)
        ?.kind,
    ).toBe("header");
    expect(
      result.table.columns.some((column) =>
        column.id.startsWith("p2-inherited"),
      ),
    ).toBe(false);
  });
  it("retains an issuer-name malformed date inside the transaction table for review", () => {
    const f = genericFixture("T5GBP");
    f.items.find((item) => item.x === 30 && item.y === 240)!.text = "Revolut";
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.rowChecks).toHaveLength(3);
    expect(result.rowChecks[1].issues).toContain("invalid-date");
    expect(result.rowChecks[1].readings[0].rawDate).toBe("Revolut");
    expect(result.checks.reconciledExactly).toBe(false);
  });
  it("recognises an unknown issuer's repeated top-of-page title only before its printed table header", () => {
    const f = genericFixture("T6");
    f.pages.push({ page: 2, width: 600, height: 800, rotation: 0 });
    const header = f.items.filter((item) => item.y === 180);
    for (const item of f.items.filter((item) => item.y === 270)) {
      item.page = 2;
      item.y = 240;
    }
    f.items.push(...header.map((item) => ({ ...item, page: 2, y: 210 })));
    f.items.push({
      ...f.items[0],
      page: 2,
      x: 35,
      y: 34,
      fontSize: 16,
      height: 16,
    });
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.parsed?.institution).toBe("Other");
    expect(result.rowChecks).toHaveLength(3);
    expect(result.checks.reconciledExactly).toBe(true);
    expect(
      result.table.rows.find((row) => row.rect.page === 2 && row.rect.y === 34)
        ?.kind,
    ).toBe("header");
  });
  it("retains bank-name merchants with valid dates and amounts", () => {
    const f = genericFixture("T5GBP");
    f.items.find((item) => item.x === 110 && item.y === 240)!.text = "Revolut";
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.rowChecks).toHaveLength(3);
    expect(result.parsed?.transactions[1]).toMatchObject({
      description: "REVOLUT",
      amount: -10000,
      date: "2026-09-02",
    });
    expect(result.checks.reconciledExactly).toBe(true);
  });
  it("recovers an unlabelled money-out column from the repeated data alignment", () => {
    const f = genericFixture("T5GBP");
    f.items = f.items.filter((item) => !(item.y === 180 && item.x === 320));
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.parsed?.transactions).toHaveLength(3);
    expect(result.parsed?.transactions.map((row) => row.amount)).toEqual([
      20000, -10000, -2550,
    ]);
    expect(result.checks.reconciledExactly).toBe(true);
  });
  it("rejects conflicting printed currency labels rather than picking the first", () => {
    const f = genericFixture("T5GBP");
    f.items.find((item) => item.text === "Currency GBP")!.text =
      "Currency GBP EUR";
    expect(parseGenericStatement(f.items, f.pages).errorCode).toBe(
      "missing-currency",
    );
  });
  it("does not inherit dates after an unsupported explicit date", () => {
    const f = genericFixture("T5GBP");
    f.items.find((item) => item.y === 210 && item.x === 30)!.text = "99 Sep";
    f.items = f.items.filter((item) => !(item.y === 240 && item.x === 30));
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.rowChecks[0].issues).toContain("invalid-date");
    expect(result.rowChecks[1].issues).toContain("invalid-date");
    expect(result.parsed?.transactions).toHaveLength(1);
  });
  it("reads metadata on a transaction page after an information-only cover", () => {
    const f = genericFixture("T5GBP");
    f.items.forEach((item) => item.page++);
    f.pages[0].page = 2;
    f.items.unshift({
      page: 1,
      x: 30,
      y: 20,
      text: "Revolut migration information",
      width: 200,
      height: 10,
      fontSize: 10,
      parseSource: "text",
    });
    f.pages.unshift({ page: 1, width: 600, height: 800, rotation: 0 });
    const result = parseGenericStatement(f.items, f.pages);
    expect(result.parsed?.periodStart).toBe("2026-09-01");
    expect(result.checks.reconciledExactly).toBe(true);
  });
});
