/**
 * Reader of the answer stream of POST /api/events/:id/ask (routes/eventAsk.js):
 * server-sent events `token` ({ text }), at the end `done` ({ source }) or
 * `error` ({ error }), each block closed by a blank line.
 */

export const INTERRUPTED_MESSAGE = 'Die Antwort wurde unterbrochen. Bitte versuche es noch einmal.';

// One block of lines -> { event, data } or null for a comment or a block without data
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

function parseData(text) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

/**
 * Read the answer stream and hand its events to the callbacks.
 *
 * Chunks may split an event or a multi-byte character anywhere; CRLF line
 * ends are read like LF. Exactly one of onDone and onError is called: a
 * stream that ends without `done` or `error` counts as interrupted. A failed
 * read (e.g. the request was aborted) rejects instead.
 *
 * @param {Response} response -> fetch response of the 200 event stream.
 * @param {Object} handlers -> `{ onToken(text), onDone({ source }), onError(message) }`.
 * @returns {Promise<void>} -> Resolves after onDone or onError.
 */
export async function readEventStream(response, { onToken, onDone, onError }) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    const handle = (block) => {
        const parsed = parseBlock(block);
        if (!parsed) return;
        const data = parseData(parsed.data);
        if (parsed.event === 'token') {
            if (typeof data.text === 'string' && data.text) onToken(data.text);
        } else if (parsed.event === 'done') {
            finished = true;
            onDone({ source: typeof data.source === 'string' ? data.source : '' });
        } else if (parsed.event === 'error') {
            finished = true;
            onError(typeof data.error === 'string' && data.error ? data.error : INTERRUPTED_MESSAGE);
        }
    };
    const drain = () => {
        buffer = buffer.replace(/\r\n/g, '\n');
        let end;
        while (!finished && (end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            handle(block);
        }
    };

    while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        drain();
    }
    if (finished) {
        // The server ends the stream after done/error; nothing after it matters
        reader.cancel().catch(() => {});
        return;
    }
    buffer += decoder.decode();
    drain();
    if (!finished && buffer.trim()) handle(buffer.replace(/\r\n/g, '\n'));
    if (!finished) onError(INTERRUPTED_MESSAGE);
}
