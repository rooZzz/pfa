---
name: explore
description: |
  Broad landscape survey to get oriented in an unfamiliar space before any specific decision is made. Use when the user wants to understand a topic, technology, or domain at a high level — not to verify a specific claim (use /research for that), but to understand what exists, what matters, what the real tradeoffs are, and what's worth knowing before committing to a direction. Trigger on phrases like: "what's out there for X", "how does X work", "what should I know about X", "give me the lay of the land on X", "what are my options for X", "I know nothing about X", "help me understand X", or any time the user is entering unfamiliar territory and needs to get their bearings before deciding anything.
---

# /explore

Get oriented in an unfamiliar space. Understand the landscape before committing to a direction.

## When to use
- Entering a topic or domain you don't know well
- Before /idea, when you don't yet know enough to generate good options
- When "what are my options?" is itself the question
- When you want a map of the territory, not an answer to a specific question

## How this differs from /research
`/research` verifies specific claims against sources — it's rigorous and narrow.
`/explore` surveys a space broadly — it's opinionated and wide. You're not checking if something is true; you're finding out what's worth checking.

## Process

1. **Understand what's being explored.** Restate the space or question in one sentence. If it's too broad to be useful, narrow it — but don't narrow it into a specific decision yet.

2. **Search widely.** Use `WebSearch` and `WebFetch` across multiple angles:
   - What are the main approaches / tools / patterns in this space?
   - What do practitioners actually use (not just what's theoretically correct)?
   - What are the known failure modes or things people regret?
   - Are there recent shifts — things that used to be true that aren't anymore?

   Don't stop at one angle. Look for the mainstream view, the contrarian view, and the practitioner view.

3. **Synthesise, don't just list.** The output is a map, not a dump. Group what you find into themes. Call out what's settled vs. contested. Flag things that surprised you or that contradict conventional wisdom.

4. **Give a directional recommendation.** Based on what you found, where would you point someone who has to make a decision in this space? Be honest about confidence — some spaces have a clear "this is what thoughtful people do", others are genuinely unsettled.

## Output format

```
## Explore: [space or question]

### The landscape
[2–4 paragraphs covering what exists, what matters, how things are structured.
Not a list of everything — a map of the important terrain.]

### What's settled vs. contested
**Settled**: [things most practitioners agree on]
**Contested**: [things where reasonable people differ, and why]

### What surprised me
[Anything that contradicts the obvious framing, recent shifts, or things
that are commonly believed but worth questioning. Skip if nothing notable.]

### Where I'd point you
**Confidence**: low / medium / high
**Direction**: [one clear recommendation for how to think about or approach this space]
**Why**: [grounded in what was found — not generic advice]
```

## Rules
- Cite sources where they matter, but don't bury the synthesis in footnotes
- Don't pretend confidence you don't have — "this space is genuinely unsettled" is a valid output
- Don't convert this into a /research session — you're mapping, not verifying
- If the space is too broad to survey usefully in one pass, say so and propose a narrower slice
