/**
 * Paths that are not production code: tests, fakes, fixtures, benchmarks,
 * scripts, docs, prompt templates, examples. A SQL string in a prompt
 * template or an eval() in a test fixture is not a vulnerability, so SAFE
 * rules suppress findings in these paths entirely (they do not even become
 * notes).
 */
const NON_PRODUCTION_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|\.md$/;
const NON_PRODUCTION_DIR_RE =
  /(^|\/)(__tests__|tests?|testing|e2e[^/]*|benchmarks?|fixtures|scripts|docs|prompts|examples|demos?)(\/|$)/;

export function isNonProductionPath(relPath: string): boolean {
  return NON_PRODUCTION_FILE_RE.test(relPath) || NON_PRODUCTION_DIR_RE.test(relPath);
}
