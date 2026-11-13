'use strict';

/**
 * Mock provider for the dev mock mode and tests: answers without network.
 * Same shape as the real adapters: `create()` -> `{ chat, listModels }`.
 */

const USAGE = { inputTokens: 10, outputTokens: 10 };

function lastUserText(messages) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] && list[i].role === 'user') return String(list[i].text || '');
    }
    return '';
}

function create() {
    async function chat({ messages, onToken, json } = {}) {
        const last = lastUserText(messages);
        const text = json
            ? JSON.stringify({ patch: { title: last.slice(0, 60) }, reply: 'Entwurf ist im Formular.', questions: [] })
            : `Mock-Antwort: ${last}\nQuelle: Beschreibung`;
        if (typeof onToken === 'function') {
            // Word by word, spaces kept, so the pieces joined equal the text
            for (const piece of text.match(/[^ ]+ *| +/g) || []) onToken(piece);
        }
        return { text, usage: { ...USAGE } };
    }

    async function listModels() {
        return ['mock-1'];
    }

    return { chat, listModels };
}

module.exports = { create };
