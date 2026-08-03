---
name: umbra-trust-review
description: Verify AI-generated code before shipping. Run Umbra's Trust Score scan before committing or finishing any coding task, treat findings as blocking issues, and re-scan until clean. Use when finishing a task, before a commit, or when reviewing code written by an agent.
---

# Umbra Trust Review

You wrote this code. Prove it deserves to ship.

Umbra scores a repo 0–100 on two axes: **SAFE** (secrets, injection sinks,
missing authz, hallucinated deps) and **CLEAN** (dead code, unused deps,
mega-files, copy-paste). Every finding has `file:line` evidence and a
confidence level. Only high/medium confidence findings affect the score.

## The rule

Before you commit, open a PR, or declare a task finished:

1. Run the scan:

   ```bash
   npx @elberacasa/umbra .   # or: node /path/to/umbra/dist/cli.js .
   ```

   Use `--offline` if the network is restricted, `--json` if you want to
   parse the report.

2. **Exit code 1 (score < 50) means you are not done.** Do not commit.
   Do not rationalize. Fix the findings.

3. Fix **SAFE** findings first, then **CLEAN**. A leaked secret is a
   breach; dead code is a smell. Order your work accordingly.

4. For every finding, read the `file:line` evidence and fix the root
   cause. Never suppress, delete, or work around the check to raise the
   score — the score is the point.

5. Re-run the scan after every fix round. Loop until the scan passes.

6. If a finding is genuinely a false positive, leave the code alone and
   state, in one sentence with the evidence, why it is a false positive.
   Then continue. Low-confidence notes never block.

## What you may not do

- Do not commit with a failing score.
- Do not mark a task "done" while findings are open.
- Do not claim tests pass, auth works, or secrets are handled unless you
  verified it. Umbra exists because agents claim things that are not true.
  Do not become the evidence for that claim.
- Do not weaken code to dodge a rule (e.g. renaming `eval` usage). Fix it.

## Output

When you finish, report: final score, findings fixed, and any false
positives with your one-sentence justification.
