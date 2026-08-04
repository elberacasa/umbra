import type { Finding, Rule } from '../../engine/types.js';
import { isNonProductionPath } from '../context.js';
import { downgradeConfidence, maskCommentsAndRegex, maskNonCode } from '../text.js';

const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const CONFIG_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|yml|yaml)$/;
const WILDCARD_ORIGIN_RE = /Access-Control-Allow-Origin['"`]?\s*[:,=]\s*['"`]?\*/;
const ORIGIN_OPTION_RE = /(?<![\w$.])origin\s*:\s*['"`]\s*\*\s*['"`]/;
const CREDENTIALS_RE = /(?:Access-Control-Allow-Credentials|credentials)['"`]?\s*[:,=]\s*['"`]?true\b/i;
const AUTH_HEADERS_RE = /(?:Access-Control-Allow-Headers|allowedHeaders)['"`]?\s*[:,=]\s*[^\n]*authorization/i;
const BARE_CORS_RE = /(?<![\w$.])cors\s*\(\s*\)/;
const AUTH_ROUTE_PATH_RE = /(auth|login|signin|sign-in|session|token)/i;
const AUTH_CONTENT_RE =
  /jwt\.(?:verify|sign)\s*\(|requireAuth|authenticate\s*\(|authorization|['"`]\/[^'"`]*(?:auth|login|signin|sign-in|session)\b|\bpassword\b/i;

export const corsWildcardRule: Rule = {
  id: 'safe/cors-wildcard',
  axis: 'SAFE',
  description:
    'Detects wildcard CORS origins combined with credentials or auth headers, and bare cors() in apps that have auth routes.',
  check(ctx) {
    const findings: Finding[] = [];

    const hasAuthSurface = ctx.files.some(
      (file) =>
        AUTH_ROUTE_PATH_RE.test(file.relPath) ||
        (CODE_FILE_RE.test(file.relPath) && AUTH_CONTENT_RE.test(file.content)),
    );

    for (const file of ctx.files) {
      if (!CONFIG_FILE_RE.test(file.relPath)) continue;
      if (isNonProductionPath(file.relPath)) continue;

      // Header names and origin values live inside string literals, so those
      // patterns match text with only comments and regex source masked. The
      // bare cors() call is code — match it against fully masked text so
      // prose like "bare cors() in apps with auth" cannot fire.
      const isCodeFile = CODE_FILE_RE.test(file.relPath);
      const text = maskCommentsAndRegex(file.content);
      const code = isCodeFile ? maskNonCode(file.content) : undefined;
      const textLines = text.text.split('\n');
      const codeLines = code?.text.split('\n');

      let wildcardLine = -1;
      let hasCredentials = false;
      let hasAuthHeaders = false;
      let bareCorsLine = -1;

      for (let i = 0; i < file.lines.length; i++) {
        const line = textLines[i];
        if (line === undefined) continue;

        if (wildcardLine === -1 && (WILDCARD_ORIGIN_RE.test(line) || ORIGIN_OPTION_RE.test(line))) {
          wildcardLine = i + 1;
        }
        if (!hasCredentials && CREDENTIALS_RE.test(line)) hasCredentials = true;
        if (!hasAuthHeaders && AUTH_HEADERS_RE.test(line)) hasAuthHeaders = true;
        const codeLine = codeLines?.[i];
        if (bareCorsLine === -1 && codeLine !== undefined && BARE_CORS_RE.test(codeLine)) {
          bareCorsLine = i + 1;
        }
      }

      if (wildcardLine !== -1 && hasCredentials) {
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: 'high',
          confidence: text.complete ? 'high' : downgradeConfidence('high'),
          message:
            'Wildcard CORS origin (*) combined with credentials — any website can make authenticated cross-origin requests',
          file: file.relPath,
          line: wildcardLine,
        });
      } else if (wildcardLine !== -1 && hasAuthHeaders) {
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: 'medium',
          confidence: text.complete ? 'medium' : downgradeConfidence('medium'),
          message:
            'Wildcard CORS origin (*) while allowing the Authorization header — any website can call this API with bearer tokens',
          file: file.relPath,
          line: wildcardLine,
        });
      }

      if (bareCorsLine !== -1 && hasAuthSurface) {
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: 'medium',
          confidence: code !== undefined && code.complete ? 'medium' : downgradeConfidence('medium'),
          message:
            'cors() with no options reflects any origin — this app has auth routes, so restrict origins explicitly',
          file: file.relPath,
          line: bareCorsLine,
        });
      }
    }

    return findings;
  },
};
