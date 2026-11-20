/**
 * Pure CSS allow-list filter for plugin themes (`ctx.theme`, `/theme.css`).
 *
 * Refuses backslashes, unclosed strings/comments, unbalanced `{}`/`()`, any
 * function outside `ALLOWED_FUNCTIONS` (such as `url()`, `image-set()`,
 * `attr()`) and any at-rule outside `ALLOWED_AT_RULES` (such as `@import`,
 * `@font-face`).
 */

const MAX_THEME_CSS = 50000;

const ALLOWED_FUNCTIONS = Object.freeze(new Set([
    // Values
    'var', 'calc', 'min', 'max', 'clamp', 'rgb', 'rgba', 'hsl', 'hsla', 'hwb',
    'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'linear-gradient',
    'radial-gradient', 'conic-gradient', 'repeating-linear-gradient',
    'repeating-radial-gradient', 'repeating-conic-gradient', 'cubic-bezier', 'steps',
    'counter', 'counters', 'minmax', 'repeat', 'fit-content',
    // Transforms
    'translate', 'translatex', 'translatey', 'translate3d', 'rotate',
    'scale', 'scalex', 'scaley', 'skew', 'skewx', 'skewy', 'matrix', 'perspective',
    // Filters
    'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale',
    'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia',
    // Selectors
    'not', 'is', 'where', 'has', 'nth-child', 'nth-last-child',
    'nth-of-type', 'nth-last-of-type', 'lang', 'dir'
]));

const ALLOWED_AT_RULES = Object.freeze(new Set([
    'media', 'supports', 'container', 'layer', 'keyframes'
]));

function isDigit(code) {
    return code >= 48 && code <= 57;
}

function isAsciiLetter(code) {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isIdentChar(code) {
    return isAsciiLetter(code) || isDigit(code) || code === 95 || code === 45 || code >= 0x80;
}

function isIdentStartAt(css, index) {
    const code = css.charCodeAt(index);
    if (isAsciiLetter(code) || code === 95 || code >= 0x80) return true;
    if (code === 45) {
        const next = index + 1 < css.length ? css.charCodeAt(index + 1) : 0;
        return isAsciiLetter(next) || next === 95 || next === 45 || next >= 0x80;
    }
    return false;
}

function fail(line, text) {
    return {
        ok: false,
        line,
        message: line === null ? text : `Zeile ${line}: ${text}`
    };
}

/**
 * Check a theme stylesheet against the allow-list.
 *
 * @param {unknown} css -> Stylesheet source.
 * @returns {{ ok: true } | { ok: false, line: number|null, message: string }}
 */
function checkThemeCss(css) {
    if (typeof css !== 'string') return fail(null, 'Das CSS muss Text sein.');
    if (css.length > MAX_THEME_CSS) return fail(null, 'Das CSS ist zu lang (höchstens 50 000 Zeichen).');

    let line = 1;
    let commentStartLine = 0;
    let quote = '';
    let stringStartLine = 0;
    let braceDepth = 0;
    let parenDepth = 0;
    let splitIdentByComment = false;

    const len = css.length;
    for (let i = 0; i < len; i++) {
        const ch = css[i];

        if (ch === '\\') {
            return fail(line, 'Backslashes (\\) sind nicht erlaubt.');
        }

        if (commentStartLine > 0) {
            if (ch === '\n') {
                line++;
                splitIdentByComment = false;
            } else if (ch === '*' && css[i + 1] === '/') {
                commentStartLine = 0;
                i++;
            }
            continue;
        }

        if (quote !== '') {
            if (ch === '\n' || ch === '\r') {
                return fail(stringStartLine, 'Ein Text in Anführungszeichen wird nicht geschlossen.');
            }
            if (ch === quote) {
                quote = '';
                stringStartLine = 0;
            }
            continue;
        }

        if (ch === '\n') {
            line++;
            splitIdentByComment = false;
            continue;
        }

        if (ch === '/' && css[i + 1] === '*') {
            commentStartLine = line;
            splitIdentByComment = i > 0 && isIdentChar(css.charCodeAt(i - 1));
            i++;
            continue;
        }

        if (ch === '"' || ch === "'") {
            quote = ch;
            stringStartLine = line;
            splitIdentByComment = false;
            continue;
        }

        if (ch === '{') {
            braceDepth++;
            splitIdentByComment = false;
            continue;
        }
        if (ch === '}') {
            if (braceDepth === 0) return fail(line, 'Die Klammern { } passen nicht zusammen.');
            braceDepth--;
            splitIdentByComment = false;
            continue;
        }
        if (ch === '(') {
            parenDepth++;
            splitIdentByComment = false;
            continue;
        }
        if (ch === ')') {
            if (parenDepth === 0) return fail(line, 'Die Klammern ( ) passen nicht zusammen.');
            parenDepth--;
            splitIdentByComment = false;
            continue;
        }

        if (ch === '@') {
            splitIdentByComment = false;
            const start = i + 1;
            let end = start;
            while (end < len && isIdentChar(css.charCodeAt(end))) end++;
            const rawName = css.slice(start, end).toLowerCase();
            if (!rawName || !ALLOWED_AT_RULES.has(rawName)) {
                return fail(line, `@${rawName} ist nicht erlaubt.`);
            }
            i = end - 1;
            continue;
        }

        if (isIdentStartAt(css, i)) {
            const wasSplit = splitIdentByComment;
            splitIdentByComment = false;
            const start = i;
            let end = start + 1;
            while (end < len && isIdentChar(css.charCodeAt(end))) end++;
            if (css[end] === '(') {
                const fnName = css.slice(start, end).toLowerCase();
                if (fnName === 'url') {
                    return fail(line, 'url() ist nicht erlaubt – eigene Bilder und Schriften können nicht eingebunden werden.');
                }
                if (!wasSplit && !ALLOWED_FUNCTIONS.has(fnName)) {
                    return fail(line, `${fnName}() ist nicht erlaubt.`);
                }
            }
            i = end - 1;
            continue;
        }

        splitIdentByComment = false;
    }

    if (commentStartLine > 0) {
        return fail(commentStartLine, 'Ein Kommentar (/* … */) wird nicht geschlossen.');
    }
    if (quote !== '') {
        return fail(stringStartLine, 'Ein Text in Anführungszeichen wird nicht geschlossen.');
    }
    if (parenDepth !== 0) {
        return fail(line, 'Die Klammern ( ) passen nicht zusammen.');
    }
    if (braceDepth !== 0) {
        return fail(line, 'Die Klammern { } passen nicht zusammen.');
    }

    return { ok: true };
}

module.exports = {
    MAX_THEME_CSS,
    ALLOWED_FUNCTIONS,
    ALLOWED_AT_RULES,
    checkThemeCss
};
