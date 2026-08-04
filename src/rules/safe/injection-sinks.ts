import type { Finding, Rule } from '../../engine/types.js';
import { isNonProductionPath } from '../context.js';
import { downgradeConfidence, maskCommentsAndRegex, maskNonCode } from '../text.js';

const SQL_KEYWORD_RE = /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;

export const injectionSinksRule: Rule = {
  id: 'safe/injection-sinks',
  axis: 'SAFE',
  description:
    'Detects SQL string concatenation with variables, eval()/new Function(), and dangerouslySetInnerHTML with dynamic values.',
  check(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.relPath)) continue;
      // A SQL string in a test, fixture, script, or prompt template is not a
      // reachable injection sink.
      if (isNonProductionPath(file.relPath)) continue;

      // SQL patterns live inside strings/templates, so match them against
      // text with only comments and regex source masked. Call expressions
      // (eval, new Function, JSX sinks) live outside strings — match those
      // against fully masked code so prose like "never use eval()" in a
      // comment or string literal cannot fire.
      const text = maskCommentsAndRegex(file.content);
      const code = maskNonCode(file.content);
      const sqlLines = text.text.split('\n');
      const codeLines = code.text.split('\n');

      let sqlReported = false;
      let evalReported = false;
      let newFunctionReported = false;
      let dhtmlReported = false;

      for (let i = 0; i < file.lines.length; i++) {
        const sqlLine = sqlLines[i];
        const codeLine = codeLines[i];
        if (sqlLine === undefined || codeLine === undefined) continue;

        if (!sqlReported && SQL_KEYWORD_RE.test(sqlLine)) {
          if (/\$\{[^}]+\}/.test(sqlLine)) {
            findings.push({
              ruleId: this.id,
              axis: this.axis,
              severity: 'high',
              confidence: text.complete ? 'high' : downgradeConfidence('high'),
              message: 'SQL query built with template-string interpolation — classic SQL injection sink',
              file: file.relPath,
              line: i + 1,
            });
            sqlReported = true;
          } else if (/['"`]\s*\+\s*\w+|\w+\s*\+\s*['"`]/.test(sqlLine)) {
            findings.push({
              ruleId: this.id,
              axis: this.axis,
              severity: 'high',
              confidence: text.complete ? 'medium' : downgradeConfidence('medium'),
              message: 'SQL query built with string concatenation — possible SQL injection sink',
              file: file.relPath,
              line: i + 1,
            });
            sqlReported = true;
          }
        }

        if (!evalReported && /(?<![\w$.])eval\s*\(/.test(codeLine)) {
          findings.push({
            ruleId: this.id,
            axis: this.axis,
            severity: 'high',
            confidence: code.complete ? 'high' : downgradeConfidence('high'),
            message: 'eval() executes a string as code — arbitrary code execution if any input reaches it',
            file: file.relPath,
            line: i + 1,
          });
          evalReported = true;
        }

        if (!newFunctionReported && /new\s+Function\s*\(/.test(codeLine)) {
          findings.push({
            ruleId: this.id,
            axis: this.axis,
            severity: 'high',
            confidence: code.complete ? 'high' : downgradeConfidence('high'),
            message: 'new Function() compiles a string as code — same risk class as eval()',
            file: file.relPath,
            line: i + 1,
          });
          newFunctionReported = true;
        }

        if (!dhtmlReported) {
          const match = /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:\s*([^}]+)\}/.exec(codeLine);
          if (match && match[1] !== undefined) {
            const value = match[1].trim();
            const isLiteral = /^['"`]/.test(value);
            if (!isLiteral) {
              findings.push({
                ruleId: this.id,
                axis: this.axis,
                severity: 'high',
                confidence: code.complete ? 'medium' : downgradeConfidence('medium'),
                message: `dangerouslySetInnerHTML renders a dynamic value (${value}) — XSS sink unless sanitized`,
                file: file.relPath,
                line: i + 1,
              });
              dhtmlReported = true;
            }
          }
        }
      }
    }

    return findings;
  },
};
