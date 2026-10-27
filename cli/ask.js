import { generateSql } from "./gemini.js";
import { runCsvAction } from "./engine.js";
import { assertQuestionDimensions } from "./question-guard.js";

export async function runAsk({ question, filePath, limit = 100, onStatus, generate = generateSql, runAction = runCsvAction }) {
  const schemaResult = await runAction({ action: "schema", filePath });
  assertQuestionDimensions(question, schemaResult.schema, schemaResult.columns);
  onStatus?.("Gemini SQL generation");
  const generated = await generate(question, schemaResult.schema, {
    tableName: schemaResult.tableName,
    columns: schemaResult.columns,
    onStatus,
  });
  onStatus?.("Local query execution");
  const result = await runAction({ action: "query", filePath, sql: generated.sql, limit });
  return {
    sql: generated.sql,
    rows: result.rows,
    truncated: result.truncated,
    providerUsage: generated.providerUsage ?? null,
  };
}
