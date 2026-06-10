import { describe, expect, it } from "vitest";
import { ABSENCE_LABEL, formatGbp, formatGbpk } from "../ui/format.js";

describe("ABSENCE_LABEL", () => {
  it("maps the three absence meanings to their fixed words", () => {
    expect(ABSENCE_LABEL.not_recorded).toBe("not recorded");
    expect(ABSENCE_LABEL.na).toBe("—");
    expect(ABSENCE_LABEL.no_date).toBe("no date");
  });
});

describe("formatGbp", () => {
  it("renders pence as pounds with two fraction digits by default", () => {
    expect(formatGbp(123_456_78)).toBe("£123,456.78");
  });

  it("drops fraction digits when whole is set", () => {
    expect(formatGbp(123_456_78, { whole: true })).toBe("£123,457");
  });

  it("uses a true minus sign for negatives", () => {
    expect(formatGbp(-100)).toBe("−£1.00");
  });
});

describe("formatGbpk", () => {
  it("abbreviates millions to two decimals", () => {
    expect(formatGbpk(1_234_567_00)).toBe("£1.23m");
  });

  it("abbreviates six-figure sums to whole thousands", () => {
    expect(formatGbpk(320_000_00)).toBe("£320k");
  });

  it("abbreviates smaller thousands to one decimal", () => {
    expect(formatGbpk(1_200_00)).toBe("£1.2k");
  });

  it("renders sub-thousand sums whole", () => {
    expect(formatGbpk(750_00)).toBe("£750");
  });
});
