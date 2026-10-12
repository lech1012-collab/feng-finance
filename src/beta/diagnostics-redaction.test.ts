import { describe, expect, it } from "vitest";
import type { ImportDiagnostics } from "../domain/models";
import {
  redactImportDiagnostics,
  redactedDiagnosticsText,
} from "./diagnostics-redaction";

const secretValues = [
  "PRIVATE-ACCOUNT-00001234",
  "2031-03-17",
  "PRIVATE-MERCHANT-SECRET",
  "1234567.89",
  "Header-private-name",
];
function diagnostic(): ImportDiagnostics {
  return {
    id: secretValues[0],
    statementId: secretValues[0],
    createdAt: secretValues[1],
    parserVersion: "2.2.0",
    method: "text",
    table: {
      columns: [
        {
          id: "date",
          x0: 10.2,
          x1: 80.4,
          alignment: "left",
          headerText: secretValues[4],
          inferredRole: "date",
        },
        {
          id: "description",
          x0: 90,
          x1: 310,
          alignment: "left",
          headerText: secretValues[4],
          inferredRole: "description",
        },
        {
          id: "amount",
          x0: 320,
          x1: 400,
          alignment: "right",
          headerText: secretValues[4],
          inferredRole: "amount",
        },
        {
          id: "balance",
          x0: 410,
          x1: 510,
          alignment: "right",
          headerText: secretValues[4],
          inferredRole: "balance",
        },
      ],
      pages: [{ page: 1, width: 595, height: 842, rotation: 0 }],
      rows: [
        {
          id: "raw-sensitive-row",
          kind: "transaction",
          rect: { page: 1, x: 10, y: 150, width: 500, height: 12 },
          cells: [
            {
              columnId: "date",
              text: secretValues[1],
              rect: { page: 1, x: 10, y: 150, width: 70, height: 12 },
              parseSource: "text",
            },
            {
              columnId: "description",
              text: secretValues[2],
              rect: { page: 1, x: 90, y: 150, width: 220, height: 12 },
              parseSource: "text",
            },
            {
              columnId: "amount",
              text: secretValues[3],
              rect: { page: 1, x: 320, y: 150, width: 80, height: 12 },
              parseSource: "text",
            },
            {
              columnId: "balance",
              text: secretValues[3],
              rect: { page: 1, x: 410, y: 150, width: 100, height: 12 },
              parseSource: "text",
            },
          ],
        },
      ],
    },
    rows: [
      {
        rowId: "raw-sensitive-row",
        transactionId: secretValues[0],
        checkLevel: "review",
        parseSource: "text",
        readings: [
          {
            id: "sensitive-reading",
            date: secretValues[1],
            description: secretValues[2],
            amount: 123456789,
            parseSource: "text",
            rawBalance: secretValues[3],
          },
        ],
        rect: { page: 1, x: 10, y: 150, width: 500, height: 12 },
        amountRects: [],
        balanceRects: [],
        previousBalance: 123456789,
        difference: 123456789,
        issues: ["balance-difference"],
        resolved: false,
      },
    ],
    checks: {
      policy: "exact-v2.2",
      reconciliation: { status: "warning", difference: 123456789 },
      calculatedMoneyIn: 123456789,
      calculatedMoneyOut: 123456789,
      balanceRowsPassed: 0,
      balanceRowsFailed: 1,
      totalCheckedRows: 0,
      needsReviewRows: 1,
      unreadPages: [],
      evidence: ["running-balances"],
      reconciledExactly: false,
    },
  };
}

describe("redacted import diagnostics", () => {
  it("masks dates, descriptions, amounts, balances and headers without exporting IDs", () => {
    const redacted = redactImportDiagnostics(diagnostic(), "2.2.0");
    expect(redacted.rows[0].cells.map((cell) => cell.text)).toEqual([
      "[date]",
      "[text]",
      "[amount]",
      "[amount]",
    ]);
    expect(redacted.rows[0].issueCodes).toEqual(["balance-difference"]);
    expect(redacted.columns[0].x0).toBe(10);
    const exported = JSON.stringify(redacted);
    for (const value of secretValues) expect(exported).not.toContain(value);
    expect(exported).not.toContain("raw-sensitive-row");
    expect(exported).not.toContain("123456789");
    expect(Object.keys(redacted.checks)).toEqual([
      "exact",
      "balancePassed",
      "balanceFailed",
      "totalChecked",
      "needsReview",
      "unreadPageCount",
    ]);
  });
  it("drops unknown added fields rather than relying on a sensitive-key denylist", () => {
    const source = diagnostic();
    const extended = Object.assign(source, {
      filename: secretValues[0],
      address: secretValues[2],
      futureField: secretValues[3],
    });
    Object.assign(extended.table.rows[0].cells[0], {
      accountNumber: secretValues[0],
      statementCrop: secretValues[2],
    });
    const exported = redactedDiagnosticsText([extended], "2.2.0");
    for (const value of secretValues) expect(exported).not.toContain(value);
    expect(exported).not.toContain("filename");
    expect(exported).not.toContain("statementCrop");
  });
  it("exports at most five diagnostics and omits unsafe parser version strings", () => {
    const source = diagnostic();
    source.parserVersion = secretValues[2];
    const bundle = JSON.parse(
      redactedDiagnosticsText(
        Array.from({ length: 8 }, () => source),
        "2.2.0",
      ),
    ) as { imports: unknown[] };
    expect(bundle.imports).toHaveLength(5);
    expect(JSON.stringify(bundle)).not.toContain(secretValues[2]);
    expect(redactImportDiagnostics(source, "2.2.0").parserVersion).toBe(
      "unknown",
    );
  });
});
