import type { Rule } from '../engine/types.js';
import { hardcodedSecretsRule } from './safe/hardcoded-secrets.js';
import { supabaseAntipatternsRule } from './safe/supabase-antipatterns.js';
import { missingAuthRoutesRule } from './safe/missing-auth-routes.js';
import { injectionSinksRule } from './safe/injection-sinks.js';
import { missingRateLimitRule } from './safe/missing-rate-limit.js';
import { hallucinatedDepsRule } from './safe/hallucinated-deps.js';
import { corsWildcardRule } from './safe/cors-wildcard.js';
import { jwtMisconfigRule } from './safe/jwt-misconfig.js';
import { debugFlagsRule } from './safe/debug-flags.js';
import { exposedSensitiveFilesRule } from './safe/exposed-sensitive-files.js';
import { defaultCredentialsRule } from './safe/default-credentials.js';
import { deadExportsRule } from './clean/dead-exports.js';
import { unusedDepsRule } from './clean/unused-deps.js';
import { largeFilesRule } from './clean/large-files.js';
import { duplicationRule } from './clean/duplication.js';

/**
 * Scopes are annotated here (not in the rule modules) so the guard hot path
 * has a single, reviewable list of what runs inline on every agent write.
 * 'file' rules must be fast, network-free, and correct on a single file.
 */
export const allRules: Rule[] = [
  { ...hardcodedSecretsRule, scope: 'file' },
  { ...injectionSinksRule, scope: 'file' },
  { ...jwtMisconfigRule, scope: 'file' },
  { ...corsWildcardRule, scope: 'file' },
  { ...debugFlagsRule, scope: 'file' },
  { ...defaultCredentialsRule, scope: 'file' },
  { ...supabaseAntipatternsRule, scope: 'repo' },
  { ...missingAuthRoutesRule, scope: 'repo' },
  { ...missingRateLimitRule, scope: 'repo' },
  { ...hallucinatedDepsRule, scope: 'repo' },
  { ...exposedSensitiveFilesRule, scope: 'repo' },
  { ...deadExportsRule, scope: 'repo' },
  { ...unusedDepsRule, scope: 'repo' },
  { ...largeFilesRule, scope: 'repo' },
  { ...duplicationRule, scope: 'repo' },
];

/** Rules that run in the inline guard hot path (single-file, <50ms). */
export const fileScopeRules: Rule[] = allRules.filter((rule) => rule.scope === 'file');
