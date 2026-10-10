/**
 * Small CSS reader for the stylesheet guard tests (designTokens.test.js,
 * cssRules.test.js). No parser dependency: the project stylesheets only use
 * plain rules, @media and @keyframes.
 */
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

const CSS_DIR = path.join(REPO_ROOT, 'public', 'css');
// At-rules that contain rules; everything else with a block is a rule itself
const NESTING_AT_RULE = /^@(media|supports|keyframes|-webkit-keyframes)\b/;

/**
 * Read a project stylesheet.
 *
 * @param {string} name -> File name below public/css, e.g. "tokens.css".
 * @returns {string} -> File content.
 */
function readCss(name) {
    return fs.readFileSync(path.join(CSS_DIR, name), 'utf8');
}

/**
 * Blank out comments. Newlines stay, so every character keeps its line.
 *
 * @param {string} css -> Stylesheet source.
 * @returns {string} -> Source of the same length without comment text.
 */
function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
}

/**
 * Rules of a stylesheet in source order.
 *
 * @param {string} css -> Stylesheet source.
 * @returns {Array<{ selector: string, context: string, declarations: Array<{ property: string, value: string, line: number }>, line: number }>} -> selector is the normalised selector list, context the open at-rules ('' at the top level).
 */
function parseRules(css) {
    const text = stripComments(css);
    const rules = [];
    const contexts = [];
    let rule = null;
    let buffer = '';
    let bufferLine = 1;
    let line = 1;
    const addDeclaration = () => {
        const colon = buffer.indexOf(':');
        if (rule && colon > 0) {
            rule.declarations.push({ property: buffer.slice(0, colon).trim(), value: buffer.slice(colon + 1).trim().replace(/\s+/g, ' '), line: bufferLine });
        }
        buffer = '';
    };
    for (const char of text) {
        if (char === '\n') line++;
        if (char === '{') {
            const prelude = buffer.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');
            if (NESTING_AT_RULE.test(prelude)) {
                contexts.push(prelude);
            } else {
                rule = { selector: prelude, context: contexts.join(' '), declarations: [], line: bufferLine };
                rules.push(rule);
            }
            buffer = '';
        } else if (char === '}') {
            if (rule) {
                addDeclaration();
                rule = null;
            } else {
                contexts.pop();
                buffer = '';
            }
        } else if (char === ';' && rule) {
            addDeclaration();
        } else {
            if (buffer.trim() === '' && char.trim() !== '') bufferLine = line;
            buffer += char;
        }
    }
    return rules;
}

/**
 * Custom properties of every :root rule.
 *
 * @param {string} css -> Stylesheet source.
 * @returns {Map<string, string>} -> Token name -> value as written.
 */
function readTokens(css) {
    const tokens = new Map();
    for (const rule of parseRules(css)) {
        if (rule.selector !== ':root') continue;
        for (const { property, value } of rule.declarations) {
            if (property.startsWith('--')) tokens.set(property, value);
        }
    }
    return tokens;
}

module.exports = { readCss, stripComments, parseRules, readTokens };
