const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

// Comments mirrored from the Discord discussion thread (B-16) say where they come from

const frontend = loadFrontendApp({});
const COMMENT = { id: 'c1', userId: 'u-x', userName: 'Kira', userAvatar: '', text: 'Wer bringt Snacks?', createdAt: '2026-10-31T18:00:00.000Z' };

test('a comment from Discord shows the „Discord“ chip, a website comment does not', async () => {
    const { app } = await frontend;
    const fromDiscord = app.renderComment({ ...COMMENT, source: 'discord' }, 'ev', true);
    assert.match(fromDiscord, /<span class="chip chip-sm chip-info"><i class="bi bi-discord me-1"><\/i>Discord<\/span>/);

    for (const source of ['web', undefined]) {
        assert.doesNotMatch(app.renderComment({ ...COMMENT, source }, 'ev', true), /bi-discord/, String(source));
    }
});

test('an edited comment says so next to its date', async () => {
    const { app } = await frontend;
    assert.match(app.renderComment({ ...COMMENT, source: 'discord', editedAt: '2026-10-31T18:05:00.000Z' }, 'ev', true), /comment-date">[^<]*\(bearbeitet\)</);
    assert.doesNotMatch(app.renderComment(COMMENT, 'ev', true), /bearbeitet/);
});
