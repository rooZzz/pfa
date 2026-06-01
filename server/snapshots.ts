export type SqlFragment = { sql: string; params: unknown[] };

export function latestRangeSnapshot(
  table: string,
  partitionBy: string,
  columns: string[],
  asOf: string,
): SqlFragment {
  return {
    sql: `SELECT DISTINCT ON (${partitionBy}) ${columns.join(", ")}
      FROM ${table}
      WHERE valid_from <= CAST(? AS DATE)
        AND (valid_to IS NULL OR valid_to > CAST(? AS DATE))
        AND superseded_by IS NULL
      ORDER BY ${partitionBy}, valid_from DESC, recorded_at DESC, id DESC`,
    params: [asOf, asOf],
  };
}

export function latestPriceTick(
  columns: string[],
  asOf: string,
  extraWhere?: SqlFragment,
): SqlFragment {
  const extra = extraWhere ? ` AND ${extraWhere.sql}` : "";
  return {
    sql: `SELECT DISTINCT ON (ap.asset_id) ${columns.join(", ")}
      FROM pfa.asset_prices ap
      JOIN pfa.assets a ON a.id = ap.asset_id
      WHERE ap.as_of <= CAST(? AS TIMESTAMP)${extra}
        AND ap.superseded_by IS NULL
      ORDER BY ap.asset_id, ap.as_of DESC, ap.recorded_at DESC, ap.id DESC`,
    params: [`${asOf} 23:59:59`, ...(extraWhere?.params ?? [])],
  };
}

export function inList(column: string, values: number[]): SqlFragment {
  const placeholders = values.map(() => "?").join(", ");
  return { sql: `${column} IN (${placeholders})`, params: values };
}
