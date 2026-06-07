export const REAL_RETURN_RATE_BPS = 300;
export const SAFE_WITHDRAWAL_RATE_BPS = 400;

export const PROJECTION_ASSUMPTIONS: string[] = [
  `Figures are in today's money. A single real return of ${(REAL_RETURN_RATE_BPS / 100).toFixed(1)}% per year is assumed on invested assets, net of inflation.`,
  `Pot needed is the target annual income divided by the safe withdrawal rate (${(SAFE_WITHDRAWAL_RATE_BPS / 100).toFixed(1)}% by default). The rate is a planning assumption, not a guarantee.`,
  "Invested assets are the pension, ISA, and non-property holdings. Cash (current and savings) funds the bridge to pension access; it is not counted toward the safe-withdrawal target and is not grown at the assumed return.",
  "State Pension is excluded; including it would lower the private pot needed.",
  "Only pension contributions (from payslips) are projected forward; ISA and other contributions are not modelled.",
];
