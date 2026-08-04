import type { Finding, Rule } from '../../engine/types.js';
import { isNonProductionPath } from '../context.js';

const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const JWT_LIB_RE = /from\s+['"]jsonwebtoken['"]|require\(\s*['"]jsonwebtoken['"]\s*\)/;
const VERIFY_RE = /\bjwt\.verify\s*\(/g;
const SIGN_RE = /\bjwt\.sign\s*\(/g;
const DECODE_RE = /(?<![\w$.])jwt\.decode\s*\(/;
const AUTHZ_KEYWORD_RE = /\b(?:role|isAdmin|permissions?|scopes?)\b/;

/** Extracts a call expression starting at the index of its opening paren. */
function extractCall(content: string, openParenIndex: number): string {
  let depth = 0;
  let out = '';
  const end = Math.min(content.length, openParenIndex + 2000);
  for (let i = openParenIndex; i < end; i++) {
    const ch = content[i];
    if (ch === undefined) break;
    out += ch;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  return out;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

export const jwtMisconfigRule: Rule = {
  id: 'safe/jwt-misconfig',
  axis: 'SAFE',
  description:
    'Detects jsonwebtoken misuse: alg "none", missing algorithms allowlist, tokens signed without expiry, and jwt.decode() used for authorization.',
  check(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!CODE_FILE_RE.test(file.relPath)) continue;
      if (isNonProductionPath(file.relPath)) continue;
      if (!JWT_LIB_RE.test(file.content)) continue;

      VERIFY_RE.lastIndex = 0;
      let verifyMatch: RegExpExecArray | null;
      while ((verifyMatch = VERIFY_RE.exec(file.content)) !== null) {
        const call = extractCall(file.content, verifyMatch.index + verifyMatch[0].length - 1);
        const line = lineOf(file.content, verifyMatch.index);
        const algorithmsMatch = /algorithms\s*:\s*\[([^\]]*)\]/.exec(call);
        if (algorithmsMatch && /['"]none['"]/i.test(algorithmsMatch[1] ?? '')) {
          findings.push({
            ruleId: this.id,
            axis: this.axis,
            severity: 'critical',
            confidence: 'high',
            message:
              'jwt.verify accepts alg "none" — attackers can forge unsigned tokens and bypass authentication',
            file: file.relPath,
            line,
          });
        } else if (!/algorithms\s*:/.test(call)) {
          findings.push({
            ruleId: this.id,
            axis: this.axis,
            severity: 'high',
            confidence: 'medium',
            message:
              'jwt.verify without an algorithms allowlist — tokens signed with unexpected algorithms may be accepted',
            file: file.relPath,
            line,
          });
        }
      }

      SIGN_RE.lastIndex = 0;
      let signMatch: RegExpExecArray | null;
      while ((signMatch = SIGN_RE.exec(file.content)) !== null) {
        const call = extractCall(file.content, signMatch.index + signMatch[0].length - 1);
        if (!/expiresIn\b|\bexp\b\s*:/.test(call)) {
          findings.push({
            ruleId: this.id,
            axis: this.axis,
            severity: 'medium',
            confidence: 'medium',
            message: 'jwt.sign without expiresIn — tokens never expire and remain valid forever if leaked',
            file: file.relPath,
            line: lineOf(file.content, signMatch.index),
          });
        }
      }

      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (line === undefined || !DECODE_RE.test(line)) continue;

        const assignMatch = /(\w+)\s*=\s*(?:await\s+)?jwt\.decode\s*\(/.exec(line);
        const variable = assignMatch?.[1];
        const windowLines = file.lines.slice(i, i + 8);

        let usedForAuthz = false;
        if (variable === undefined) {
          // inline use: jwt.decode(...) directly inside an expression
          usedForAuthz = AUTHZ_KEYWORD_RE.test(line);
        } else {
          const usageRe = new RegExp(`\\b${variable}\\s*\\??\\.\\s*(?:role|isAdmin|permissions?|scopes?)\\b`);
          usedForAuthz = windowLines.some((l) => l !== undefined && usageRe.test(l));
        }

        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: usedForAuthz ? 'high' : 'low',
          confidence: usedForAuthz ? 'high' : 'low',
          message: usedForAuthz
            ? 'jwt.decode() result drives an authorization decision — decode does not verify the signature, so forged tokens pass'
            : 'jwt.decode() does not verify the token signature — confirm it is never used for authorization',
          file: file.relPath,
          line: i + 1,
        });
      }
    }

    return findings;
  },
};
