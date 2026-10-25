import test from "node:test";
import assert from "node:assert/strict";
import { executeRequestSchema, feedbackRequestSchema, generateRequestSchema } from "../lib/api-schemas.js";

test("generation requests validate length, schema mode, and implemented pipeline identifiers", () => {
  assert.equal(generateRequestSchema.parse({ question: "  summarize sales  " }).question, "summarize sales");
  assert.throws(() => generateRequestSchema.parse({ question: " " }));
  assert.throws(() => generateRequestSchema.parse({ question: "run locally", pipeline: "slm_only" }));
  assert.throws(() => generateRequestSchema.parse({ question: "x".repeat(8_001) }));
});

test("execution requests require bounded SQL and accept only declared fields", () => {
  assert.equal(executeRequestSchema.parse({ generatedSQL: "SELECT 1" }).originalQuestion, "");
  assert.throws(() => executeRequestSchema.parse({ generatedSQL: "x".repeat(50_001) }));
  assert.throws(() => executeRequestSchema.parse({ generatedSQL: "SELECT 1", unexpected: "value" }));
});

test("feedback requests are bounded and validate boolean satisfaction", () => {
  assert.equal(feedbackRequestSchema.parse({ originalQuestion: "q", generatedSQL: "SELECT 1", satisfied: true }).feedback, "");
  assert.throws(() => feedbackRequestSchema.parse({ originalQuestion: "q", generatedSQL: "SELECT 1", satisfied: "yes" }));
  assert.throws(() => feedbackRequestSchema.parse({ originalQuestion: "q", generatedSQL: "SELECT 1", satisfied: false, feedback: "x".repeat(4_001) }));
});
