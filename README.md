# pfa

A personal finance assistant for one person, in a UK tax context. It keeps your whole financial picture in one place and lets you ask about it in plain language, with every answer drawn from your own records.

## What it is

pfa is unusual in shape. It is not a website or an app you open. It is an MCP server. You use it through an MCP client (Claude Desktop, ChatGPT, or any client that speaks the Model Context Protocol), which provides the chat and renders the screens. The server holds the logic and the data; the client is the interface.

Everything stays local. All ingested data lands in a SQLite store on the machine that runs the server. Nothing is handed to a third-party finance service.

## What it does

- Net worth: accounts, assets, mortgages, and pensions, with trend over time and projections.
- Cashflow and budgeting: aware of PAYE, National Insurance, pension contributions, and ISA allowances.
- Goals and briefings: set goals such as an emergency fund, maxing an ISA, a house deposit, retirement, or FIRE, then get a briefing on where you stand. Test "what if" scenarios like a bonus or an extra contribution.
- Plain-language questions: ask about your finances and get answers computed from your actual records, not estimated.
- Getting data in: upload payslips and screenshots (read by Claude vision), enter values by hand, or sync connectors for Monzo, an Ethereum wallet, and share and crypto prices.
- Interactive screens: net worth, cashflow, upload, and connectors render as panels inside the client. The same server works in both Claude and ChatGPT, using the open MCP Apps standard with OpenAI Apps compatibility.
- Access: reachable over the internet behind passkey sign-in (OAuth 2.1 and WebAuthn), for a single authorised user.

Two rules run through all of it. Every stored figure traces back to a source document, and money is held as integer pence, never as a floating-point number.

## How it works

The whole app is one MCP server over Streamable HTTP. Writes go through SQLite (better-sqlite3 with Kysely) using forward-only migrations. Natural-language queries run on a DuckDB engine over the same file, restricted to an allow-list of tables. Sensitive data such as connector tokens, passkeys, and OAuth state lives in a separate SQLite file that the query path cannot reach. Claude Haiku does the narrow model work: reading payslips, turning questions into SQL, and classifying goals.

## Tech stack

- TypeScript on Node 22
- Model Context Protocol server, with MCP Apps for the UI surfaces
- SQLite via better-sqlite3 and Kysely for writes, DuckDB for reads
- Express, jose, and SimpleWebAuthn for OAuth 2.1 and passkeys
- React 19 and Vite for the screens
- Anthropic SDK (Claude Haiku) for vision, text-to-SQL, and classification
- Vitest, ESLint, and Prettier

## Running it

You need Node 22. Work from the `server` directory.

```
cd server
npm install
npm run dev
```

That builds the UI in watch mode and starts the server on localhost. Point an MCP client at it to use it.

Other useful commands:

- `npm run dev:auth` runs the full passkey sign-in flow locally.
- `npm run preview:widgets` renders every screen at six widths without needing an MCP host.
- `npm run verify` runs the full gate: typecheck, lint, format check, and tests. CI runs the same thing.

## Hosting

In production it runs as an always-on service on a Mac mini, reachable through an ngrok domain and gated by passkey auth. Host provisioning and the release pipeline live in a separate private repo.

## Scope

One user, UK tax. It reports facts and progress against goals. It does not recommend products, rank options, or move money.
