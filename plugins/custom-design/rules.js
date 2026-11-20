'use strict';

/**
 * Pure validation, token derivation, CSS compilation and WCAG contrast check
 * for the official "Design anpassen" plugin.
 */

const TOKEN_KEYS = [
    'accent',
    'bgPrimary',
    'bgSecondary',
    'bgCard',
    'textPrimary',
    'textSecondary',
    'textMuted',
];

const TOKEN_CSS = Object.freeze({
    accent: '--accent',
    bgPrimary: '--bg-primary',
    bgSecondary: '--bg-secondary',
    bgCard: '--bg-card',
    textPrimary: '--text-primary',
    textSecondary: '--text-secondary',
    textMuted: '--text-muted',
});

const FIELD_LABELS = Object.freeze({
    accent: 'Akzentfarbe',
    bgPrimary: 'Seitenhintergrund',
    bgSecondary: 'Zweiter Hintergrund',
    bgCard: 'Karten',
    textPrimary: 'Text',
    textSecondary: 'Text (zweitrangig)',
    textMuted: 'Text (gedämpft)',
});

const SCHEME_LABELS = Object.freeze({
    dark: 'Dunkel',
    light: 'Hell',
});

const DEFAULTS = Object.freeze({
    dark: Object.freeze({
        accent: '#8b5cf6',
        bgPrimary: '#0a0a0f',
        bgSecondary: '#12121a',
        bgCard: '#16161f',
        textPrimary: '#e4e4e7',
        textSecondary: '#a1a1aa',
        textMuted: '#8f8f9a',
    }),
    light: Object.freeze({
        accent: '#7c3aed',
        bgPrimary: '#f2f3f5',
        bgSecondary: '#ebedef',
        bgCard: '#ffffff',
        textPrimary: '#313338',
        textSecondary: '#4e5058',
        textMuted: '#5c5e66',
    }),
});

const DEFAULT_TOKENS = Object.freeze({
    dark: Object.freeze({
        '--text-primary': '#e4e4e7',
        '--text-secondary': '#a1a1aa',
        '--text-muted': '#8f8f9a',
        '--accent-text': '#a78bfa',
        '--accent-light': '#a78bfa',
        '--on-accent': '#ffffff',
        '--accent-fill': '#7c3aed',
        '--accent-fill-hover': '#6d28d9',
        '--bg-primary': '#0a0a0f',
        '--bg-secondary': '#12121a',
        '--bg-card': '#16161f',
        '--bg-glass': 'rgba(22, 22, 31, 0.85)',
        '--bg-glass-hover': 'rgba(30, 30, 45, 0.9)',
    }),
    light: Object.freeze({
        '--text-primary': '#313338',
        '--text-secondary': '#4e5058',
        '--text-muted': '#5c5e66',
        '--accent-text': '#6d28d9',
        '--accent-light': '#6d28d9',
        '--on-accent': '#ffffff',
        '--accent-fill': '#7c3aed',
        '--accent-fill-hover': '#6d28d9',
        '--bg-primary': '#f2f3f5',
        '--bg-secondary': '#ebedef',
        '--bg-card': '#ffffff',
        '--bg-glass': 'rgba(255, 255, 255, 0.85)',
        '--bg-glass-hover': 'rgba(255, 255, 255, 0.95)',
    }),
});

const CORNERS = Object.freeze({
    square: Object.freeze(['4px', '6px', '8px']),
    standard: Object.freeze(['8px', '12px', '16px']),
    round: Object.freeze(['12px', '18px', '24px']),
});

const FONTS = Object.freeze({
    inter: null,
    system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
});

const EMPTY_SCHEME = Object.freeze({
    accent: '',
    bgPrimary: '',
    bgSecondary: '',
    bgCard: '',
    textPrimary: '',
    textSecondary: '',
    textMuted: '',
});

const EMPTY_SOURCE = Object.freeze({
    tokens: Object.freeze({
        dark: EMPTY_SCHEME,
        light: EMPTY_SCHEME,
    }),
    corners: 'standard',
    font: 'inter',
    css: '',
});

const MAX_FREE_CSS = 50000;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/**
 * Parse a CSS colour: #rgb, #rrggbb, rgb(r, g, b), rgba(r, g, b, a), transparent.
 */
function parseColor(value) {
    const text = String(value ?? '').trim();
    if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const hex = HEX.exec(text);
    if (hex) {
        const digits =
            hex[1].length === 3
                ? [...hex[1]].map(digit => digit + digit).join('')
                : hex[1];
        return {
            r: parseInt(digits.slice(0, 2), 16),
            g: parseInt(digits.slice(2, 4), 16),
            b: parseInt(digits.slice(4, 6), 16),
            a: 1,
        };
    }
    const rgb = RGB.exec(text);
    if (!rgb) return null;
    return {
        r: Number(rgb[1]),
        g: Number(rgb[2]),
        b: Number(rgb[3]),
        a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
}

/**
 * Lay a translucent colour over an opaque one.
 */
function composite(top, bottom) {
    const mixChannel = (upper, lower) => upper * top.a + lower * (1 - top.a);
    return {
        r: mixChannel(top.r, bottom.r),
        g: mixChannel(top.g, bottom.g),
        b: mixChannel(top.b, bottom.b),
        a: 1,
    };
}

function luminance({ r, g, b }) {
    const [red, green, blue] = [r, g, b].map(channel => {
        const share = channel / 255;
        return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * WCAG 2 contrast ratio of two opaque colours.
 */
function contrastRatio(a, b) {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
}

function toHex({ r, g, b }) {
    const hex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function toRgba({ r, g, b }, alpha) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

function mixColors(a, b, t) {
    return {
        r: Math.round(a.r * (1 - t) + b.r * t),
        g: Math.round(a.g * (1 - t) + b.g * t),
        b: Math.round(a.b * (1 - t) + b.b * t),
        a: 1,
    };
}

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const DARK_ON_ACCENT = { r: 10, g: 10, b: 15, a: 1 };

function isPlainObject(val) {
    return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

const TOP_KEYS = new Set(['tokens', 'corners', 'font', 'css']);
const SCHEME_KEYS = new Set(['dark', 'light']);
const TOKEN_KEY_SET = new Set(TOKEN_KEYS);

function normalizeHex(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (text === '') return '';
    const match = HEX.exec(text);
    if (!match) return null;
    const digits =
        match[1].length === 3
            ? [...match[1]].map(d => d + d).join('')
            : match[1];
    return `#${digits.toLowerCase()}`;
}

/**
 * Validate and normalise a design source body.
 */
function validateSource(body) {
    const input = body === undefined || body === null ? {} : body;
    if (!isPlainObject(input)) {
        return { ok: false, message: 'Unbekanntes Feld: body.' };
    }
    for (const key of Object.keys(input)) {
        if (!TOP_KEYS.has(key)) {
            return { ok: false, message: `Unbekanntes Feld: ${key}.` };
        }
    }

    const rawTokens = input.tokens === undefined ? {} : input.tokens;
    if (!isPlainObject(rawTokens)) {
        return { ok: false, message: 'Unbekanntes Feld: tokens.' };
    }
    for (const scheme of Object.keys(rawTokens)) {
        if (!SCHEME_KEYS.has(scheme)) {
            return { ok: false, message: `Unbekanntes Feld: ${scheme}.` };
        }
    }

    const tokens = { dark: {}, light: {} };
    for (const scheme of ['dark', 'light']) {
        const rawScheme = rawTokens[scheme] === undefined ? {} : rawTokens[scheme];
        if (!isPlainObject(rawScheme)) {
            return { ok: false, message: `Unbekanntes Feld: ${scheme}.` };
        }
        for (const key of Object.keys(rawScheme)) {
            if (!TOKEN_KEY_SET.has(key)) {
                return { ok: false, message: `Unbekanntes Feld: ${key}.` };
            }
        }
        for (const key of TOKEN_KEYS) {
            const rawVal = rawScheme[key] === undefined ? '' : rawScheme[key];
            const norm = normalizeHex(rawVal);
            if (norm === null) {
                return {
                    ok: false,
                    message: `Ungültige Farbe für ${FIELD_LABELS[key]} (${SCHEME_LABELS[scheme]}): erlaubt ist #rrggbb.`,
                };
            }
            tokens[scheme][key] = norm;
        }
    }

    const corners = input.corners === undefined ? 'standard' : input.corners;
    if (typeof corners !== 'string' || !Object.hasOwn(CORNERS, corners)) {
        return { ok: false, message: 'Unbekannte Ecken-Einstellung.' };
    }

    const font = input.font === undefined ? 'inter' : input.font;
    if (typeof font !== 'string' || !Object.hasOwn(FONTS, font)) {
        return { ok: false, message: 'Unbekannte Schrift.' };
    }

    const css = input.css === undefined ? '' : input.css;
    if (typeof css !== 'string') {
        return { ok: false, message: 'Das eigene CSS muss Text sein.' };
    }
    if (css.length > MAX_FREE_CSS) {
        return {
            ok: false,
            message: 'Das eigene CSS ist zu lang (höchstens 50 000 Zeichen).',
        };
    }

    return {
        ok: true,
        source: {
            tokens,
            corners,
            font,
            css,
        },
    };
}

function deriveAccentFamily(scheme, accentHex, surfaces) {
    const accent = parseColor(accentHex);
    const isDark = scheme === 'dark';
    const accentLight = isDark
        ? mixColors(accent, WHITE, 0.3)
        : mixColors(accent, BLACK, 0.12);
    const accentDark = isDark
        ? mixColors(accent, BLACK, 0.22)
        : mixColors(accent, BLACK, 0.27);
    const accentFill = isDark
        ? mixColors(accent, BLACK, 0.1)
        : accent;
    const accentFillHover = isDark ? accentDark : accentLight;

    const target = isDark ? WHITE : BLACK;
    const surfaceColors = [surfaces.bgCard, surfaces.bgPrimary, surfaces.bgSecondary];
    const minSurfaceContrast = (color) =>
        Math.min(...surfaceColors.map(s => contrastRatio(color, s)));

    let accentText = accentLight;
    for (let step = 0; step < 20; step += 1) {
        if (minSurfaceContrast(accentText) >= 4.5) break;
        accentText = mixColors(accentText, target, 0.1);
    }

    const whiteMin = Math.min(
        contrastRatio(WHITE, accentFill),
        contrastRatio(WHITE, accentFillHover)
    );
    const darkMin = Math.min(
        contrastRatio(DARK_ON_ACCENT, accentFill),
        contrastRatio(DARK_ON_ACCENT, accentFillHover)
    );
    const onAccentHex = whiteMin >= darkMin ? '#ffffff' : '#0a0a0f';

    return {
        '--accent-light': toHex(accentLight),
        '--accent-dark': toHex(accentDark),
        '--accent-text': toHex(accentText),
        '--accent-fill': toHex(accentFill),
        '--accent-fill-hover': toHex(accentFillHover),
        '--on-accent': onAccentHex,
        '--accent-tint-1': toRgba(accent, isDark ? 0.08 : 0.06),
        '--accent-tint-2': toRgba(accent, isDark ? 0.15 : 0.12),
        '--accent-glow': toRgba(accent, isDark ? 0.4 : 0.3),
        '--border-accent': toRgba(accent, isDark ? 0.3 : 0.35),
        '--shadow-glow': isDark
            ? `0 0 30px ${toRgba(accent, 0.15)}`
            : `0 0 24px ${toRgba(accent, 0.12)}`,
    };
}

function deriveGlassTokens(scheme, bgCardHex) {
    const card = parseColor(bgCardHex);
    if (scheme === 'dark') {
        const hover = mixColors(card, WHITE, 0.05);
        return {
            '--bg-glass': toRgba(card, 0.85),
            '--bg-glass-hover': toRgba(hover, 0.9),
        };
    }
    return {
        '--bg-glass': toRgba(card, 0.85),
        '--bg-glass-hover': toRgba(card, 0.95),
    };
}

function deriveScrimToken(bgPrimaryHex) {
    const page = parseColor(bgPrimaryHex);
    return {
        '--bg-scrim': toRgba(page, 0.9),
    };
}

function buildSchemeDeclarations(source, scheme) {
    const custom = source?.tokens?.[scheme] || EMPTY_SCHEME;
    const defaults = DEFAULTS[scheme];
    const decls = {};

    for (const key of TOKEN_KEYS) {
        if (custom[key]) {
            decls[TOKEN_CSS[key]] = custom[key];
        }
    }

    const accentOrSurfaceCustom = Boolean(
        custom.accent || custom.bgPrimary || custom.bgSecondary || custom.bgCard
    );
    if (accentOrSurfaceCustom) {
        const accentHex = custom.accent || defaults.accent;
        const surfaces = {
            bgPrimary: parseColor(custom.bgPrimary || defaults.bgPrimary),
            bgSecondary: parseColor(custom.bgSecondary || defaults.bgSecondary),
            bgCard: parseColor(custom.bgCard || defaults.bgCard),
        };
        Object.assign(decls, deriveAccentFamily(scheme, accentHex, surfaces));
    }

    if (custom.bgCard) {
        Object.assign(decls, deriveGlassTokens(scheme, custom.bgCard));
    }

    if (custom.bgPrimary) {
        Object.assign(decls, deriveScrimToken(custom.bgPrimary));
    }

    return decls;
}

/**
 * Compute final token values for a scheme (`DEFAULT_TOKENS[scheme]` keys with
 * custom and derived values overlaid).
 */
function resolveTokens(source, scheme) {
    const resolved = { ...DEFAULT_TOKENS[scheme] };
    const decls = buildSchemeDeclarations(source || EMPTY_SOURCE, scheme);
    for (const key of Object.keys(resolved)) {
        if (Object.hasOwn(decls, key)) {
            resolved[key] = decls[key];
        }
    }
    return resolved;
}

function formatRuleBlock(comment, selector, decls) {
    const entries = Object.entries(decls);
    if (entries.length === 0) return '';
    const lines = entries.map(([prop, val]) => `  ${prop}: ${val};`).join('\n');
    return `/* ${comment} */\n${selector} {\n${lines}\n}`;
}

/**
 * Compile a design source into a CSS stylesheet string.
 */
function compileCss(source) {
    const src = source || EMPTY_SOURCE;
    const blocks = [];

    const darkDecls = buildSchemeDeclarations(src, 'dark');
    const darkBlock = formatRuleBlock(
        'Design anpassen: Farben (Dunkel)',
        ':root:not([data-bs-theme="light"]), [data-bs-theme="dark"]',
        darkDecls
    );
    if (darkBlock) blocks.push(darkBlock);

    const lightDecls = buildSchemeDeclarations(src, 'light');
    const lightBlock = formatRuleBlock(
        'Design anpassen: Farben (Hell)',
        '[data-bs-theme="light"]',
        lightDecls
    );
    if (lightBlock) blocks.push(lightBlock);

    const rootDecls = {};
    const corners = src.corners || 'standard';
    if (corners !== 'standard' && Object.hasOwn(CORNERS, corners)) {
        const [sm, md, lg] = CORNERS[corners];
        rootDecls['--radius-sm'] = sm;
        rootDecls['--radius'] = md;
        rootDecls['--radius-lg'] = lg;
    }
    const font = src.font || 'inter';
    if (font !== 'inter' && FONTS[font]) {
        rootDecls['--font-body'] = FONTS[font];
    }
    const rootBlock = formatRuleBlock(
        'Design anpassen: Ecken und Schrift',
        ':root',
        rootDecls
    );
    if (rootBlock) blocks.push(rootBlock);

    const freeCss = typeof src.css === 'string' ? src.css.trim() : '';
    if (freeCss) {
        blocks.push(`/* Eigenes CSS */\n${freeCss}`);
    }

    if (blocks.length === 0) return '';
    return `${blocks.join('\n')}\n`;
}

const CONTRAST_TEXT_LABELS = Object.freeze({
    '--text-primary': 'Text',
    '--text-secondary': 'Text (zweitrangig)',
    '--text-muted': 'Text (gedämpft)',
    '--accent-text': 'Akzent-Text',
    '--accent-light': 'Akzent hell',
    '--on-accent': 'Text auf Akzent-Buttons',
});

const CONTRAST_SURFACE_LABELS = Object.freeze({
    '--bg-primary': 'Seitenhintergrund',
    '--bg-secondary': 'Zweiter Hintergrund',
    '--bg-card': 'Karten',
    '--bg-glass': 'Glasflächen',
    '--bg-glass-hover': 'Glasflächen (Hover)',
    '--accent-fill': 'Akzent-Buttons',
    '--accent-fill-hover': 'Akzent-Buttons (Hover)',
});

const TEXT_TOKENS = [
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--accent-text',
    '--accent-light',
];

const SURFACE_TOKENS = [
    '--bg-primary',
    '--bg-secondary',
    '--bg-card',
    '--bg-glass',
    '--bg-glass-hover',
];

const FILL_TOKENS = ['--accent-fill', '--accent-fill-hover'];

/**
 * Return WCAG AA contrast warnings (< 4.5:1) for both schemes.
 */
function contrastWarnings(source) {
    const warnings = [];
    const src = source || EMPTY_SOURCE;

    for (const scheme of ['dark', 'light']) {
        const tokens = resolveTokens(src, scheme);
        const bgPrimary = parseColor(tokens['--bg-primary']);

        const resolveSurface = (surfaceKey) => {
            const raw = parseColor(tokens[surfaceKey]);
            return raw.a < 1 ? composite(raw, bgPrimary) : raw;
        };

        const checkPair = (textKey, surfaceKey) => {
            const fg = parseColor(tokens[textKey]);
            const bg = resolveSurface(surfaceKey);
            const rawRatio = contrastRatio(fg, bg);
            if (rawRatio < 4.5) {
                const floored = Math.floor(rawRatio * 10) / 10;
                const ratioStr = floored.toFixed(1).replace('.', ',');
                warnings.push({
                    scheme,
                    text: textKey,
                    surface: surfaceKey,
                    ratio: floored,
                    message: `${SCHEME_LABELS[scheme]}: ${CONTRAST_TEXT_LABELS[textKey]} auf ${CONTRAST_SURFACE_LABELS[surfaceKey]} hat ${ratioStr} : 1 – für gute Lesbarkeit sind mindestens 4,5 : 1 nötig.`,
                });
            }
        };

        for (const textKey of TEXT_TOKENS) {
            for (const surfaceKey of SURFACE_TOKENS) {
                checkPair(textKey, surfaceKey);
            }
        }
        for (const fillKey of FILL_TOKENS) {
            checkPair('--on-accent', fillKey);
        }
    }

    return warnings;
}

/**
 * List German labels of fields that changed between `before` and `after`.
 */
function changedLabels(before, after) {
    const base = before || EMPTY_SOURCE;
    const next = after || EMPTY_SOURCE;
    const labels = [];

    for (const scheme of ['dark', 'light']) {
        for (const key of TOKEN_KEYS) {
            const a = base.tokens?.[scheme]?.[key] ?? '';
            const b = next.tokens?.[scheme]?.[key] ?? '';
            if (a !== b) {
                labels.push(`${FIELD_LABELS[key]} (${SCHEME_LABELS[scheme]})`);
            }
        }
    }

    if ((base.corners ?? 'standard') !== (next.corners ?? 'standard')) {
        labels.push('Ecken');
    }
    if ((base.font ?? 'inter') !== (next.font ?? 'inter')) {
        labels.push('Schrift');
    }
    if ((base.css ?? '') !== (next.css ?? '')) {
        labels.push('Eigenes CSS geändert');
    }

    return labels;
}

/**
 * Check whether the free CSS changed between `published` and `draft`.
 */
function cssChanged(published, draft) {
    return (published?.css ?? '') !== (draft?.css ?? '');
}

module.exports = {
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
    composite,
    contrastRatio,
};
