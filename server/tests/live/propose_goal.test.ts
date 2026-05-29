import { describe, expect, it } from "vitest";
import { classifyGoal } from "../../goals/classify.js";

describe("classifyGoal (live Haiku)", () => {
  it("classifies an emergency-fund utterance", async () => {
    const result = await classifyGoal(
      "I want to build up a rainy day fund of a few months of expenses",
    );
    expect(result.goal_type).toBe("emergency_fund");
  }, 30000);

  it("classifies an ISA-allowance utterance", async () => {
    const result = await classifyGoal("I want to use up my ISA allowance this tax year");
    expect(result.goal_type).toBe("isa_max");
  }, 30000);
});
