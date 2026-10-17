const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendApp, loadFrontendModules, REPO_ROOT } = require('./helpers');
const { readCss, parseRules } = require('./cssSource');

const MOTION_FILE = path.join(REPO_ROOT, 'public', 'js', 'core', 'motion.js');

async function loadMotion() {
    const modules = await loadFrontendModules(MOTION_FILE, vm.createContext({}));
    return modules.get('motion.js');
}

test('calmVars keeps fades and drops every movement', async () => {
    const { calmVars } = await loadMotion();
    assert.deepEqual(
        JSON.parse(JSON.stringify(calmVars({ x: 40, y: 12, scale: 0.86, opacity: 1, duration: 0.45, ease: 'back.out(1.4)', stagger: 0.1 }))),
        { opacity: 1, duration: 0.2, ease: 'none' }
    );
    assert.equal(calmVars({ opacity: 0, duration: 0.15 }).duration, 0.15);
});

test('the spring is the one chosen in the prototype', async () => {
    const { SPRING } = await loadMotion();
    assert.equal(SPRING, 'back.out(1.4)');
});

test('with reduced motion a spring becomes a short fade', async () => {
    const { app, animations } = await loadFrontendApp({}, { reducedMotion: true });
    app.animateFromTo('#x', { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: app.SPRING });
    assert.deepEqual(JSON.parse(JSON.stringify(animations.at(-1).vars)), { opacity: 1, duration: 0.2, ease: 'none' });
});

test('without reduced motion the spring plays as written', async () => {
    const { app, animations } = await loadFrontendApp({});
    app.animateFromTo('#x', { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: app.SPRING });
    const last = animations.at(-1);
    assert.equal(last.method, 'fromTo');
    assert.equal(last.fromVars.x, 40);
    assert.equal(last.vars.ease, 'back.out(1.4)');
});

test('a pure movement without a fade is set at once under reduced motion', async () => {
    const { app, animations } = await loadFrontendApp({}, { reducedMotion: true });
    let done = false;
    app.animateTo('#x', { scale: 1, duration: 0.5, onComplete: () => { done = true; } });
    assert.equal(animations.at(-1).method, 'set');
    assert.equal(done, true);
});

test('numbers count up, or stand at once under reduced motion', async () => {
    const { app, animations } = await loadFrontendApp({});
    const number = { textContent: '13' };
    app.countUp(number, 13);
    assert.equal(animations.at(-1).vars.duration, 0.8);
    const calm = await loadFrontendApp({}, { reducedMotion: true });
    const still = { textContent: '' };
    calm.app.countUp(still, 7);
    assert.equal(still.textContent, '7');
    assert.equal(calm.animations.length, 0);
});

test('a meter grows from its start value with the spring', async () => {
    const { app, animations } = await loadFrontendApp({});
    const meter = { value: 5 };
    app.growMeter(meter, { from: 4 });
    const last = animations.at(-1);
    assert.equal(last.method, 'fromTo');
    assert.equal(last.fromVars.value, 4);
    assert.equal(last.vars.value, 5);
    assert.equal(last.vars.ease, 'back.out(1.4)');
    const calm = await loadFrontendApp({}, { reducedMotion: true });
    calm.app.growMeter({ value: 5 });
    assert.equal(calm.animations.length, 0);
});

test('the section fade has no movement under reduced motion', () => {
    const rules = parseRules(readCss('style.css'));
    const reduced = rules.find(rule => rule.selector === '.app-section' && /prefers-reduced-motion:\s*reduce/.test(rule.context));
    assert.ok(reduced, 'no .app-section rule for reduced motion');
    const animation = reduced.declarations.find(entry => entry.property === 'animation' || entry.property === 'animation-name');
    assert.match(animation.value, /sectionFadeInCalm/);
    const frames = rules.filter(rule => /@keyframes sectionFadeInCalm/.test(rule.context));
    assert.ok(frames.length > 0, 'keyframes sectionFadeInCalm missing');
    assert.ok(frames.every(frame => frame.declarations.every(entry => entry.property === 'opacity')));
});

/** A root that keeps one listener per event type, and a modal around a dialog element. */
function fakeRoot() {
    const listeners = {};
    return { listeners, addEventListener: (type, listener) => { listeners[type] = listener; } };
}

test('every dialog springs open and shrinks away', async () => {
    const { app, animations } = await loadFrontendApp({});
    const root = fakeRoot();
    const dialog = { name: 'dialog' };
    const modal = { querySelector: (selector) => (selector === '.modal-dialog' ? dialog : null) };
    app.initDialogMotion(root);

    root.listeners['show.bs.modal']({ target: modal });
    const open = animations.at(-1);
    assert.equal(open.method, 'fromTo');
    assert.equal(open.targets, dialog);
    assert.deepEqual(JSON.parse(JSON.stringify(open.fromVars)), { scale: 0.86, y: 12, opacity: 0 });
    assert.equal(open.vars.ease, 'back.out(1.4)');
    assert.equal(open.vars.duration, 0.45);

    root.listeners['hide.bs.modal']({ target: modal });
    const close = animations.at(-1);
    assert.equal(close.method, 'to');
    assert.equal(close.vars.scale, 0.94);
    assert.equal(close.vars.duration, 0.15);

    // A hide another handler refused keeps the dialog as it is
    const before = animations.length;
    root.listeners['hide.bs.modal']({ target: modal, defaultPrevented: true });
    assert.equal(animations.length, before);
});

test('a toast springs in from the right and glides out', async () => {
    const { app, animations, element } = await loadFrontendApp({});
    app.showToast('Gespeichert', 'success');
    const shown = animations.at(-1);
    assert.equal(shown.targets, element('app-toast'));
    assert.equal(shown.fromVars.x, 40);
    assert.equal(shown.vars.ease, 'back.out(1.4)');
    assert.equal(shown.vars.duration, 0.5);

    const root = fakeRoot();
    app.initDialogMotion(root);
    root.listeners['hide.bs.toast']({ target: element('app-toast') });
    assert.equal(animations.at(-1).vars.x, 40);
    assert.equal(animations.at(-1).vars.duration, 0.15);
});

test('with reduced motion a toast only fades in', async () => {
    const { app, animations } = await loadFrontendApp({}, { reducedMotion: true });
    app.showToast('Gespeichert', 'success');
    const shown = animations.at(-1);
    assert.equal(shown.method, 'fromTo');
    assert.equal('x' in shown.fromVars, false);
    assert.equal('x' in shown.vars, false);
});
