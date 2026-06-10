import { describe, expect, it } from "vitest";
import { SERVER_INSTRUCTIONS } from "../mcp/instructions.js";
import { tools } from "../tools/registry.js";

describe("SERVER_INSTRUCTIONS", () => {
  it("is non-empty and under 2048 chars", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(2048);
  });

  it("mentions goals-first rule", () => {
    expect(SERVER_INSTRUCTIONS.toLowerCase()).toContain("goals");
  });

  it("mentions get_briefing", () => {
    expect(SERVER_INSTRUCTIONS).toContain("get_briefing");
  });

  it("mentions observations not advice", () => {
    expect(SERVER_INSTRUCTIONS.toLowerCase()).toContain("observations");
    expect(SERVER_INSTRUCTIONS.toLowerCase()).toContain("advice");
  });
});

describe("tool metadata", () => {
  const READ_ONLY_TOOLS = [
    "get_net_worth",
    "get_cashflow",
    "get_briefing",
    "query_natural_language",
    "propose_goal",
    "open_net_worth",
    "open_cashflow",
    "open_upload",
  ];

  const DESTRUCTIVE_TOOLS = ["reset_schema", "seed_data"];

  for (const name of READ_ONLY_TOOLS) {
    it(`${name} has readOnlyHint: true`, () => {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(true);
    });
  }

  for (const name of DESTRUCTIVE_TOOLS) {
    it(`${name} has destructiveHint: true`, () => {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool?.annotations?.destructiveHint).toBe(true);
    });
  }

  it("every tool has a non-empty description", () => {
    for (const tool of tools) {
      expect(
        tool.description.length,
        `${tool.name} has empty description`,
      ).toBeGreaterThan(0);
    }
  });

  it("every tool description is under 1024 chars", () => {
    for (const tool of tools) {
      expect(
        tool.description.length,
        `${tool.name} description exceeds 1024 chars`,
      ).toBeLessThanOrEqual(1024);
    }
  });

  it("no tool description contains XML angle brackets", () => {
    for (const tool of tools) {
      expect(tool.description, `${tool.name} description contains XML`).not.toMatch(
        /[<>]/,
      );
    }
  });
});
