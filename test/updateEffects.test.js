const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, isHidden, REPO_ROOT } = require('./helpers');

const EMOJI = /\p{Extended_Pictographic}/u;
const KINDS = ['confetti', 'powerup', 'bugs'];
const COUNTS = { confetti: 60, powerup: 28, bugs: 14 };
const news = (version) => ({ '/api/updates': { version, date: '2026-10-13', news: [{ title: 'Neu', content: 'Text' }] } });
const pieceCount = (element) => element.innerHTML.split('update-effect-piece ').length - 1;

/**
 * Repeatable pseudo-random numbers in [0, 1), so a test meets many positions and stays the same on every run.
 *
 * @param {number} seed -> Start value.
 * @returns {Function} -> Stand-in for Math.random.
 */
function seededRandom(seed) {
    let value = seed;
    return () => {
        value = (value * 1103515245 + 12345) % 2147483648;
        return value / 2147483648;
    };
}

// The pure functions need no page, so one load serves them
const frontend = loadFrontendApp({});

test('the version number picks the effect', async () => {
    const { app } = await frontend;
    const kinds = {
        '3.0.0': 'confetti', '4.0.0': 'confetti', 'v3.0.0': 'confetti', '3.0.0-beta.1': 'confetti', '3.0.0-beta.3': 'confetti',
        '3.1.0': 'powerup', '2.6.0': 'powerup', ' 3.2.0 ': 'powerup', '3.1.0-rc.2': 'powerup',
        '3.0.1': 'bugs', '3.1.4': 'bugs', '10.20.30': 'bugs'
    };
    for (const [version, kind] of Object.entries(kinds)) assert.equal(app.updateEffectKind(version), kind, version);
    for (const unreadable of ['', '3.1', 'abc', '3.x.0', 'neu', undefined, null, 3.1, {}]) {
        assert.equal(app.updateEffectKind(unreadable), null, String(unreadable));
    }
});

test('every effect has its own number of pieces, all inside the screen', async () => {
    const { app } = await frontend;
    for (const random of [() => 0, () => 0.999999, seededRandom(7)]) {
        for (const kind of KINDS) {
            const pieces = app.buildEffectPieces(kind, random);
            assert.equal(pieces.length, COUNTS[kind], kind);
            for (const piece of pieces) {
                assert.ok(piece.left >= 0 && piece.left <= 100, `${kind} left ${piece.left}`);
                assert.ok(piece.delay >= 0 && piece.delay <= 1500, `${kind} delay ${piece.delay}`);
                assert.ok(piece.duration >= 1000 && piece.duration <= 4000, `${kind} duration ${piece.duration}`);
                assert.ok(piece.tone >= 1 && piece.tone <= 6, `${kind} tone ${piece.tone}`);
            }
        }
    }
    // The list comes from the page's own realm, so its length is compared, not the array
    for (const unknown of ['rainbow', 'constructor', '__proto__', '', undefined, null]) {
        assert.equal(app.buildEffectPieces(unknown).length, 0, String(unknown));
    }
});

test('bugs pop up around the dialog, not on it', async () => {
    const { app } = await frontend;
    for (const seed of [1, 2, 3, 4, 5]) {
        for (const bug of app.buildEffectPieces('bugs', seededRandom(seed))) {
            const beside = bug.left <= 22 || bug.left >= 78;
            const aboveOrBelow = bug.top <= 16 || bug.top >= 82;
            assert.ok(beside || aboveOrBelow, `bug at ${bug.left}% / ${bug.top}% sits on the dialog`);
            assert.ok(bug.top >= 0 && bug.top <= 100, `top ${bug.top}`);
        }
    }
});

test('the pieces are icons and plain shapes, no emojis and no style attributes', async () => {
    const { app } = await frontend;
    const iconFont = fs.readFileSync(path.join(REPO_ROOT, 'public', 'vendor', 'bootstrap-icons', 'bootstrap-icons.css'), 'utf8');

    const confetti = app.renderEffectPieces('confetti', seededRandom(1));
    assert.equal(confetti.split('<span class="update-effect-piece is-confetti update-effect-tone-').length - 1, COUNTS.confetti);
    assert.doesNotMatch(confetti, /<i /);

    const powerup = app.renderEffectPieces('powerup', seededRandom(1));
    const powerupIcons = [...powerup.matchAll(/<i class="bi bi-([a-z-]+) update-effect-piece is-powerup update-effect-tone-\d"/g)].map(match => match[1]);
    assert.equal(powerupIcons.length, COUNTS.powerup);
    assert.deepEqual([...new Set(powerupIcons)].sort(), ['arrow-up', 'lightning-charge-fill', 'plus-lg', 'stars']);

    const bugs = app.renderEffectPieces('bugs', seededRandom(1));
    assert.equal(bugs.split('<i class="bi bi-bug-fill update-effect-piece is-bug update-effect-tone-').length - 1, COUNTS.bugs);
    assert.equal(bugs.split('data-fx-top="').length - 1, COUNTS.bugs);

    for (const icon of [...powerupIcons, 'bug-fill']) assert.ok(iconFont.includes(`.bi-${icon}::before`), icon);
    for (const html of [confetti, powerup, bugs]) {
        assert.doesNotMatch(html, EMOJI);
        assert.doesNotMatch(html, /style=/);
        assert.match(html, /data-fx-left="[\d.]+" data-fx-delay="\d+" data-fx-duration="\d+" data-fx-drift="-?\d+" data-fx-turn="-?\d+"/);
    }
    assert.equal(app.renderEffectPieces('rainbow'), '');
});

test('an effect fills the layer and shows it; an unknown one leaves it alone', async () => {
    const { app, element } = await loadFrontendApp({});
    const layer = element('update-effects');
    assert.equal(isHidden(layer), true);

    assert.equal(app.playUpdateEffect('confetti'), true);
    assert.equal(isHidden(layer), false);
    assert.equal(pieceCount(layer), COUNTS.confetti);

    assert.equal(app.playUpdateEffect('rainbow'), false);
    assert.equal(pieceCount(layer), COUNTS.confetti);

    // The next effect replaces the pieces instead of adding to them
    assert.equal(app.playUpdateEffect('bugs'), true);
    assert.equal(pieceCount(layer), COUNTS.bugs);
});

test('the news dialog celebrates a version once per browser', async () => {
    const { app, element } = await loadFrontendApp(news('3.1.0'));
    const layer = element('update-effects');
    await app.showNewsAfterLogin();
    assert.equal(element('updates-version-badge').textContent, '3.1.0');
    assert.match(layer.innerHTML, /is-powerup/);
    assert.equal(pieceCount(layer), COUNTS.powerup);

    // A second call on the same page opens nothing and plays nothing (D-13: once per version)
    layer.innerHTML = '';
    await app.showNewsAfterLogin();
    assert.equal(layer.innerHTML, '');
});

test('the next version celebrates again, with its own effect', async () => {
    const celebrated = { dems_last_effect_version: '3.1.0' };
    const same = await loadFrontendApp(news('3.1.0'), { storage: celebrated });
    await same.app.showNewsAfterLogin();
    assert.equal(same.element('update-effects').innerHTML, '');

    const patch = await loadFrontendApp(news('3.1.1'), { storage: celebrated });
    await patch.app.showNewsAfterLogin();
    assert.match(patch.element('update-effects').innerHTML, /is-bug/);

    const major = await loadFrontendApp(news('4.0.0'), { storage: celebrated });
    await major.app.showNewsAfterLogin();
    assert.match(major.element('update-effects').innerHTML, /is-confetti/);
});

test('no dialog, no effect: a dismissed version stays quiet', async () => {
    const { app, element } = await loadFrontendApp(news('3.0.0'), { storage: { dems_last_seen_version: '3.0.0' } });
    await app.showNewsAfterLogin();
    assert.equal(element('update-effects').innerHTML, '');
    assert.equal(isHidden(element('update-effects')), true);
});

test('a version nobody can read shows the dialog without an effect', async () => {
    const { app, element, toasts } = await loadFrontendApp(news('neu'));
    await app.showNewsAfterLogin();
    assert.equal(element('updates-version-badge').textContent, 'neu');
    assert.match(element('updates-content').innerHTML, /Neu/);
    assert.equal(element('update-effects').innerHTML, '');
    assert.deepEqual(toasts, []);
});

test('with reduced motion nothing moves', async () => {
    const { app, element } = await loadFrontendApp(news('3.0.0'), { reducedMotion: true });
    const layer = element('update-effects');
    assert.equal(app.playUpdateEffect('confetti'), false);
    await app.showNewsAfterLogin();
    assert.equal(layer.innerHTML, '');
    assert.equal(isHidden(layer), true);
    // The dialog itself still opens
    assert.equal(element('updates-version-badge').textContent, '3.0.0');
});

test('the styleguide can play each effect', async () => {
    const { app, element } = await loadFrontendApp({});
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    for (const kind of KINDS) {
        assert.match(html, new RegExp(`data-click="playUpdateEffect" data-kind="${kind}"`), kind);
    }
    assert.ok(app.actionNames().includes('playUpdateEffect'));
    await app.runAction('playUpdateEffect', { dataset: { kind: 'bugs' } });
    assert.match(element('update-effects').innerHTML, /is-bug/);
});

test('the unused confetti rule made way for the effects', () => {
    const css = fs.readFileSync(path.join(REPO_ROOT, 'public', 'css', 'style.css'), 'utf8');
    assert.doesNotMatch(css, /^\.confetti\b/m);
    assert.doesNotMatch(css, /@keyframes fall\b/);
    for (const name of ['update-confetti', 'update-powerup', 'update-bug']) assert.match(css, new RegExp(`@keyframes ${name}\\b`), name);
    assert.match(css, /prefers-reduced-motion: reduce/);
});
