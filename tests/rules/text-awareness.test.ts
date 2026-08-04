import { describe, expect, it } from 'vitest';
import type { Rule, ScannedFile } from '../../src/engine/types';
import { injectionSinksRule } from '../../src/rules/safe/injection-sinks';
import { corsWildcardRule } from '../../src/rules/safe/cors-wildcard';
import { debugFlagsRule } from '../../src/rules/safe/debug-flags';
import { jwtMisconfigRule } from '../../src/rules/safe/jwt-misconfig';
import { defaultCredentialsRule } from '../../src/rules/safe/default-credentials';
import { hardcodedSecretsRule } from '../../src/rules/safe/hardcoded-secrets';

function ctxWith(relPath: string, content: string, extra: ScannedFile[] = []) {
  const file: ScannedFile = { relPath, absPath: `/${relPath}`, content, lines: content.split('\n') };
  return { root: '/', files: [file, ...extra], options: {} };
}

async function check(rule: Rule, relPath: string, content: string, extra: ScannedFile[] = []) {
  return rule.check(ctxWith(relPath, content, extra));
}

describe('comment/doc-text awareness', () => {
  it('injection-sinks ignores eval() in line comments, strings, and regex source', async () => {
    const content = [
      '// never use eval() or new Function() here',
      "const msg = 'always parameterize; never eval() input';",
      'const EVAL_RE = /(?<![\\w$.])eval\\s*\\(/;',
      'export const ok = 1;',
    ].join('\n');
    expect(await check(injectionSinksRule, 'src/util.ts', content)).toEqual([]);
  });

  it('injection-sinks still fires on a real eval() call and real SQL interpolation', async () => {
    const content = [
      'export function run(script: string) {',
      '  return eval(script);',
      '}',
      'export async function find(db: any, id: string) {',
      '  return db.query(`SELECT * FROM users WHERE id = ${id}`);',
      '}',
    ].join('\n');
    const findings = await check(injectionSinksRule, 'src/util.ts', content);
    expect(findings.some((f) => f.message.startsWith('eval()') && f.line === 2)).toBe(true);
    expect(findings.some((f) => f.message.includes('template-string interpolation'))).toBe(true);
  });

  it('debug-flags ignores "debug: true" inside a message string', async () => {
    const content = "export const MSG = 'debug: true committed in source is risky';\n";
    expect(await check(debugFlagsRule, 'src/msg.ts', content)).toEqual([]);
  });

  it('debug-flags still fires on a real debug flag, and on JSON config', async () => {
    const code = await check(debugFlagsRule, 'src/config.ts', 'export const opts = { debug: true };\n');
    expect(code.some((f) => f.message.includes('debug: true'))).toBe(true);
    const json = await check(debugFlagsRule, 'config.json', '{ "debug": true }\n');
    expect(json.some((f) => f.message.includes('debug: true'))).toBe(true);
  });

  it('cors-wildcard ignores bare cors() mentioned in prose but fires on the real call', async () => {
    const authFile: ScannedFile = {
      relPath: 'src/auth.ts',
      absPath: '/src/auth.ts',
      content: 'export const pw = "password";\n',
      lines: ['export const pw = "password";'],
    };
    const prose = "// cors() with no options reflects any origin\nexport const x = 1;\n";
    expect(await check(corsWildcardRule, 'src/app.ts', prose, [authFile])).toEqual([]);
    const real = "import cors from 'cors';\napp.use(cors());\n";
    const findings = await check(corsWildcardRule, 'src/app.ts', real, [authFile]);
    expect(findings.some((f) => f.message.includes('cors() with no options'))).toBe(true);
  });

  it('jwt-misconfig ignores jwt.verify( in comments but fires on real calls', async () => {
    const prose = [
      'import jwt from \'jsonwebtoken\';',
      '// jwt.verify(token) without an allowlist is risky',
      'export const x = 1;',
    ].join('\n');
    expect(await check(jwtMisconfigRule, 'src/a.ts', prose)).toEqual([]);

    const real = [
      'import jwt from \'jsonwebtoken\';',
      'export function check(token: string) {',
      '  return jwt.verify(token, process.env.SECRET!);',
      '}',
    ].join('\n');
    const findings = await check(jwtMisconfigRule, 'src/a.ts', real);
    expect(findings.some((f) => f.message.includes('algorithms allowlist'))).toBe(true);
  });

  it('default-credentials ignores commented-out assignments', async () => {
    const content = [
      "// seed with password: 'admin' when bootstrapping",
      'export const x = 1;',
    ].join('\n');
    expect(await check(defaultCredentialsRule, 'src/seed.ts', content)).toEqual([]);
  });

  it('downgrades confidence one level when the masker cannot parse the file', async () => {
    // Unterminated string literal: the masker bails on that line, keeps the
    // rest of the file visible, and marks the mask incomplete — the eval()
    // after it is kept (conservative) but downgraded high → medium.
    const content = "const broken = 'oops;\neval(input);\n";
    const findings = await check(injectionSinksRule, 'src/x.ts', content);
    const hit = findings.find((f) => f.message.startsWith('eval()'));
    expect(hit).toBeDefined();
    expect(hit?.confidence).toBe('medium');
  });
});

describe('documentation example secret allowlist', () => {
  it('suppresses the canonical Stripe/AWS docs keys, even in production paths', async () => {
    const content = [
      "const stripe = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc'; // Stripe docs example",
      "const aws = 'AKIAIOSFODNN7EXAMPLE'; // AWS docs example",
    ].join('\n');
    expect(await check(hardcodedSecretsRule, 'src/keys.ts', content)).toEqual([]);
  });

  it('still fires on a real key in the same file as a docs key', async () => {
    const content = [
      "const docs = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc';",
      "const real = 'ghp_RealKeyNotFromDocs1234567890abcdefabcd';",
    ].join('\n');
    const findings = await check(hardcodedSecretsRule, 'src/keys.ts', content);
    expect(findings.some((f) => f.message.includes('GitHub personal access token') && f.line === 2)).toBe(true);
  });

  it('still fires on docs keys under non-production paths (medium confidence)', async () => {
    // Fixtures and tests use the docs key as a payload stand-in; the
    // allowlist is production-only so those tests remain possible.
    const content = "export const stripeKey = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc';\n";
    const findings = await check(hardcodedSecretsRule, 'tests/keys.ts', content);
    const hit = findings.find((f) => f.message.includes('Stripe live secret key'));
    expect(hit).toBeDefined();
    expect(hit?.confidence).toBe('medium');
  });
});
