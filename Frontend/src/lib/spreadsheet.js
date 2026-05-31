const normalizeHeader = (value) => String(value ?? "").trim();

const normalizeCell = (value) => {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value).trim();
};

const isRowEmpty = (cells = []) => cells.every((value) => normalizeCell(value) === "");

export const parseSpreadsheetRows = async (file) => {
  if (!file) {
    throw new Error("No file selected");
  }

  const fileName = String(file.name || "").toLowerCase();
  if (fileName.endsWith(".xls")) {
    throw new Error("Legacy .xls files are not supported. Please upload .xlsx or .csv.");
  }

  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const rawRows = await readXlsxFile(file);

  if (!Array.isArray(rawRows) || rawRows.length < 2) {
    throw new Error("Selected spreadsheet has no data rows");
  }

  const headers = (Array.isArray(rawRows[0]) ? rawRows[0] : []).map(normalizeHeader);
  if (headers.length === 0 || headers.every((header) => !header)) {
    throw new Error("Selected spreadsheet is missing header columns");
  }

  const rows = rawRows
    .slice(1)
    .filter((cells) => Array.isArray(cells) && !isRowEmpty(cells))
    .map((cells) => {
      const row = {};
      headers.forEach((header, index) => {
        if (!header) return;
        row[header] = normalizeCell(cells[index]);
      });
      return row;
    });

  if (rows.length === 0) {
    throw new Error("Selected spreadsheet has no rows");
  }

  return rows;
};
