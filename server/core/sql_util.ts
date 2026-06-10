export function toNum(val: unknown): number {
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "number") return val;
  return 0;
}

export function toStr(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (val instanceof Date) return val.toISOString().split("T")[0]!;
  return String(val);
}

export function toStrOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0]!;
  return String(val);
}

export function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date format: "${value}". Expected YYYY-MM-DD.`);
  }
}
