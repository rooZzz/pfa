---
name: research
description: |
  Structured research process for getting genuinely confident in a decision or technical direction before committing to it. Use this skill whenever the user wants to research something, look into an option, verify assumptions, or get confident in a direction before deciding. Trigger on phrases like: "research X", "look into X", "what do we actually know about X", "I need to be sure about X before we decide", "is X actually true?", "can we trust X?", "what's the real story on X?", "before we commit to X", "verify that X". Also use it when the user is about to make a technical or architectural decision and the reasoning relies on claims that could be wrong — even if they don't use these exact phrases. This skill is specifically designed to prevent decisions built on hallucinated facts, stale assumptions, or unexamined conventional wisdom.
---

# Research Skill

The goal here is to reach an *evidence-based* position, not a plausible-sounding one. The whole reason this skill exists is that decisions in this project involve real financial data and real money — and shaky assumptions are dangerous. So the bar is: every meaningful claim must be backed by a real, fetchable source. If it can't be sourced, it gets flagged as unverified, not stated as fact.

## Process

### 1. Decompose the question into claims

Before searching anything, write out:
- The **core question** (what decision is actually being made?)
- The **assumptions** embedded in the question (things that would need to be true for the question to have the answer the user expects)
- The **assertions** to verify (specific factual claims that can be confirmed or refuted)

Be genuinely skeptical here. Surface the things that seem obvious but might not be — those are the ones most worth checking.

### 2. Search for authoritative sources

Use `WebSearch` for each assertion. Prefer:
- Official documentation (library docs, RFC specs, database docs)
- Recent benchmark or test results with methodology
- Primary sources over blog summaries
- Sources from the last 2 years for anything technology-related

Search multiple angles if needed. If the first result doesn't give you the answer, try different search terms. Do not stop at one search result per claim.

### 3. Fetch and read the actual source

Use `WebFetch` to read the page, not just the search snippet. Snippets are often misleading or out of context. Read enough of the source to understand what it's actually claiming, including caveats.

### 4. Assess each claim

For each claim, record:
- **Source**: the URL and what it actually says (quote or close paraphrase)
- **Verdict**: one of `confirmed`, `refuted`, `mixed`, or `unverified`

`unverified` means: searched, couldn't find a source that clearly addresses it. Do not upgrade `unverified` to `confirmed` just because nothing contradicted it.

### 5. Surface what's still uncertain

After assessing all claims, write a section on what remains uncertain or couldn't be sourced. Be honest. A well-researched "we don't know" is more valuable than a confident wrong answer.

### 6. Give a recommendation with a confidence level

Synthesize the evidence into a clear recommendation. Include:
- **Confidence**: `low` / `medium` / `high`
- **Direction**: one clear sentence stating the recommendation
- **Reasoning**: why, grounded in the evidence above

If confidence is low, say so explicitly and explain what additional evidence would be needed to increase it. Don't give a recommendation that the evidence doesn't support.

---

## Output format

Use this structure exactly:

```
## Research: [question]

### Claims to verify
- [claim 1]
- [claim 2]
- ...

### Evidence

**[Claim 1]**
Source: [URL]
Finding: [what the source actually says — quote or close paraphrase]
Verdict: confirmed / refuted / mixed / unverified

**[Claim 2]**
...

### Still uncertain
[Anything that couldn't be sourced or where sources conflicted without resolution. If nothing: "Nothing significant remains unverified."]

### Recommendation
**Confidence**: low / medium / high
**Direction**: [one sentence]
**Reasoning**: [grounded in evidence above]
```

---

## Rules that cannot be bent

- Never state a fact as confirmed without a real source URL. If you can't fetch it, it's unverified.
- Never omit a source you actually read — if it informed your thinking, cite it.
- If sources conflict, report both and explain which you find more credible and why.
- Do not let the user's apparent preference bias the verdict. If they seem to want one answer, that's exactly when to be more rigorous, not less.
- If the question is too broad to research properly in one pass, say so and propose a narrower version.
