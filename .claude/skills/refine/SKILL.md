---
name: refine
description: |
  Improve existing working code without changing what it does. Use after /implement, before considering a feature done, or when something feels off but works. Trigger on phrases like: "clean this up", "this feels messy", "refactor", "simplify", "tidy up", or any time the user wants to improve code quality without adding new behavior. Do NOT trigger for bug fixes (use /implement) or new features (use /idea → /plan → /implement).
---

# /refine

Improve existing code without changing what it does. No new features, no redesigns.

## When to use
- After /implement, before considering a feature done
- When something feels off but you can't name it
- When code works but is harder to read than it should be

## Process

1. **Read the relevant files.** Don't refine from memory.

2. **Look for exactly these issues — nothing else:**
   - Names that don't say what the thing is (variables, functions, files)
   - Logic that's more complex than the problem requires
   - Duplication that isn't serving a purpose
   - Dead code, unused imports, unreachable branches
   - Missing edge case handling at system boundaries (user input, external APIs)

3. **Output specific edits, not observations.** Don't write "this could be cleaner" — make the edit or don't.

4. **State the before/after signal** for any meaningful change: what was confusing, what's clearer now.

## Rules
- Scope is limited to what was recently implemented or explicitly pointed to
- Do not move toward a different architecture — that's a new /idea
- Do not add new functionality — that's a new /plan
- If you find a real bug (not just a code smell), flag it separately and don't bury it in style fixes
- Aim for fewer lines, not more
