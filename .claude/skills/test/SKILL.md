---
name: test
description: |
  Write or run tests that verify behavior, not implementation. Use after /implement or /refine, when the user asks "does this actually work?", or before marking a feature done. Trigger on phrases like: "write tests", "test this", "verify this works", "does this work?", "add tests for", "check the behavior of". Tests should be deterministic and cover contracts (inputs → outputs, side effects), not internal steps.
---

# /test

Write or run tests that verify behavior, not implementation.

## When to use
- After /implement or /refine
- When the user asks "does this actually work?"
- Before marking a feature done

## Process

1. **Identify what behavior matters.** Read the plan's test signal. If no plan exists, ask: "what should a user be able to do or see?"

2. **Write tests at the right level:**
   - Unit: pure functions with non-trivial logic
   - Integration: code that crosses a boundary (DB, API, file system)
   - End-to-end: critical user paths only — not every feature
   - Don't test framework behavior or language internals

3. **Run the tests.** Report pass/fail directly. If failing, diagnose before asking the user anything.

4. **Name gaps, don't fill them speculatively.** If an edge case isn't tested but matters, say so. Don't write tests for hypothetical scenarios.

## Rules
- Tests must be deterministic — no random data, no time-sensitive assertions without mocking
- No test that exists only to hit a coverage number
- Test the contract (inputs → outputs, side effects), not the internal steps
- If a test requires more setup than the thing being tested, the code is probably structured wrong — flag it
- Failing tests are information. Don't delete them to make the suite green
