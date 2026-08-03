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

export const allRules: Rule[] = [
  hardcodedSecretsRule,
  supabaseAntipatternsRule,
  missingAuthRoutesRule,
  injectionSinksRule,
  missingRateLimitRule,
  hallucinatedDepsRule,
  corsWildcardRule,
  jwtMisconfigRule,
  debugFlagsRule,
  exposedSensitiveFilesRule,
  defaultCredentialsRule,
  deadExportsRule,
  unusedDepsRule,
  largeFilesRule,
  duplicationRule,
];
