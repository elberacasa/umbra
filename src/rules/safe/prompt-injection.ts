import path from 'node:path';
import type { Finding, Rule } from '../../engine/types.js';
import { isNonProductionDir, isNonProductionPath } from '../context.js';

const INSTRUCTION_EXT_RE = /\.(md|mdc|txt)$/i;
const AGENT_CONFIG_BASENAMES = new Set(['.cursorrules', 'claude.md', 'agents.md']);
const AGENT_CONFIG_DIR_RE = /(^|\/)(\.cursor|\.windsurf|skills)\//;
const COPILOT_INSTRUCTIONS_RE = /(^|\/)\.github\/copilot-instructions\.md$/i;

/**
 * Agent configuration is production no matter where it sits: an instruction
 * file an agent reads at runtime is attack surface even though it is a *.md
 * (which the generic suppression treats as documentation).
 */
function isAgentConfigPath(relPath: string): boolean {
  if (AGENT_CONFIG_BASENAMES.has(path.basename(relPath).toLowerCase())) return true;
  return AGENT_CONFIG_DIR_RE.test(relPath) || COPILOT_INSTRUCTIONS_RE.test(relPath);
}

/** Files that can carry instructions an agent will read and act on. */
function isInstructionFile(relPath: string): boolean {
  if (INSTRUCTION_EXT_RE.test(relPath)) return true;
  if (path.basename(relPath) === '.cursorrules') return true;
  return AGENT_CONFIG_DIR_RE.test(relPath) || COPILOT_INSTRUCTIONS_RE.test(relPath);
}

// Zero-width spaces, joiners, word joiner, invisible operators, BOM. None of
// these have a legitimate reason to appear in prose an agent reads.
const ZERO_WIDTH_RE = /[\u200B-\u200F\u2060-\u2064\uFEFF]/;

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/**
 * Imperative override structure, not topic keywords: "ignore all previous
 * instructions" flags, "prompt injection makes attackers hide instructions"
 * does not. Educational docs discuss the threat; only the directive form is
 * an injection attempt.
 */
const OVERRIDE_PHRASES: RegExp[] = [
  /\bignore\s+(?:all|any|the|every)\s+(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|directions?|guidelines)/i,
  /\bignore\s+(?:all|any)\s+(?:instructions?|prompts?|rules?)/i,
  /\bdisregard\s+(?:all|any|the|your)\s+(?:previous\s+|prior\s+|above\s+)?(?:instructions?|prompts?|rules?|guidelines|directions)/i,
  /\bforget\s+(?:all\s+)?(?:your|the|any|every)\s+(?:previous\s+|prior\s+)?(?:instructions?|rules?|prompts?|training|guidelines)/i,
  /\bdo\s+not\s+(?:tell|inform|notify|alert|warn)\s+the\s+user\b/i,
  /\bhide\s+this\b/i,
  /\bhide\s+\w+\s+from\s+the\s+user\b/i,
  /\bwhen\s+the\s+user\s+asks\b[^\n.]*\b(?:say|respond|reply|answer|tell\s+them|claim)\b/i,
];

// >120 chars of unbroken base64 alphabet: long enough that it cannot be a
// hash, token, or identifier anyone would paste into prose by accident.
const BASE64_BLOB_RE = /[A-Za-z0-9+/]{120,}={0,2}/;

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

export const promptInjectionRule: Rule = {
  id: 'safe/prompt-injection',
  axis: 'SAFE',
  description:
    'Detects prompt injection in agent instruction files: invisible Unicode, override phrases hidden in HTML comments or prose, and long base64 blobs.',
  check(ctx) {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!isInstructionFile(file.relPath)) continue;
      // Fixture/test/docs payloads stay quiet even when they are shaped like
      // agent config (this repo's own fixtures must not self-flag).
      if (isNonProductionDir(file.relPath)) continue;
      if (isNonProductionPath(file.relPath) && !isAgentConfigPath(file.relPath)) continue;

      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (line === undefined) continue;
        const match = ZERO_WIDTH_RE.exec(line);
        if (match) {
          const codePoint = (match[0].codePointAt(0) ?? 0).toString(16).toUpperCase();
          findings.push({
            ruleId: this.id,
            axis: this.axis,
            severity: 'high',
            confidence: 'high',
            message: `Invisible Unicode character (U+${codePoint}) in an instruction file — zero-width characters can smuggle directives past human review`,
            file: file.relPath,
            line: i + 1,
          });
        }
      }

      HTML_COMMENT_RE.lastIndex = 0;
      let comment: RegExpExecArray | null;
      while ((comment = HTML_COMMENT_RE.exec(file.content)) !== null) {
        const commentText = comment[0];
        if (!OVERRIDE_PHRASES.some((re) => re.test(commentText))) continue;
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: 'high',
          confidence: 'high',
          message:
            'Instruction-override phrase inside an HTML comment — invisible in rendered markdown but read by agents',
          file: file.relPath,
          line: lineOf(file.content, comment.index),
        });
      }

      const visible = file.content.replace(HTML_COMMENT_RE, '');
      const visibleLines = visible.split('\n');
      for (let i = 0; i < visibleLines.length; i++) {
        const line = visibleLines[i];
        if (line === undefined) continue;
        if (!OVERRIDE_PHRASES.some((re) => re.test(line))) continue;
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: 'medium',
          confidence: 'medium',
          message:
            'Instruction-override phrase in prose — educational docs discuss these, but verify it is not an injected directive',
          file: file.relPath,
          line: i + 1,
        });
      }

      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i];
        if (line === undefined) continue;
        if (!BASE64_BLOB_RE.test(line)) continue;
        findings.push({
          ruleId: this.id,
          axis: this.axis,
          severity: 'low',
          confidence: 'low',
          message:
            'Long base64 blob in an instruction file — decode it before trusting the file; encoded payloads can hide instructions from review',
          file: file.relPath,
          line: i + 1,
        });
        break; // one note per file
      }
    }

    return findings;
  },
};
