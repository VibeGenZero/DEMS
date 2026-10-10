/**
 * Colour maths for the WCAG contrast check. Used by the styleguide (#debug)
 * and by test/designTokens.test.js; no DOM access.
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/**
 * Parse a CSS colour: #rgb, #rrggbb, rgb(r, g, b), rgba(r, g, b, a), transparent.
 *
 * @param {string} value -> CSS colour value.
 * @returns {{ r: number, g: number, b: number, a: number }|null} -> Channels 0-255 and alpha 0-1; null if the value is no plain colour.
 */
export function parseColor(value) {
    const text = String(value ?? '').trim();
    if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const hex = HEX.exec(text);
    if (hex) {
        const digits = hex[1].length === 3 ? [...hex[1]].map(digit => digit + digit).join('') : hex[1];
        return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: 1 };
    }
    const rgb = RGB.exec(text);
    if (!rgb) return null;
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
}

/**
 * Lay a translucent colour over an opaque one.
 *
 * @param {{ r: number, g: number, b: number, a: number }} top -> Colour on top.
 * @param {{ r: number, g: number, b: number }} bottom -> Opaque colour below.
 * @returns {{ r: number, g: number, b: number, a: number }} -> Opaque result.
 */
export function composite(top, bottom) {
    const mix = (upper, lower) => upper * top.a + lower * (1 - top.a);
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
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
 *
 * @param {{ r: number, g: number, b: number }} a -> First colour.
 * @param {{ r: number, g: number, b: number }} b -> Second colour.
 * @returns {number} -> 1 (same) to 21 (black on white).
 */
export function contrastRatio(a, b) {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
}
