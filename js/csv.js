export function csvToJourneys(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];

  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex === -1) return [];

  const headers = rows[headerRowIndex].map(normaliseHeader);
  const dataRows = rows.slice(headerRowIndex + 1);

  return dataRows
    .map((row) => {
      const rawJourney = {};

      headers.forEach((header, index) => {
        if (!header) return;
        rawJourney[header] = row[index] ? row[index].trim() : "";
      });

      return {
        from: rawJourney.from || "",
        to: rawJourney.to || "",
        method: rawJourney.method || "",
        distance: rawJourney.distance || "",
        time: rawJourney.time || "",
        total: rawJourney.total || ""
      };
    })
    .filter((journey) => journey.from || journey.to || journey.method || journey.distance);
}

function findHeaderRowIndex(rows) {
  return rows.findIndex((row) => {
    const headers = row.map(normaliseHeader);
    return headers.includes("from") && headers.includes("to");
  });
}

function normaliseHeader(header) {
  return String(header || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseCsv(csvText) {
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let index = 0; index < csvText.length; index++) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      currentCell += '"';
      index++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") index++;

      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.trim() !== "")) rows.push(currentRow);

      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }

  currentRow.push(currentCell);
  if (currentRow.some((cell) => cell.trim() !== "")) rows.push(currentRow);

  return rows;
}
