export function formatTable(rows) {
  if (!rows.length) return "No rows returned.";
  const headers = Object.keys(rows[0]);
  const values = rows.map((row) => headers.map((header) => {
    const value = row[header] == null ? "NULL" : typeof row[header] === "object" ? JSON.stringify(row[header]) : String(row[header]);
    return value.length > 60 ? `${value.slice(0, 57)}...` : value;
  }));
  const widths = headers.map((header, index) => Math.min(60, Math.max(header.length, ...values.map((row) => row[index].length))));
  const border = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
  const render = (row) => `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [border, render(headers), border, ...values.map(render), border].join("\n");
}

export function formatJsonResult({ sql, rows, truncated, durationMs, providerUsage }) {
  return JSON.stringify({ sql, rows, rowCount: rows.length, truncated, durationMs, providerUsage }, null, 2);
}
