import { describe, expect, it } from "vitest";
import {
  csvPreset,
  parseCsv,
  parseOfx,
  parseQif,
  readCsv,
  parseImportDate,
} from "./formats";
import { reconcile } from "../domain/reconcile";

const revolut = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TRANSFER,Current,2026-09-01 09:00:00,2026-09-01 09:00:00,FICTITIOUS SALARY,3000.00,0,GBP,COMPLETED,3100.00
CARD_PAYMENT,Current,2026-09-02 10:00:00,2026-09-02 10:00:00,"FICTITIOUS SHOP, LONDON",-45.50,0,GBP,COMPLETED,3054.50
TRANSFER,Current,2026-09-03 11:00:00,2026-09-03 11:00:00,FICTITIOUS RENT,-900.00,0,GBP,COMPLETED,2154.50`;
describe("private multi-format statement parsing", () => {
  it("reads quoted commas, escaped quotes, line breaks and UTF-8 BOM", () => {
    const table = readCsv(
      '\uFEFFDate,Description,Amount\r\n01/09/2026,"Shop, \"\"Example\"\"\nLondon",-12.00\r\n',
    );
    expect(table.rows).toEqual([
      ["01/09/2026", 'Shop, "Example"\nLondon', "-12.00"],
    ]);
  });
  it("supports tab and semicolon exports without confusing quoted commas", () => {
    expect(
      readCsv('Date;Description;Amount\n01/09/2026;"Shop, London";-10.00')
        .separator,
    ).toBe(";");
    expect(
      readCsv("Date\tDescription\tAmount\n01/09/2026\tShop\t-10.00").separator,
    ).toBe("\t");
  });
  it("rejects partial or malformed rows without silently discarding data", () => {
    expect(() =>
      readCsv('Date,Description,Amount\n01/09/2026,"Incomplete'),
    ).toThrow("unfinished");
    expect(() => readCsv("Date,Description,Amount\n01/09/2026,Shop")).toThrow(
      "No rows were discarded",
    );
    expect(() =>
      readCsv('Date,Description,Amount\n01/09/2026,"Shop"oops,-10.00'),
    ).toThrow("closing quote");
  });
  it("detects Revolut and reconciles every running balance in integer minor units", () => {
    const table = readCsv(revolut);
    const preset = csvPreset(table)!;
    expect(preset.name).toBe("Revolut");
    const parsed = parseCsv(table, preset.mapping);
    expect(parsed).toMatchObject({
      institution: "Revolut",
      openingBalance: 10000,
      closingBalance: 215450,
    });
    expect(parsed.transactions.map((t) => t.amount)).toEqual([
      300000, -4550, -90000,
    ]);
    expect(
      reconcile(
        parsed.openingBalance,
        parsed.closingBalance,
        parsed.transactions.map((t) => t.amount),
      ).status,
    ).toBe("reconciled");
    expect(parsed.warnings).toEqual([]);
  });
  it("catches an intermediate balance mismatch even if aggregate opening and closing match", () => {
    const table = readCsv(revolut.replace(",3054.50", ",3054.51"));
    const parsed = parseCsv(table, csvPreset(table)!.mapping);
    expect(
      reconcile(
        parsed.openingBalance,
        parsed.closingBalance,
        parsed.transactions.map((t) => t.amount),
      ).status,
    ).toBe("reconciled");
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
  it("keeps separate fee rows and reconciles sparse balance anchors", () => {
    const table = readCsv(
      revolut.replace(
        "-45.50,0,GBP,COMPLETED,3054.50",
        "-45.00,0.50,GBP,COMPLETED,3054.50",
      ),
    );
    const parsed = parseCsv(table, csvPreset(table)!.mapping);
    expect(parsed.transactions.map((t) => t.amount)).toEqual([
      300000, -4500, -50, -90000,
    ]);
    expect(
      reconcile(
        parsed.openingBalance,
        parsed.closingBalance,
        parsed.transactions.map((t) => t.amount),
      ).status,
    ).toBe("reconciled");
  });
  it("ignores explicitly pending/reverted records, preserving completed ones", () => {
    const table = readCsv(
      revolut +
        "\nCARD_PAYMENT,Current,2026-09-04 09:00:00,2026-09-04 09:00:00,PENDING SHOP,-20.00,0,GBP,PENDING,2134.50",
    );
    expect(
      parseCsv(table, csvPreset(table)!.mapping).transactions,
    ).toHaveLength(3);
  });
  it("refuses mixed currencies in one export rather than adding incomparable amounts", () => {
    const table = readCsv(revolut.replace("-900.00,0,GBP", "-900.00,0,EUR"));
    expect(() => parseCsv(table, csvPreset(table)!.mapping)).toThrow(
      "multiple currencies",
    );
  });
  it("detects a Revolut EUR export instead of assuming GBP", () => {
    const table = readCsv(revolut.replaceAll(",GBP,", ",EUR,"));
    expect(parseCsv(table, csvPreset(table)!.mapping).currency).toBe("EUR");
  });
  it("detects Barclays debit/credit columns and quoted thousands separators", () => {
    const table = readCsv(
      'Date,Description,Money out,Money in,Balance\n01/09/2026,SALARY,,"3,726.00","3,826.00"\n01/09/2026,SHOP,20.00,,"3,806.00"',
    );
    const parsed = parseCsv(table, csvPreset(table)!.mapping);
    expect(parsed.transactions.map((t) => t.amount)).toEqual([372600, -2000]);
  });
  it("uses Amex UK and Barclaycard purchase/credit signs", () => {
    const table = readCsv(
      "Date,Description,Amount,Card Member\n01/09/2026,SHOP,40.00,DEMO\n02/09/2026,PAYMENT,-40.00,DEMO",
    );
    expect(
      parseCsv(table, csvPreset(table, "amex.csv")!.mapping).transactions.map(
        (t) => t.amount,
      ),
    ).toEqual([-4000, 4000]);
    expect(csvPreset(table, "barclaycard.csv")?.mapping).toMatchObject({
      institution: "Barclays",
      accountType: "credit",
      amountDirection: "purchases-positive",
    });
  });
  it("requires custom mapping for an unknown export rather than guessing a provider", () => {
    const table = readCsv("Date,Description,Amount\n01/09/2026,SHOP,-40.00");
    expect(csvPreset(table)).toBeUndefined();
    expect(
      parseCsv(table, { date: 0, description: 1, amount: 2 }).openingBalance,
    ).toBeUndefined();
  });
  it("normalizes positive card debt before reconciling purchases and refunds", () => {
    const table = readCsv(
      "Date,Description,Amount,Balance,Card Member\n01/09/2026,SHOP,20.00,120.00,DEMO\n02/09/2026,SHOP REFUND,-10.00,110.00,DEMO",
    );
    for (const filename of ["amex.csv", "barclaycard.csv"]) {
      const parsed = parseCsv(table, csvPreset(table, filename)!.mapping);
      expect(parsed).toMatchObject({
        openingBalance: -10000,
        closingBalance: -11000,
      });
      expect(
        parsed.transactions.map((row) => row.balanceAfterTransaction),
      ).toEqual([-12000, -11000]);
      expect(
        reconcile(
          parsed.openingBalance,
          parsed.closingBalance,
          parsed.transactions.map((row) => row.amount),
        ).status,
      ).toBe("reconciled");
      expect(parsed.warnings).toEqual([]);
    }
  });
  it("preserves explicitly financial negative card balances without inverting them twice", () => {
    const table = readCsv(
      "Date,Description,Amount,Balance,Card Member\n01/09/2026,SHOP,20.00,-120.00,DEMO\n02/09/2026,SHOP REFUND,-10.00,-110.00,DEMO",
    );
    const parsed = parseCsv(table, {
      ...csvPreset(table, "amex.csv")!.mapping,
      balanceDirection: "financial",
    });
    expect(parsed).toMatchObject({
      openingBalance: -10000,
      closingBalance: -11000,
    });
    expect(
      reconcile(
        parsed.openingBalance,
        parsed.closingBalance,
        parsed.transactions.map((row) => row.amount),
      ).status,
    ).toBe("reconciled");
    expect(parsed.warnings).toEqual([]);
  });
  it("supports a mapped US date convention but never silently reverses UK dates", () => {
    expect(parseImportDate("09/05/2026")).toBe("2026-05-09");
    expect(parseImportDate("09/05/2026", "month-first")).toBe("2026-09-05");
    expect(parseImportDate("2026-09-05 11:15:00")).toBe("2026-09-05");
  });
  const ofx = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>BARCLAYS</ORG></FI></SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><STMTTRS><CURDEF>GBP<BANKACCTFROM><ACCTID>12344321<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>20260901000000<DTEND>20260930235959<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260901120000.000[0:GMT]<TRNAMT>1000.00<FITID>demo-one<NAME>FICTITIOUS PAY<MEMO>Salary</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260902120000<TRNAMT>-10.50<FITID>demo-two<NAME>FICTITIOUS SHOP</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>1089.50<DTASOF>20260930235959</LEDGERBAL></STMTTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  it("reads SGML OFX/QFX identifiers, timestamps and a ledger balance", () => {
    const parsed = parseOfx(ofx);
    expect(parsed).toMatchObject({
      institution: "Barclays",
      accountIdentifier: "•••• 4321",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      closingBalance: 108950,
    });
    expect(parsed.transactions.map((t) => t.amount)).toEqual([100000, -1050]);
    expect(parsed.transactions[0].sourceId).toBe("demo-one");
    expect(parsed.openingBalance).toBeUndefined();
    expect(
      reconcile(
        parsed.openingBalance,
        parsed.closingBalance,
        parsed.transactions.map((t) => t.amount),
      ).status,
    ).toBe("unavailable");
  });
  it("reads XML OFX and refuses malicious external entities without any fetch", () => {
    expect(
      parseOfx(ofx.replace(/<CURDEF>GBP/, "<CURDEF>GBP</CURDEF>")).currency,
    ).toBe("GBP");
    expect(() =>
      parseOfx(
        '<!DOCTYPE OFX [<!ENTITY secret SYSTEM "https://example.invalid">]>' +
          ofx,
      ),
    ).toThrow("external entities");
  });
  it("rejects multiple-account OFX and missing amounts explicitly", () => {
    expect(() =>
      parseOfx(ofx.replace("</OFX>", "<STMTTRS></STMTTRS></OFX>")),
    ).toThrow("multiple accounts");
    expect(() => parseOfx(ofx.replace("<TRNAMT>1000.00", ""))).toThrow(
      "amount is missing",
    );
  });
  it("parses QIF dates, grouped amounts, memo continuation and card account types", () => {
    const parsed = parseQif(
      "!Type:CCard\nD09/01'26\nT-1,250.50\nPDEMO PURCHASE\nMReference ABC\n^\nD09/02/2026\nT1250.50\nPDEMO PAYMENT\n^\n",
      { dateOrder: "month-first" },
    );
    expect(parsed.accountType).toBe("credit");
    expect(parsed.transactions.map((t) => [t.date, t.amount])).toEqual([
      ["2026-09-01", -125050],
      ["2026-09-02", 125050],
    ]);
    expect(parsed.transactions[0].description).toBe(
      "DEMO PURCHASE REFERENCE ABC",
    );
  });
  it("rejects unfinished QIF and never fabricates missing balances", () => {
    expect(() =>
      parseQif("!Type:Bank\nD09/01/2026\nT-10.00\nPDEMO", {
        dateOrder: "month-first",
      }),
    ).toThrow("unfinished");
    const parsed = parseQif("!Type:Bank\nD09/01/2026\nT-10.00\nPDEMO\n^\n", {
      dateOrder: "month-first",
    });
    expect(parsed.openingBalance).toBeUndefined();
    expect(parsed.closingBalance).toBeUndefined();
  });
  it("requires an explicit QIF date order when every numeric date is ambiguous", () => {
    expect(() =>
      parseQif("!Type:Bank\nD09/01/2026\nT-10.00\nPDEMO\n^\n"),
    ).toThrow("date order is unclear");
    expect(
      parseQif("!Type:Bank\nD15/09/2026\nT-10.00\nPDEMO\n^\n").transactions[0]
        .date,
    ).toBe("2026-09-15");
    expect(
      parseQif("!Type:Bank\nD09/15/2026\nT-10.00\nPDEMO\n^\n").transactions[0]
        .date,
    ).toBe("2026-09-15");
  });
});
