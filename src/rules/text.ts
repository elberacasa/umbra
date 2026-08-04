import type { Confidence } from '../engine/types.js';

/**
 * Text-awareness for pattern-based SAFE rules: a finding must point at
 * executable code, never at prose about code. These helpers mask the
 * non-executable regions of a source file — line comments, block comments,
 * regex-literal source, and (optionally) string/template contents — replacing
 * them with spaces while preserving length and newlines, so offsets and line
 * numbers from the masked text map 1:1 onto the original.
 */

export interface MaskedSource {
  /** Same length as the input; masked regions are spaces (newlines kept). */
  text: string;
  /**
   * False when the masker hit a construct it could not parse (unterminated
   * string/comment, ambiguous '/') and stopped masking the rest of the file.
   * Callers should keep findings from such files but downgrade confidence one
   * level — a match we cannot prove is code might still be code.
   */
  complete: boolean;
}

/** high → medium → low, for findings in files the masker could not fully parse. */
export function downgradeConfidence(confidence: Confidence): Confidence {
  return confidence === 'high' ? 'medium' : 'low';
}

function mask(content: string, includeStrings: boolean): MaskedSource {
  const chars = content.split('');
  const n = chars.length;
  let complete = true;
  // Last significant code char, for the regex-vs-division heuristic: a '/'
  // after an operand (identifier, number, string, ), ], }) is division, not
  // a regex. Strings are always tracked — even when their contents stay
  // visible — so a '//' or quote inside a string is never misread.
  let lastSignificant = '';
  const OPERAND_END_RE = /[\w)\]$}'"`]/;

  const blank = (from: number, to: number): void => {
    for (let j = from; j < to; j++) {
      if (chars[j] !== '\n') chars[j] = ' ';
    }
  };

  let i = 0;
  while (i < n) {
    const ch = chars[i] as string;
    const next = chars[i + 1];

    if (ch === '/' && next === '/') {
      const start = i;
      while (i < n && chars[i] !== '\n') i++;
      blank(start, i);
      continue;
    }

    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < n && !(chars[i] === '*' && chars[i + 1] === '/')) i++;
      if (i >= n) {
        complete = false;
        blank(start, n);
        break;
      }
      i += 2;
      blank(start, i);
      continue;
    }

    if (ch === '/' && next !== '/' && next !== '*') {
      const prevRaw = i > 0 ? (chars[i - 1] as string) : '';
      // '</' is a JSX closing tag; '/' after an operand is division.
      if (prevRaw === '<' || OPERAND_END_RE.test(lastSignificant)) {
        // Plain code — leave it alone.
      } else {
        const start = i;
        i++;
        let inClass = false;
        let closed = false;
        while (i < n) {
          const c = chars[i] as string;
          if (c === '\\') {
            i += 2;
            continue;
          }
          if (c === '\n') break;
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) {
            closed = true;
            i++;
            break;
          }
          i++;
        }
        if (!closed) {
          // Cannot tell what this '/' is — leave the rest of the file
          // untouched and let callers downgrade what they find there.
          complete = false;
          break;
        }
        while (i < n && /[a-z]/i.test(chars[i] as string)) i++; // regex flags
        blank(start, i);
        lastSignificant = '/';
        continue;
      }
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        const c = chars[i] as string;
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (quote !== '`' && c === '\n') break;
        if (c === quote) {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) complete = false;
      // Keep the quotes, blank the contents only when asked: call sites stay
      // visible (eval("...") still shows eval(), prose inside strings
      // disappears).
      if (includeStrings) blank(start + 1, closed ? i - 1 : i);
      lastSignificant = quote;
      continue;
    }

    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') lastSignificant = ch;
    i++;
  }

  return { text: chars.join(''), complete };
}

/**
 * Masks line/block comments and regex-literal source only. String contents
 * stay visible — for rules whose patterns live inside strings (SQL text,
 * `origin: '*'`, `password: 'admin'`).
 */
export function maskCommentsAndRegex(content: string): MaskedSource {
  return mask(content, false);
}

/**
 * Additionally masks string/template contents — for rules matching call
 * expressions and code tokens (eval(), new Function(), err.stack), where a
 * hit inside a string is prose, not code.
 */
export function maskNonCode(content: string): MaskedSource {
  return mask(content, true);
}
