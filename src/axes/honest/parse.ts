export interface TestResults {
  passed: number;
  failed: number;
}

function fromSummaryLine(line: string): TestResults | null {
  const passedMatch = line.match(/(\d+)\s+passed\b/);
  const failedMatch = line.match(/(\d+)\s+failed\b/);
  if (!passedMatch && !failedMatch) return null;
  return {
    passed: passedMatch ? Number.parseInt(passedMatch[1] ?? '0', 10) : 0,
    failed: failedMatch ? Number.parseInt(failedMatch[1] ?? '0', 10) : 0,
  };
}

/**
 * Parses real pass/fail counts from the output of common JS test runners.
 * Returns null when no recognizable summary is present — callers must treat
 * null as "unverifiable", never as "0 passing".
 */
export function parseTestResults(output: string): TestResults | null {
  const lines = output.split('\n');

  // Jest ("Tests: 1 failed, 3 passed, 4 total") and Vitest
  // ("Tests  1 failed | 3 passed (4)") print a summary line mentioning Tests.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    if (/^\s*Tests?:?\s{2,}/.test(line) || /^\s*Tests:\s/.test(line)) {
      const parsed = fromSummaryLine(line);
      if (parsed) return parsed;
    }
  }

  // node:test / TAP summary lines: "# pass 3", "# fail 1".
  let tapPass: number | null = null;
  let tapFail = 0;
  let sawTapSummary = false;
  for (const line of lines) {
    const passMatch = line.match(/^#\s+pass\s+(\d+)\s*$/);
    if (passMatch) {
      tapPass = Number.parseInt(passMatch[1] ?? '0', 10);
      sawTapSummary = true;
    }
    const failMatch = line.match(/^#\s+fail\s+(\d+)\s*$/);
    if (failMatch) {
      tapFail = Number.parseInt(failMatch[1] ?? '0', 10);
      sawTapSummary = true;
    }
  }
  if (sawTapSummary && tapPass !== null) {
    return { passed: tapPass, failed: tapFail };
  }

  // Mocha: "3 passing (12ms)", "1 failing".
  let mochaPassed: number | null = null;
  let mochaFailed = 0;
  for (const line of lines) {
    const passingMatch = line.match(/^\s+(\d+)\s+passing\b/);
    if (passingMatch) mochaPassed = Number.parseInt(passingMatch[1] ?? '0', 10);
    const failingMatch = line.match(/^\s+(\d+)\s+failing\b/);
    if (failingMatch) mochaFailed = Number.parseInt(failingMatch[1] ?? '0', 10);
  }
  if (mochaPassed !== null) {
    return { passed: mochaPassed, failed: mochaFailed };
  }

  // Raw TAP stream without a summary: count ok / not ok result lines.
  let okCount = 0;
  let notOkCount = 0;
  for (const line of lines) {
    if (/^not ok\s+\d+/i.test(line)) notOkCount++;
    else if (/^ok\s+\d+/i.test(line)) okCount++;
  }
  if (okCount + notOkCount > 0) {
    return { passed: okCount, failed: notOkCount };
  }

  return null;
}
