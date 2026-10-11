/**
 * Reads rendered HTML strings in the frontend tests: elements with their
 * attributes as the browser sees them, and element doubles for app.runAction().
 */
const assert = require('node:assert/strict');

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>' };

/**
 * Decode an attribute value the way the browser does when it reads it.
 *
 * @param {string} value -> Raw attribute value from the HTML string.
 * @returns {string} -> Attribute value as the page sees it.
 */
function decodeAttribute(value) {
    return value.replace(/&(quot|amp|lt|gt|#0*39);/g, (match, name) => ENTITIES[name] || "'");
}

/**
 * Elements in rendered HTML that carry `attribute`, with every attribute decoded.
 *
 * @param {string} html -> Rendered HTML.
 * @param {string} attribute -> e.g. "data-click".
 * @returns {Array<{ tag: string, attributes: Object<string, string> }>}
 */
function elementsWith(html, attribute) {
    const found = [];
    for (const tag of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
        const attributes = {};
        for (const attr of tag[2].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            attributes[attr[1]] = decodeAttribute(attr[2] ?? attr[3]);
        }
        if (attribute in attributes) found.push({ tag: tag[1].toLowerCase(), attributes });
    }
    return found;
}

/**
 * Elements whose data-click/change/input names `action`; at least one must exist.
 */
function actionTargets(html, action, type = 'click') {
    const targets = elementsWith(html, `data-${type}`).filter(element => element.attributes[`data-${type}`] === action);
    assert.ok(targets.length > 0, `no element with data-${type}="${action}"`);
    return targets;
}

/**
 * Element double for app.runAction(): dataset from the data-* attributes.
 */
function actionElement({ tag, attributes }, extra = {}) {
    const dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith('data-')) dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
    }
    return { tagName: tag.toUpperCase(), dataset, value: attributes.value, getAttribute: (name) => attributes[name] ?? null, ...extra };
}

function assertNoInlineHandlers(html) {
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i);
}

module.exports = { decodeAttribute, elementsWith, actionTargets, actionElement, assertNoInlineHandlers };
