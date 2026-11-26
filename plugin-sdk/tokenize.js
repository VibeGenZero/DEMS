'use strict';

// Small JavaScript tokenizer for the plugin permission scan. It only has to
// be good enough to tell code from comments, strings and regex literals; it
// is a developer help, not a parser. No Node-only APIs (also runs in the browser).

const REGEX_PRECEDING_NAMES = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

const isIdentStart = (c) => /[A-Za-z_$\u0080-\uFFFF]/.test(c);
const isIdentPart = (c) => /[A-Za-z0-9_$\u0080-\uFFFF]/.test(c);
const isDigit = (c) => c >= '0' && c <= '9';

/**
 * @param {string} code
 * @returns {{type: 'name'|'punct'|'string'|'number', value: string, line: number}[]}
 */
function tokenize(code) {
  const src = String(code);
  const n = src.length;
  const tokens = [];
  let i = 0;
  let line = 1;
  // prev: last significant token (regex/template ends count as values).
  let prev = null;
  let prev2 = null;
  let prev3 = null;
  const setPrev = (t) => { prev3 = prev2; prev2 = prev; prev = t; };
  // Stack of open contexts: 'brace' for a plain `{`, 'tpl' for a `${` inside a template.
  const stack = [];

  const push = (type, value, ln) => {
    const t = { type, value, line: ln };
    tokens.push(t);
    setPrev(t);
  };

  // Advance over a newline char at src[i] (handles \r\n as one) and count it.
  const newline = () => {
    if (src[i] === '\r' && src[i + 1] === '\n') i++;
    i++;
    line++;
  };
  const isNl = (c) => c === '\n' || c === '\r';
  // Skip a backslash escape at src[i]; an escaped line break (also CRLF) counts as a line.
  const skipEscape = () => {
    i++;
    if (i < n && isNl(src[i])) newline(); else i++;
  };
  const isValueLike = (t) => !!t && (t.type === 'punct'
    ? [')', ']', '}'].includes(t.value)
    : t.type !== 'name' || !REGEX_PRECEDING_NAMES.has(t.value));

  const regexAllowed = () => {
    if (!prev) return true;
    if (prev.type === 'punct') {
      // postfix ++/-- after a value is followed by division
      if ((prev.value === '+' || prev.value === '-') && prev2 && prev2.type === 'punct'
        && prev2.value === prev.value && isValueLike(prev3)) return false;
      return ![')', ']', '}'].includes(prev.value);
    }
    if (prev.type === 'name') {
      if (prev2 && prev2.type === 'punct' && prev2.value === '.') return false; // property name
      return REGEX_PRECEDING_NAMES.has(prev.value);
    }
    return false;
  };

  // Reads a template body starting after the opening backtick or after the
  // closing `}` of a `${ }`. Returns true when it stopped at `${` (code follows).
  const readTemplate = (startLine, isStart) => {
    const begin = i;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { skipEscape(); continue; }
      if (c === '`') {
        if (isStart) push('string', src.slice(begin, i), startLine);
        else setPrev({ type: 'string', value: '', line });
        i++;
        return false;
      }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        stack.push('tpl');
        prev3 = prev2 = prev = null;
        return true;
      }
      if (isNl(c)) newline(); else i++;
    }
    return false;
  };

  while (i < n) {
    const c = src[i];

    if (isNl(c)) { newline(); continue; }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === '\u00A0' || c === '\uFEFF') { i++; continue; }

    // Comments
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && !isNl(src[i])) i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (isNl(src[i])) newline(); else i++;
      }
      i += 2;
      continue;
    }

    // Strings
    if (c === '"' || c === "'") {
      const startLine = line;
      const begin = ++i;
      while (i < n && src[i] !== c && !isNl(src[i])) {
        if (src[i] === '\\') skipEscape(); else i++;
      }
      const value = src.slice(begin, Math.min(i, n));
      if (src[i] === c) i++;
      push('string', value, startLine);
      continue;
    }

    // Template literals
    if (c === '`') {
      i++;
      readTemplate(line, true);
      continue;
    }

    // Closing brace: end of a `${ }` resumes the template, else a plain punct.
    if (c === '}') {
      const top = stack.pop();
      if (top === 'tpl') {
        i++;
        readTemplate(line, false);
        continue;
      }
      i++;
      push('punct', '}', line);
      continue;
    }
    if (c === '{') {
      stack.push('brace');
      i++;
      push('punct', '{', line);
      continue;
    }

    // Regex literal or division
    if (c === '/') {
      if (regexAllowed()) {
        i++;
        let inClass = false;
        while (i < n && !isNl(src[i])) {
          const d = src[i];
          if (d === '\\') { skipEscape(); continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) break;
          i++;
        }
        if (src[i] === '/') i++; // closing slash (absent when unterminated)
        while (i < n && isIdentPart(src[i])) i++; // flags
        setPrev({ type: 'string', value: '', line });
        continue;
      }
      i++;
      push('punct', '/', line);
      continue;
    }

    // Numbers
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      const begin = i;
      if (c === '0' && /[xXoObB]/.test(src[i + 1] || '')) {
        i += 2;
        while (i < n && /[0-9a-fA-F_n]/.test(src[i])) i++;
      } else {
        while (i < n && /[0-9_.]/.test(src[i])) i++;
        if (/[eE]/.test(src[i] || '') && /[0-9+-]/.test(src[i + 1] || '')) {
          i += 2;
          while (i < n && isDigit(src[i])) i++;
        }
        if (src[i] === 'n') i++;
      }
      push('number', src.slice(begin, i), line);
      continue;
    }

    // Names
    if (isIdentStart(c)) {
      const begin = i;
      while (i < n && isIdentPart(src[i])) i++;
      push('name', src.slice(begin, i), line);
      continue;
    }

    i++;
    push('punct', c, line);
  }

  return tokens;
}

module.exports = { tokenize };
