import { describe, expect, it } from "vitest";
import { aggregateLineItems } from "../cashflow/income.js";

function payload(items: unknown[]): string {
  return JSON.stringify({ line_items: items });
}

describe("aggregateLineItems", () => {
  it("sums amounts by section and description across payslips", () => {
    const payloads = [
      payload([
        { description: "Basic Salary", section: "payment", amount_pence: 620000 },
        { description: "Private Medical", section: "deduction", amount_pence: 4500 },
      ]),
      payload([
        { description: "Basic Salary", section: "payment", amount_pence: 620000 },
        { description: "Private Medical", section: "deduction", amount_pence: 4500 },
      ]),
    ];
    const result = aggregateLineItems(payloads);
    expect(result).toContainEqual({
      description: "Basic Salary",
      section: "payment",
      amount_pence: 1240000,
    });
    expect(result).toContainEqual({
      description: "Private Medical",
      section: "deduction",
      amount_pence: 9000,
    });
  });

  it("keeps same description on different sections separate", () => {
    const result = aggregateLineItems([
      payload([
        { description: "Pension", section: "payment", amount_pence: 1000 },
        { description: "Pension", section: "deduction", amount_pence: 2000 },
      ]),
    ]);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      description: "Pension",
      section: "payment",
      amount_pence: 1000,
    });
    expect(result).toContainEqual({
      description: "Pension",
      section: "deduction",
      amount_pence: 2000,
    });
  });

  it("skips malformed payloads and non-conforming items", () => {
    const result = aggregateLineItems([
      "not json",
      JSON.stringify({ something_else: 1 }),
      payload([
        { description: "Valid", section: "deduction", amount_pence: 500 },
        { description: "No amount", section: "deduction" },
        { description: "Bad section", section: "other", amount_pence: 100 },
        { description: 42, section: "payment", amount_pence: 100 },
        { amount_pence: 3.5, section: "payment", description: "Float" },
      ]),
    ]);
    expect(result).toEqual([
      { description: "Valid", section: "deduction", amount_pence: 500 },
    ]);
  });

  it("preserves negative amounts such as salary-sacrifice payment lines", () => {
    const result = aggregateLineItems([
      payload([
        { description: "SMART MPS AVC", section: "payment", amount_pence: -53008 },
        { description: "SMART MPS AVC", section: "payment", amount_pence: -53008 },
      ]),
    ]);
    expect(result).toEqual([
      { description: "SMART MPS AVC", section: "payment", amount_pence: -106016 },
    ]);
  });

  it("returns an empty array for no payloads", () => {
    expect(aggregateLineItems([])).toEqual([]);
  });
});
