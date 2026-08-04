import type { Finding, Rule } from '../../engine/types.js';
import { isNonProductionPath } from '../context.js';
import { downgradeConfidence, maskCommentsAndRegex, maskNonCode } from '../text.js';

const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/;
const JS_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const DEBUG_TRUE_RE = /(?<![\w$.])["']?debug["']?\s*:\s*true\b/;
const NODE_ENV_RE = /\bNODE_ENV\b/;
const NON_PROD_RE = /(?:!==|!=)\s*['"`](?:production|prod)['"`]|(?:===|==)\s*['"`](?:development|dev|test)['"`]/;
const RETURN_TRUE_RE = /\breturn\s+true\b/;
const CALL_NEXT_RE = /\breturn\s+next\s*\(|\bnext\s*\(\s*\)/;
const AUTH_CONTEXT_RE = /auth|login|session|token|guard|middleware/i;
const BYPASS_WORD_RE = /bypass|skip[-_ ]?auth/i;
const STACK_RE = /\b(?:err|error)\.stack\b/;
const RESPONSE_SEND_RE = /\b(?:res|reply|response)\b[^\n]*\.(?:json|send|sendStatus|end|write)\s*\(/;
const ERROR_MIDDLEWARE_RE =
  /\(\s*(?:err|error)\w*(?:\s*:\s*[^,)]+)?\s*,\s*\w+(?:\s*:\s*[^,)]+)?\s*,\s*\w+(?:\s*:\s*[^,)]+)?\s*,\s*\w+/;
const STACK_PROPERTY_RE = /\bstack\s*:\s*\w*(?:err|error)\w*\.stack\b/;

export const debugFlagsRule: Rule = {
  id: 'safe/debug-flags',
  axis: 'SAFE',
  description:
    'Detects debug flags left enabled, NODE_ENV checks that bypass auth outside production, and error handlers that leak stack traces to clients.',
  check(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!CODE_FILE_RE.test(file.relPath)) continue;
      if (isNonProductionPath(file.relPath)) continue;

      // Two masked views (JSON has no comments and its strings are the data,
      // so JSON is matched raw):
      // - text: comments/regex masked, strings visible — for the NODE_ENV
      //   check, whose pattern includes the 'production' string literal.
      // - code: strings also masked — for debug:true and err.stack, where a
      //   hit inside a message string is prose, not a flag.
      const isJs = JS_FILE_RE.test(file.relPath);
      const text = isJs ? maskCommentsAndRegex(file.content) : undefined;
      const code = isJs ? maskNonCode(file.content) : undefined;
      const textLines = text !== undefined ? text.text.split('\n') : file.lines;
      const codeLines = code !== undefined ? code.text.split('\n') : file.lines;
      const textConfident = text === undefined || text.complete;
      const codeConfident = code === undefined || code.complete;

      const hasErrorMiddleware = ERROR_MIDDLEWARE_RE.test(code?.text ?? file.content);
      let debugReported = false;
      let envBypassReported = false;
      let stackReported = false;

      for (let i = 0; i < file.lines.length; i++) {
        const textLine = textLines[i];
        const codeLine = codeLines[i];
        if (textLine === undefined || codeLine === undefined) continue;

        if (!debugReported && DEBUG_TRUE_RE.test(codeLine)) {
          findings.push({
            ruleId: this.id,
            axis: this.axis,
            severity: 'medium',
            confidence: codeConfident ? 'medium' : downgradeConfidence('medium'),
            message: 'debug: true committed in source — verbose logging/errors may leak internals in production',
            file: file.relPath,
            line: i + 1,
          });
          debugReported = true;
        }

        if (!envBypassReported && NODE_ENV_RE.test(textLine) && NON_PROD_RE.test(textLine)) {
          const windowLines = textLines.slice(i, i + 3);
          const window = windowLines.join('\n');
          const returnsTrue = RETURN_TRUE_RE.test(window);
          const callsNext = CALL_NEXT_RE.test(window);
          const authContext = AUTH_CONTEXT_RE.test(file.relPath) || AUTH_CONTEXT_RE.test(window);
          if (returnsTrue || (callsNext && authContext)) {
            findings.push({
              ruleId: this.id,
              axis: this.axis,
              severity: 'high',
              confidence: textConfident ? 'high' : downgradeConfidence('high'),
              message:
                'NODE_ENV check bypasses the auth path outside production — a misconfigured environment disables authentication',
              file: file.relPath,
              line: i + 1,
            });
            envBypassReported = true;
          } else if (callsNext || BYPASS_WORD_RE.test(window)) {
            findings.push({
              ruleId: this.id,
              axis: this.axis,
              severity: 'medium',
              confidence: textConfident ? 'medium' : downgradeConfidence('medium'),
              message:
                'NODE_ENV check short-circuits a middleware path outside production — verify it cannot disable security controls',
              file: file.relPath,
              line: i + 1,
            });
            envBypassReported = true;
          }
        }

        if (!stackReported && STACK_RE.test(codeLine)) {
          const previous = i > 0 ? codeLines[i - 1] : undefined;
          const sendsStack =
            RESPONSE_SEND_RE.test(codeLine) ||
            (previous !== undefined && /(?:res|reply|response)\.status\s*\(\s*$/.test(previous)) ||
            (hasErrorMiddleware && STACK_PROPERTY_RE.test(codeLine));
          if (sendsStack) {
            findings.push({
              ruleId: this.id,
              axis: this.axis,
              severity: 'high',
              confidence: codeConfident ? 'high' : downgradeConfidence('high'),
              message:
                'Error handler sends err.stack to the client — stack traces leak file paths, dependencies and internals',
              file: file.relPath,
              line: i + 1,
            });
            stackReported = true;
          }
        }
      }
    }

    return findings;
  },
};
