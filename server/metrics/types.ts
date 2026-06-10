export type MetricValue = {
  metric: string;
  resolved: boolean;
  value: number | null;
  unit: "pence" | "months";
  detail: Record<string, number | string>;
  gap_reason?: string;
};
