const normalizeHeader = (value) => String(value ?? "").replace(/^\uFEFF/, "").trim();

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

const toSheetData = (readResult) => {
  if (!Array.isArray(readResult)) {
    return [];
  }

  // read-excel-file v9 default export returns all sheets:
  // [{ sheet: "Sheet1", data: [...] }, ...].
  if (readResult.some((item) => item && typeof item === "object" && Array.isArray(item.data))) {
    return readResult
      .filter((item) => Array.isArray(item.data))
      .map((item) => ({ name: item.sheet || "Sheet", rows: item.data }));
  }

  // Keep compatibility with older versions or readSheet(), which return rows directly.
  return [{ name: "Sheet", rows: readResult }];
};

const getHeaderRowIndex = (rows) => {
  const firstNonEmpty = rows.findIndex((cells) => Array.isArray(cells) && !isRowEmpty(cells));
  if (firstNonEmpty === -1) {
    return -1;
  }

  const firstMultiColumnHeader = rows.findIndex((cells, index) => {
    if (index < firstNonEmpty || !Array.isArray(cells) || isRowEmpty(cells)) {
      return false;
    }

    const nonEmptyHeaders = cells.map(normalizeHeader).filter(Boolean);
    if (nonEmptyHeaders.length < 2) {
      return false;
    }

    return rows.slice(index + 1).some((row) => Array.isArray(row) && !isRowEmpty(row));
  });

  return firstMultiColumnHeader >= 0 ? firstMultiColumnHeader : firstNonEmpty;
};

const readRowsFromSheets = (sheets) => {
  let sawHeader = false;
  let sawDataRows = false;

  for (const sheet of sheets) {
    const rawRows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const headerIndex = getHeaderRowIndex(rawRows);
    if (headerIndex === -1) {
      continue;
    }

    const headers = (Array.isArray(rawRows[headerIndex]) ? rawRows[headerIndex] : []).map(normalizeHeader);
    if (headers.length === 0 || headers.every((header) => !header)) {
      continue;
    }

    sawHeader = true;
    const rows = rawRows
      .slice(headerIndex + 1)
      .filter((cells) => Array.isArray(cells) && !isRowEmpty(cells))
      .map((cells) => {
        const row = {};
        headers.forEach((header, index) => {
          if (!header) return;
          row[header] = normalizeCell(cells[index]);
        });
        return row;
      });

    if (rows.length > 0) {
      return rows;
    }

    sawDataRows = true;
  }

  if (!sawHeader) {
    throw new Error("Selected spreadsheet is missing header columns");
  }

  if (!sawDataRows) {
    throw new Error("Selected spreadsheet has no data rows");
  }

  throw new Error("Selected spreadsheet has no rows");
};

export const parseSpreadsheetRows = async (file) => {
  if (!file) {
    throw new Error("No file selected");
  }

  const fileName = String(file.name || "").toLowerCase();
  if (fileName.endsWith(".xls")) {
    throw new Error("Legacy .xls files are not supported. Please upload .xlsx or .csv.");
  }

  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = toSheetData(await readXlsxFile(file));

  if (sheets.length === 0 || sheets.every((sheet) => !Array.isArray(sheet.rows) || sheet.rows.length === 0)) {
    throw new Error("Selected spreadsheet has no data rows");
  }

  return readRowsFromSheets(sheets);
};
