import type { Finding, Rule } from '../../engine/types.js';
import { isNonProductionPath } from '../context.js';

const SCANNED_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|sql|sh|py|rb|env)$/;
const ENV_TEMPLATE_RE = /^\.env\.(example|sample|template)$/;
const SEED_CONFIG_PATH_RE = /(seed|config|fixture|setup|init|migration|script)/i;

const WEAK_LITERALS = [
  'admin',
  'password',
  'changeme',
  'change_me',
  'admin123',
  'letmein',
  'welcome1',
  'qwerty',
  '123456',
  '12345678',
];
const WEAK_LITERAL_RE = /^(?:admin|password|changeme|change_me|admin123|letmein|welcome1|qwerty|123456|12345678)$/i;

const PASSWORD_ASSIGN_RE = /(?:password|passwd|pwd)["']?\s*[:=]\s*['"]([^'"]+)['"]/i;
const ENV_ASSIGN_RE = /(?:PASSWORD|PASSWD|PWD)\s*=\s*(\S+)\s*$/;
const CONNECTION_STRING_RE = /:\/\/([A-Za-z0-9_-]{1,32}):([^@\s/'"]{1,64})@/;

function isWeakPair(user: string, password: string): boolean {
  return WEAK_LITERAL_RE.test(password) || user.toLowerCase() === password.toLowerCase();
}

export const defaultCredentialsRule: Rule = {
  id: 'safe/default-credentials',
  axis: 'SAFE',
  description:
    'Detects default or weak credential literals (admin/admin, password, changeme) in seed and config files, and default credentials inside connection strings.',
  check(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      const base = file.relPath.split('/').pop() ?? file.relPath;
      const isEnvFile = base.startsWith('.env');
      if (!SCANNED_FILE_RE.test(file.relPath) && !isEnvFile) continue;
      if (isNonProductionPath(file.relPath)) continue;
      if (ENV_TEMPLATE_RE.test(base)) continue;

      const inSeedOrConfig = SEED_CONFIG_PATH_RE.test(file.relPath);
      let passwordReported = false;
      let connReported = false;

      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (line === undefined) continue;

        if (!passwordReported) {
          const assignMatch = PASSWORD_ASSIGN_RE.exec(line);
          if (assignMatch && assignMatch[1] !== undefined && WEAK_LITERAL_RE.test(assignMatch[1])) {
            findings.push({
              ruleId: this.id,
              axis: this.axis,
              severity: 'high',
              confidence: inSeedOrConfig ? 'high' : 'medium',
              message: `Default/weak credential literal '${assignMatch[1]}' assigned as a password`,
              file: file.relPath,
              line: i + 1,
            });
            passwordReported = true;
          } else if (isEnvFile) {
            const envMatch = ENV_ASSIGN_RE.exec(line);
            if (envMatch && envMatch[1] !== undefined && WEAK_LITERAL_RE.test(envMatch[1])) {
              findings.push({
                ruleId: this.id,
                axis: this.axis,
                severity: 'high',
                confidence: 'high',
                message: `Default/weak credential '${envMatch[1]}' in committed environment file`,
                file: file.relPath,
                line: i + 1,
              });
              passwordReported = true;
            }
          }
        }

        if (!connReported) {
          const connMatch = CONNECTION_STRING_RE.exec(line);
          if (
            connMatch &&
            connMatch[1] !== undefined &&
            connMatch[2] !== undefined &&
            isWeakPair(connMatch[1], connMatch[2])
          ) {
            findings.push({
              ruleId: this.id,
              axis: this.axis,
              severity: 'high',
              confidence: 'high',
              message: `Connection string uses default credentials (${connMatch[1]}:${connMatch[2]})`,
              file: file.relPath,
              line: i + 1,
            });
            connReported = true;
          }
        }
      }
    }

    return findings;
  },
};
