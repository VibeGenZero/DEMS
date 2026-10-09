/**
 * Small source scanner for the frontend guard tests and the D-01 split script.
 * No parser dependency: it only needs to tell code from text.
 */

const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do', 'await', 'yield']);
const REGEX_AFTER_CHARS = '(,=:[!&|?{};+-*%<>~^';

/**
 * Blank out everything in JavaScript source that is not code: comments,
 * string and template-literal text, regex literal bodies. Quotes, backticks,
 * `${`/`}` of template expressions and newlines stay, and every character
 * keeps its index, so a match in the result maps 1:1 onto the source.
 *
 * @param {string} source -> JavaScript source.
 * @returns {string} -> Masked source of the same length.
 */
function maskJsSource(source) {
    const out = source.split('');
    const length = source.length;
    const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
    // One entry per open `${`: how many plain `{` are open inside it
    const templateBraces = [];
    let prev = '';
    let prevWord = '';
    let i = 0;

    const regexAllowed = () => {
        if (prev === 'word') return REGEX_AFTER_WORDS.has(prevWord);
        return prev === '' || REGEX_AFTER_CHARS.includes(prev);
    };
    // Scan template text from `start`; returns the index after the closing backtick or after `${`
    const scanTemplate = (start) => {
        let j = start;
        while (j < length) {
            if (source[j] === '\\') { j += 2; continue; }
            if (source[j] === '`') { blank(start, j); prev = '`'; return j + 1; }
            if (source[j] === '$' && source[j + 1] === '{') {
                blank(start, j);
                templateBraces.push(0);
                prev = '{';
                return j + 2;
            }
            j++;
        }
        blank(start, length);
        return length;
    };

    while (i < length) {
        const ch = source[i];
        const next = source[i + 1];
        if (ch === '/' && next === '/') {
            const end = source.indexOf('\n', i);
            const stop = end === -1 ? length : end;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end === -1 ? length : end + 2;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (ch === '"' || ch === "'") {
            let j = i + 1;
            while (j < length && source[j] !== ch && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
            blank(i + 1, j);
            prev = ch;
            i = j + 1;
            continue;
        }
        if (ch === '`') {
            i = scanTemplate(i + 1);
            continue;
        }
        if (ch === '/' && regexAllowed()) {
            let j = i + 1;
            let inClass = false;
            while (j < length && source[j] !== '\n') {
                const c = source[j];
                if (c === '\\') { j += 2; continue; }
                if (c === '[') inClass = true;
                else if (c === ']') inClass = false;
                else if (c === '/' && !inClass) break;
                j++;
            }
            blank(i + 1, j);
            j++;
            while (j < length && /[a-z]/i.test(source[j])) j++;
            prev = '/';
            i = j;
            continue;
        }
        if (ch === '{' && templateBraces.length) templateBraces[templateBraces.length - 1]++;
        if (ch === '}' && templateBraces.length) {
            if (templateBraces[templateBraces.length - 1] === 0) {
                templateBraces.pop();
                i = scanTemplate(i + 1);
                continue;
            }
            templateBraces[templateBraces.length - 1]--;
        }
        if (/\s/.test(ch)) { i++; continue; }
        if (/[\w$]/.test(ch)) {
            let j = i;
            while (j < length && /[\w$]/.test(source[j])) j++;
            prev = 'word';
            prevWord = source.slice(i, j);
            i = j;
            continue;
        }
        prev = ch;
        prevWord = '';
        i++;
    }
    return out.join('');
}

/**
 * Nesting depth at the start of every line of masked source: brackets,
 * braces, parentheses and open template literals all count.
 *
 * @param {string} masked -> Output of maskJsSource().
 * @returns {number[]} -> Depth per line (index = line number - 1).
 */
function lineDepths(masked) {
    const stack = [];
    const depths = [0];
    for (let i = 0; i < masked.length; i++) {
        const ch = masked[i];
        if (ch === '\n') { depths.push(stack.length); continue; }
        if (ch === '`') {
            if (stack[stack.length - 1] === '`') stack.pop(); else stack.push('`');
        } else if (ch === '$' && masked[i + 1] === '{' && stack[stack.length - 1] === '`') {
            stack.push('${');
            i++;
        } else if (ch === '{' || ch === '(' || ch === '[') {
            stack.push(ch);
        } else if (ch === '}' || ch === ')' || ch === ']') {
            stack.pop();
        }
    }
    return depths;
}

/**
 * Identifiers used as code in masked source: not after `.`, `?.`, and not
 * an object key (`{ name:` / `, name:`). A spread operand (`...name`) is code.
 *
 * @param {string} masked -> Output of maskJsSource().
 * @returns {Array<{ name: string, index: number }>} -> Every reference.
 */
function codeIdentifiers(masked) {
    const found = [];
    // A single dot before the name is property access; the last dot of `...` is not
    for (const match of masked.matchAll(/(?<![\w$])(?<!(?:^|[^.])\.)[A-Za-z_$][\w$]*/g)) {
        const after = masked.slice(match.index + match[0].length, match.index + match[0].length + 50).match(/^\s*(\S)(\S)?/);
        const before = masked.slice(Math.max(0, match.index - 200), match.index).match(/(\S)\s*$/);
        const isKey = after && after[1] === ':' && after[2] !== ':' && before && (before[1] === '{' || before[1] === ',');
        if (!isKey) found.push({ name: match[0], index: match.index });
    }
    return found;
}

// Bindings a module declares itself: functions, classes, variables, parameters, catch variables
const DECLARATIONS = [
    /\b(?:function|class)\s+([\w$]+)/g,
    /\b(?:const|let|var)\s+([\w$]+)/g,
    /\b(?:const|let|var)\s*[{[]([^}\]=]*)[}\]]/g,
    /\bfunction\s*[\w$]*\s*\(([^)]*)\)/g,
    /\(([^()]*)\)\s*=>/g,
    /(?<![\w$.])([\w$]+)\s*=>/g,
    /\bcatch\s*\(\s*([\w$]+)/g
];

/**
 * Names a module declares itself, without scope: the scanner cannot tell
 * which block a declaration belongs to.
 *
 * @param {string} masked -> Output of maskJsSource().
 * @returns {Set<string>}
 */
function declaredNames(masked) {
    const names = new Set();
    for (const pattern of DECLARATIONS) {
        for (const match of masked.matchAll(pattern)) {
            for (const part of match[1].split(',')) {
                // "a = 1", "...rest", "{ x }", "key: alias" -> the bound name
                const name = part.split('=')[0].split(':').pop().replace(/[{}[\].\s]/g, '');
                if (name) names.add(name);
            }
        }
    }
    return names;
}

/**
 * Exports of other modules a module uses (called or as a value) without
 * importing them. A name the module declares itself anywhere is skipped,
 * so a same-named local can hide a real gap, never cause a false report.
 *
 * @param {Array<{ file: string, source: string }>} sources -> Modules, path with /.
 * @returns {Array<{ file: string, name: string, from: string, line: number }>}
 */
function findMissingImports(sources) {
    const owner = new Map();
    for (const { file, source } of sources) {
        for (const match of source.matchAll(/^export (?:async )?(?:function|class|const|let) ([\w$]+)/gm)) owner.set(match[1], file);
    }
    const missing = [];
    for (const { file, source } of sources) {
        const text = source.replace(/\r\n/g, '\n');
        const imported = new Set([...text.matchAll(/^import \{([^}]*)\} from/gm)]
            .flatMap(match => match[1].split(',').map(name => name.trim()).filter(Boolean)));
        const masked = maskJsSource(text);
        const declared = declaredNames(masked);
        for (const ref of codeIdentifiers(masked)) {
            const from = owner.get(ref.name);
            if (!from || from === file || imported.has(ref.name) || declared.has(ref.name)) continue;
            missing.push({ file, name: ref.name, from, line: masked.slice(0, ref.index).split('\n').length });
        }
    }
    return missing;
}

module.exports = { maskJsSource, lineDepths, codeIdentifiers, findMissingImports };
