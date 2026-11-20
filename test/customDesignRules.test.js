const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { checkThemeCss } = require('../plugin-sdk/themeCss');
const {
    TOKEN_KEYS,
    TOKEN_CSS,
    FIELD_LABELS,
    SCHEME_LABELS,
    DEFAULTS,
    DEFAULT_TOKENS,
    CORNERS,
    FONTS,
    EMPTY_SOURCE,
    validateSource,
    resolveTokens,
    compileCss,
    contrastWarnings,
    changedLabels,
    cssChanged,
    parseColor,
    contrastRatio,
} = require('../plugins/custom-design/rules');

function parseTokensCssBlocks() {
    const file = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'tokens.css'), 'utf8');
    const parseVars = (blockText) => {
        const vars = {};
        const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
        let match;
        while ((match = re.exec(blockText)) !== null) {
            vars[match[1]] = match[2].trim();
        }
        return vars;
    };
    const rootMatch = file.match(/:root\s*\{([\s\S]*?)\}/);
    const darkMatch = file.match(/:root,\s*\[data-bs-theme="dark"\]\s*\{([\s\S]*?)\}/);
    const lightMatch = file.match(/\[data-bs-theme="light"\]\s*\{([\s\S]*?)\}/);
    return {
        root: parseVars(rootMatch ? rootMatch[1] : ''),
        dark: parseVars(darkMatch ? darkMatch[1] : ''),
        light: parseVars(lightMatch ? lightMatch[1] : ''),
    };
}

describe('custom-design rules', () => {
    it('defaults match tokens.css', () => {
        const blocks = parseTokensCssBlocks();
        for (const scheme of ['dark', 'light']) {
            for (const key of TOKEN_KEYS) {
                const cssVar = TOKEN_CSS[key];
                assert.equal(DEFAULTS[scheme][key], blocks[scheme][cssVar], `${scheme}.${key}`);
            }
            for (const [cssVar, val] of Object.entries(DEFAULT_TOKENS[scheme])) {
                assert.equal(val, blocks[scheme][cssVar], `${scheme} ${cssVar}`);
            }
        }
        assert.deepEqual(CORNERS.standard, [
            blocks.root['--radius-sm'],
            blocks.root['--radius'],
            blocks.root['--radius-lg'],
        ]);
        assert.equal( blocks.root['--font-body'].startsWith("'Inter'"), true);
        assert.equal(FONTS.inter, null);
        assert.equal(typeof FONTS.system, 'string');
    });

    it('hex input is normalised and invalid colours are refused with field and scheme labels', () => {
        const res = validateSource({
            tokens: {
                dark: { accent: '#ABC' },
                light: { bgCard: '#AABBCC' },
            },
        });
        assert.equal(res.ok, true);
        assert.equal(res.source.tokens.dark.accent, '#aabbcc');
        assert.equal(res.source.tokens.light.bgCard, '#aabbcc');
        assert.equal(res.source.tokens.dark.bgPrimary, '');

        for (const bad of ['red', '#12345', '#1234567']) {
            const invalid = validateSource({
                tokens: { dark: { accent: bad } },
            });
            assert.deepEqual(invalid, {
                ok: false,
                message: 'Ungültige Farbe für Akzentfarbe (Dunkel): erlaubt ist #rrggbb.',
            });
        }
    });

    it('unknown keys, corners, fonts and invalid css are refused', () => {
        assert.deepEqual(validateSource({ foo: 1 }), {
            ok: false,
            message: 'Unbekanntes Feld: foo.',
        });
        assert.deepEqual(validateSource({ tokens: { neon: {} } }), {
            ok: false,
            message: 'Unbekanntes Feld: neon.',
        });
        assert.deepEqual(validateSource({ tokens: { dark: { foo: '#112233' } } }), {
            ok: false,
            message: 'Unbekanntes Feld: foo.',
        });
        assert.deepEqual(validateSource({ corners: 'circle' }), {
            ok: false,
            message: 'Unbekannte Ecken-Einstellung.',
        });
        assert.deepEqual(validateSource({ font: 'comic' }), {
            ok: false,
            message: 'Unbekannte Schrift.',
        });
        assert.deepEqual(validateSource({ css: 123 }), {
            ok: false,
            message: 'Das eigene CSS muss Text sein.',
        });
        assert.deepEqual(validateSource({ css: 'a'.repeat(50001) }), {
            ok: false,
            message: 'Das eigene CSS ist zu lang (höchstens 50 000 Zeichen).',
        });
    });

    it('an empty source compiles to nothing', () => {
        assert.equal(compileCss(EMPTY_SOURCE), '');
    });

    it('a dark-only accent never matches light mode', () => {
        const { source } = validateSource({
            tokens: { dark: { accent: '#123456' } },
        });
        const css = compileCss(source);
        assert.equal(css.includes(':root:not([data-bs-theme="light"]), [data-bs-theme="dark"] {'), true);
        assert.equal(css.includes('[data-bs-theme="light"] {'), false);
    });

    it('the generated CSS passes the SDK filter and puts free CSS last', () => {
        const { source } = validateSource({
            tokens: {
                dark: {
                    accent: '#123456',
                    bgPrimary: '#0b0b12',
                    bgSecondary: '#13131d',
                    bgCard: '#181824',
                    textPrimary: '#f0f0f5',
                    textSecondary: '#b0b0be',
                    textMuted: '#9090a0',
                },
                light: {
                    accent: '#654321',
                    bgPrimary: '#f4f5f7',
                    bgCard: '#fafafa',
                },
            },
            corners: 'round',
            font: 'system',
            css: '.x{}',
        });
        const css = compileCss(source);
        assert.deepEqual(checkThemeCss(css), { ok: true });
        assert.equal(css.endsWith('/* Eigenes CSS */\n.x{}\n'), true);
    });

    it('on-accent picks the readable text colour', () => {
        const bright = validateSource({ tokens: { dark: { accent: '#ffff00' } } }).source;
        assert.equal(resolveTokens(bright, 'dark')['--on-accent'], '#0a0a0f');

        const deep = validateSource({ tokens: { dark: { accent: '#1e1b4b' } } }).source;
        assert.equal(resolveTokens(deep, 'dark')['--on-accent'], '#ffffff');
    });

    it('accent text reaches 4.5 when reachable', () => {
        const { source } = validateSource({ tokens: { dark: { accent: '#3b0764' } } });
        const tokens = resolveTokens(source, 'dark');
        const accentText = parseColor(tokens['--accent-text']);
        for (const surfaceKey of ['--bg-card', '--bg-primary', '--bg-secondary']) {
            const ratio = contrastRatio(accentText, parseColor(tokens[surfaceKey]));
            assert.equal(ratio >= 4.5, true, `${surfaceKey}: ${ratio}`);
        }
    });

    it('derived from the default accent lands close to the shipped tones', () => {
        const { source } = validateSource({
            tokens: {
                dark: { accent: DEFAULTS.dark.accent },
                light: { accent: DEFAULTS.light.accent },
            },
        });
        for (const scheme of ['dark', 'light']) {
            const derived = resolveTokens(source, scheme);
            for (const token of ['--accent-light', '--accent-fill', '--accent-fill-hover']) {
                const a = parseColor(derived[token]);
                const b = parseColor(DEFAULT_TOKENS[scheme][token]);
                assert.equal(Math.abs(a.r - b.r) <= 40, true, `${scheme} ${token} r`);
                assert.equal(Math.abs(a.g - b.g) <= 40, true, `${scheme} ${token} g`);
                assert.equal(Math.abs(a.b - b.b) <= 40, true, `${scheme} ${token} b`);
            }
        }
    });

    it('defaults raise no warnings and a known bad pair warns with the exact floored message', () => {
        assert.deepEqual(contrastWarnings(EMPTY_SOURCE), []);

        const { source } = validateSource({
            tokens: { light: { textMuted: '#bbbbbb' } },
        });
        const warnings = contrastWarnings(source);
        const expectedRatio = Math.floor(contrastRatio(parseColor('#bbbbbb'), parseColor('#ffffff')) * 10) / 10;
        const expectedText = expectedRatio.toFixed(1).replace('.', ',');
        assert.equal(expectedText, '1,9');
        assert.equal(
            warnings.some(
                w =>
                    w.scheme === 'light' &&
                    w.text === '--text-muted' &&
                    w.surface === '--bg-card' &&
                    w.message ===
                        `Hell: Text (gedämpft) auf Karten hat ${expectedText} : 1 – für gute Lesbarkeit sind mindestens 4,5 : 1 nötig.`
            ),
            true
        );
    });

    it('changedLabels lists what changed and cssChanged compares free CSS only', () => {
        const { source: after } = validateSource({
            tokens: {
                dark: { accent: '#123456' },
                light: { bgCard: '#eeeeee' },
            },
            corners: 'square',
            font: 'system',
            css: '.a {}',
        });
        assert.deepEqual(changedLabels(null, after), [
            'Akzentfarbe (Dunkel)',
            'Karten (Hell)',
            'Ecken',
            'Schrift',
            'Eigenes CSS geändert',
        ]);
        assert.equal(cssChanged(null, after), true);
        assert.equal(cssChanged(after, { ...after, corners: 'round' }), false);
        assert.equal(cssChanged(after, { ...after, css: '.b {}' }), true);
    });
});
