import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { GOAL_TYPES } from "./catalog.js";

const CLASSIFY_SYSTEM_PROMPT = `You classify a user's stated financial goal onto one goal type from a fixed catalog. Choose the single best match. Do not invent goal types outside the list. If the text does not clearly express a financial goal, pick the closest type but return a low confidence.

Goal types:
- emergency_fund: building a safety net of accessible savings (rainy-day fund, months of expenses set aside).
- isa_max: using the annual ISA allowance.
- fire: financial independence and/or retiring early.
- house_deposit: saving for a property deposit.
- debt_payoff: clearing debts (credit cards, loans).
- retirement: a comfortable retirement at or around normal retirement age.`;

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_goal",
  description: "Record the classified goal type and confidence.",
  input_schema: {
    type: "object",
    properties: {
      goal_type: {
        type: "string",
        enum: [...GOAL_TYPES],
        description: "The single best-matching goal type from the catalog.",
      },
      confidence: {
        type: "number",
        description: "Confidence from 0 to 1 that this classification is correct.",
      },
    },
    required: ["goal_type", "confidence"],
  },
};

const ClassificationSchema = z.object({
  goal_type: z.enum(GOAL_TYPES),
  confidence: z.number().min(0).max(1),
});

export type Classification = z.infer<typeof ClassificationSchema>;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function classifyGoal(utterance: string): Promise<Classification> {
  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    temperature: 0,
    system: CLASSIFY_SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_goal" },
    messages: [{ role: "user", content: utterance }],
  });

  const toolBlock = response.content.find((c) => c.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Haiku did not return a tool_use block.");
  }

  const result = ClassificationSchema.safeParse(toolBlock.input);
  if (!result.success) {
    throw new Error(`Haiku classification failed validation: ${result.error.message}`);
  }

  return result.data;
}
