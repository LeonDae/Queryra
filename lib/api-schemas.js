import { z } from "zod";

const schemaFields = {
  schemaMode: z.enum(["default", "selected_tables", "custom"]).default("default"),
  selectedTables: z.array(z.string().min(1).max(63)).max(200).optional(),
  customSchema: z.string().max(100_000).optional(),
};

export const generateRequestSchema = z.object({
  question: z.string().trim().min(1, "Question cannot be empty.").max(8_000),
  pipeline: z.enum(["llm", "slm_review"]).default("llm"),
  ...schemaFields,
}).strict();

export const executeRequestSchema = z.object({
  originalQuestion: z.string().max(8_000).optional().default(""),
  generatedSQL: z.string().min(1).max(50_000),
  selectedTables: schemaFields.selectedTables,
}).strict();

export const feedbackRequestSchema = z.object({
  originalQuestion: z.string().trim().min(1).max(8_000),
  generatedSQL: z.string().min(1).max(50_000),
  feedback: z.string().max(4_000).default(""),
  satisfied: z.boolean(),
  ...schemaFields,
}).strict();
