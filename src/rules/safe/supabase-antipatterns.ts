import type { Finding, Rule } from '../../engine/types.js';

const SERVICE_ROLE_KEY_RE = /SUPABASE_SERVICE_ROLE_KEY|service_role/;

function isClientSidePath(relPath: string): boolean {
  return (
    /(^|\/)(components?|pages|public|src\/app(?!\/api))\//.test(relPath) ||
    /\.(jsx|tsx)$/.test(relPath)
  );
}

function hasUseClientDirective(content: string): boolean {
  const head = content.slice(0, 200);
  return head.includes("'use client'") || head.includes('"use client"');
}

export const supabaseAntipatternsRule: Rule = {
  id: 'safe/supabase-antipatterns',
  axis: 'SAFE',
  description:
    'Detects Supabase service_role keys reachable from client code and client-side table queries with no RLS policy anywhere in the repo.',
  check(ctx) {
    const findings: Finding[] = [];
    const id = this.id;

    const usesSupabase = ctx.files.some((f) => f.content.includes('@supabase/supabase-js'));
    if (!usesSupabase) return findings;

    // 1. service_role key exposure
    for (const file of ctx.files) {
      if (!SERVICE_ROLE_KEY_RE.test(file.content)) continue;
      const clientSide = isClientSidePath(file.relPath) || hasUseClientDirective(file.content);
      const publicEnv = /NEXT_PUBLIC_[A-Z0-9_]*SERVICE|PUBLIC_[A-Z0-9_]*SERVICE/i.test(file.content);
      if (clientSide || publicEnv) {
        const line = file.lines.findIndex((l) => SERVICE_ROLE_KEY_RE.test(l));
        findings.push({
          ruleId: id,
          axis: this.axis,
          severity: 'critical',
          confidence: 'high',
          message: 'Supabase service_role key reachable from client-side code — full database bypass for anyone who opens the bundle',
          file: file.relPath,
          line: line >= 0 ? line + 1 : 1,
        });
      }
    }

    // 2. client-side table queries with no RLS policy file in the repo
    const hasRlsPolicy = ctx.files.some(
      (f) =>
        f.relPath.endsWith('.sql') &&
        /enable\s+row\s+level\s+security|create\s+policy/i.test(f.content),
    );

    if (!hasRlsPolicy) {
      for (const file of ctx.files) {
        if (!file.content.includes('@supabase/supabase-js')) continue;
        const fromIndex = file.lines.findIndex((l) => /\.from\(\s*['"]/.test(l));
        if (fromIndex < 0) continue;
        findings.push({
          ruleId: id,
          axis: this.axis,
          severity: 'high',
          confidence: 'medium',
          message:
            'Supabase tables queried from client code but no RLS policy (.sql with CREATE POLICY / ROW LEVEL SECURITY) found anywhere in the repo',
          file: file.relPath,
          line: fromIndex + 1,
        });
      }
    }

    return findings;
  },
};
