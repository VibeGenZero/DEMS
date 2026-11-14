'use strict';

/**
 * Parses one SSE block (lines between two blank lines).
 * @returns {{ event: string, data: string } | null} null for comment-only or data-less blocks
 */
function parseBlock(block) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
    }
    return data.length ? { event, data: data.join('\n') } : null;
}

/**
 * Reads a fetch Response as server-sent events.
 * @param {Response} response
 * @returns {AsyncGenerator<{ event: string, data: string }>}
 */
async function* readServerSentEvents(response) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
            const parsed = parseBlock(buffer.slice(0, end));
            buffer = buffer.slice(end + 2);
            if (parsed) yield parsed;
        }
    }
    buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
    const rest = parseBlock(buffer);
    if (rest) yield rest;
}

module.exports = { readServerSentEvents };
