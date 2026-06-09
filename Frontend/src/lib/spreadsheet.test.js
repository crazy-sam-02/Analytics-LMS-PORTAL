import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseSpreadsheetRows } from "./spreadsheet";

const mocks = vi.hoisted(() => ({
  readXlsxFile: vi.fn(),
}));

vi.mock("read-excel-file/browser", () => ({
  default: mocks.readXlsxFile,
}));

const makeFile = (name = "students.xlsx") => new File([""], name, {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

describe("parseSpreadsheetRows", () => {
  beforeEach(() => {
    mocks.readXlsxFile.mockReset();
  });

  it("reads rows from read-excel-file v9 sheet results", async () => {
    mocks.readXlsxFile.mockResolvedValue([
      {
        sheet: "Students",
        data: [
          ["fullName", "email", "enrollNumber", "department", "year", "batch"],
          ["Alice Doe", "alice@example.com", 20261001, "Computer Science", 1, "CSE-2027-A"],
        ],
      },
    ]);

    await expect(parseSpreadsheetRows(makeFile())).resolves.toEqual([
      {
        fullName: "Alice Doe",
        email: "alice@example.com",
        enrollNumber: "20261001",
        department: "Computer Science",
        year: "1",
        batch: "CSE-2027-A",
      },
    ]);
  });

  it("skips blank, instruction, and empty sheets before finding headers", async () => {
    mocks.readXlsxFile.mockResolvedValue([
      { sheet: "Instructions", data: [["Use the next tab for import"]] },
      {
        sheet: "Students",
        data: [
          [null, null, null],
          ["Student import template"],
          ["Full Name", "Email", "Enrollment Number", "Department Name", "Academic Year"],
          ["Alice Doe", "alice@example.com", "20261001", "Computer Science", "1"],
        ],
      },
    ]);

    await expect(parseSpreadsheetRows(makeFile())).resolves.toEqual([
      {
        "Full Name": "Alice Doe",
        Email: "alice@example.com",
        "Enrollment Number": "20261001",
        "Department Name": "Computer Science",
        "Academic Year": "1",
      },
    ]);
  });

  it("keeps compatibility with older row-array results", async () => {
    mocks.readXlsxFile.mockResolvedValue([
      ["fullName", "email"],
      ["Alice Doe", "alice@example.com"],
    ]);

    await expect(parseSpreadsheetRows(makeFile())).resolves.toEqual([
      {
        fullName: "Alice Doe",
        email: "alice@example.com",
      },
    ]);
  });
});
