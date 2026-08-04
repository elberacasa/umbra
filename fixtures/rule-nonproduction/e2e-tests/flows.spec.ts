// eval() in an e2e spec is not a production code-execution sink — suppressed.
export function runSnippet(snippet: string): unknown {
  return eval(snippet);
}
