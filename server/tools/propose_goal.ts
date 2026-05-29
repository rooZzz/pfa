import { z } from "zod";
import { classifyGoal } from "../goals/classify.js";
import { needsSpec } from "../goals/catalog.js";

export const proposeGoalSchema = {
  utterance: z
    .string()
    .describe("The user's financial goal stated in their own words, verbatim."),
};

export async function proposeGoal(input: { utterance: string }): Promise<string> {
  const { goal_type, confidence } = await classifyGoal(input.utterance);
  const spec = needsSpec(goal_type);

  return JSON.stringify(
    {
      goal_type,
      confidence,
      supported: spec.supported,
      summary: spec.summary,
      needs_spec: spec.slots,
      raw_utterance: input.utterance,
      next: spec.supported
        ? "Fill the needs_spec slots in conversation, then call confirm_goal with goal_type, the slot values, and raw_utterance."
        : "This goal type is recognised but not yet supported. Do not call confirm_goal.",
    },
    null,
    2,
  );
}
