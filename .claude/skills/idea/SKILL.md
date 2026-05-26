---
name: idea
description: |
  Turn a vague problem or feature into a single, committed direction. Use when the user has a problem but no clear solution, is circling options without deciding, or is starting a new feature or capability. Trigger on phrases like: "I'm thinking about X", "not sure how to approach Y", "what should we do about Z", "help me decide", or any time the user presents a problem without a clear solution direction. This skill produces one committed decision with an explicit scope exclusion — not a list of options left open.
---

# /idea

Turn a vague problem or feature into a single, committed direction.

## When to use
- You have a problem but no clear solution yet
- You're circling the same options and not deciding
- Starting a new feature or capability

## Process

1. **Restate the problem** in one sentence. If the user's framing is vague, sharpen it before proceeding. Confirm with the user if you changed it meaningfully.

2. **Generate exactly 3 options.** Not 2 (false binary), not 5+ (choice overload). Each option gets:
   - A one-line label
   - What it solves
   - Its key tradeoff or constraint

3. **Give a recommendation** with a single reason. Don't hedge.

4. **Force a decision.** Ask the user to pick one. Do not proceed to planning until they do.

5. **Output a committed direction statement:**
   > We will [chosen option] because [reason]. This does NOT include [explicit scope exclusion].

## Rules
- No wireframes, diagrams, or architecture docs at this stage
- If the user asks "what about X?" — acknowledge it, park it, stay on the current decision
- The explicit scope exclusion in the output is mandatory — it prevents scope creep in planning
- Time-box: this should resolve in one exchange, not a thread
