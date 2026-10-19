import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("CSV exports", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+44 7700")).toBe("'+44 7700");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-1")).toBe("'-1");
  });
  it("quotes commas, quotes and newlines; joins arrays", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(["x", "y"])).toBe("x; y");
    expect(toCsv([{ a: 1, b: null }], ["a", "b"])).toBe("a,b\r\n1,\r\n");
  });
});
