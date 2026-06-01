import type Database from "better-sqlite3";

const UP = `
ALTER TABLE account_balances ADD COLUMN superseded_by INTEGER REFERENCES account_balances(id);
ALTER TABLE pension_values ADD COLUMN superseded_by INTEGER REFERENCES pension_values(id);
ALTER TABLE mortgage_balance ADD COLUMN superseded_by INTEGER REFERENCES mortgage_balance(id);
ALTER TABLE holdings ADD COLUMN superseded_by INTEGER REFERENCES holdings(id);
ALTER TABLE person_profile ADD COLUMN superseded_by INTEGER REFERENCES person_profile(id);
ALTER TABLE transactions ADD COLUMN superseded_by INTEGER REFERENCES transactions(id);
ALTER TABLE income_events ADD COLUMN superseded_by INTEGER REFERENCES income_events(id);
ALTER TABLE equity_vesting_event ADD COLUMN superseded_by INTEGER REFERENCES equity_vesting_event(id);
ALTER TABLE asset_prices ADD COLUMN superseded_by INTEGER REFERENCES asset_prices(id);
ALTER TABLE equity_grant ADD COLUMN superseded_by INTEGER REFERENCES equity_grant(id);
`;

const DOWN = `
ALTER TABLE equity_grant DROP COLUMN superseded_by;
ALTER TABLE asset_prices DROP COLUMN superseded_by;
ALTER TABLE equity_vesting_event DROP COLUMN superseded_by;
ALTER TABLE income_events DROP COLUMN superseded_by;
ALTER TABLE transactions DROP COLUMN superseded_by;
ALTER TABLE person_profile DROP COLUMN superseded_by;
ALTER TABLE holdings DROP COLUMN superseded_by;
ALTER TABLE mortgage_balance DROP COLUMN superseded_by;
ALTER TABLE pension_values DROP COLUMN superseded_by;
ALTER TABLE account_balances DROP COLUMN superseded_by;
`;

export function up(db: Database.Database): void {
  db.exec(UP);
}

export function down(db: Database.Database): void {
  db.exec(DOWN);
}
