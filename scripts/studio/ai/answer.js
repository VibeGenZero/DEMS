'use strict';
/**
 * Turns the streamed AI answer into live explanation text and a final list of files.
 * The answer is plain text plus file blocks:
 *
 *   <<<DATEI path/to/file.js
 *   ...file content...
 *   >>>DATEI
 *
 * Both markers count only at the start of a line. Pure module, no I/O. Paths are returned
 * as written (trimmed); validating them is the caller's job.
 */

const FILE_START = '<<<DATEI ';
const FILE_END = '>>>DATEI';

class AnswerError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'AnswerError';
    this.code = code;
  }
}

const isEnd = (line) => line.startsWith(FILE_END) && line.slice(FILE_END.length).trim() === '';
const isStart = (line) => line.startsWith(FILE_START);
/** An unfinished line that may still turn into a start marker must not be shown yet. */
const couldBeStart = (partial) => FILE_START.startsWith(partial) || isStart(partial);

function createAnswerParser() {
  let buffer = '';
  let reply = '';
  let current = null; // { path, lines } while inside a block
  const files = new Map();

  const closeBlock = () => {
    const content = current.lines.length ? current.lines.join('\n') + '\n' : '';
    files.delete(current.path); // a later block moves to the end, like it was written last
    files.set(current.path, content);
    current = null;
  };

  /** @returns {string} explanation text produced by this line */
  const handleLine = (line) => {
    if (current) {
      if (isEnd(line)) closeBlock();
      else current.lines.push(line);
      return '';
    }
    if (isStart(line)) {
      current = { path: line.slice(FILE_START.length).trim(), lines: [] };
      return '';
    }
    return line + '\n';
  };

  return {
    push(chunk) {
      buffer = (buffer + String(chunk)).replace(/\r\n/g, '\n');
      let text = '';
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        text += handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
      // A trailing "\r" may be the first half of "\r\n": keep it back with the partial line.
      if (!current && buffer && !couldBeStart(buffer) && !buffer.endsWith('\r')) {
        text += buffer;
        buffer = '';
      }
      reply += text;
      return { text, writing: current ? current.path : null };
    },

    end() {
      if (buffer) {
        const line = buffer.replace(/\r$/, '');
        buffer = '';
        const tail = handleLine(line);
        reply += current || !tail ? tail : tail.slice(0, -1);
      }
      if (current) throw new AnswerError('incomplete', 'File block was not closed');
      return {
        reply: reply.trim(),
        files: [...files].map(([path, content]) => ({ path, content }))
      };
    }
  };
}

/** Replaces each run of file blocks in an earlier answer with `[Dateien: a.js, b.js]`. */
function compactTurn(text) {
  const out = [];
  let run = null;
  let inBlock = false;
  const flush = () => {
    if (run) out.push(`[Dateien: ${run.join(', ')}]`);
    run = null;
  };
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (inBlock) {
      if (isEnd(line)) inBlock = false;
    } else if (isStart(line)) {
      run = run || [];
      run.push(line.slice(FILE_START.length).trim());
      inBlock = true;
    } else if (!(run && line.trim() === '')) { // blank lines between blocks of one run vanish
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join('\n');
}

module.exports = { FILE_START, FILE_END, AnswerError, createAnswerParser, compactTurn };
