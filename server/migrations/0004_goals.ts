import type Database from "better-sqlite3";

const UP = `
CREATE TABLE IF NOT EXISTS goals (
  id            INTEGER PRIMARY KEY,
  goal_type     TEXT NOT NULL CHECK (goal_type IN ('emergency_fund', 'isa_max', 'fire', 'house_deposit', 'debt_payoff', 'retirement')),
  params        TEXT NOT NULL,
  raw_utterance TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  source_id     INTEGER NOT NULL REFERENCES documents(id),
  recorded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const DOWN = `DROP TABLE IF EXISTS goals;`;

export function up(db: Database.Database): void {
  db.exec(UP);
}

export function down(db: Database.Database): void {
  db.exec(DOWN);
}
