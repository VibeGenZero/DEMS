const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

async function loadCountdown() {
    const modules = await loadFrontendModules(path.join(REPO_ROOT, 'public', 'js', 'events', 'countdown.js'), vm.createContext({}));
    return modules.get('countdown.js');
}

test('only the digits that change flip', async () => {
    const { changedDigits } = await loadCountdown();
    assert.deepEqual(JSON.parse(JSON.stringify(changedDigits('14', '13'))), [1]);
    assert.deepEqual(JSON.parse(JSON.stringify(changedDigits('20', '19'))), [0, 1]);
    assert.deepEqual(JSON.parse(JSON.stringify(changedDigits('07', '07'))), []);
});

test('a unit that loses a digit is drawn anew', async () => {
    const { changedDigits } = await loadCountdown();
    assert.equal(changedDigits('10', '9'), 'rebuild');
});

test('every digit of the countdown sits in its own cell', async () => {
    const { renderCountdownHTML } = await loadCountdown();
    const html = renderCountdownHTML({ days: 1, hours: 2, mins: 3, secs: 4 });
    // Days without a leading zero (as before): 1 + 2 + 2 + 2 cells
    assert.equal(html.match(/class="countdown-digit"/g).length, 7);
    for (const label of ['Tage', 'Std', 'Min', 'Sek']) assert.match(html, new RegExp(`countdown-label">${label}<`));
    assert.match(html, /<span class="countdown-digit"><span>0<\/span><\/span><span class="countdown-digit"><span>4<\/span><\/span>/);
});

test('an event that has begun says so', async () => {
    const { renderCountdownHTML } = await loadCountdown();
    assert.match(renderCountdownHTML(null), /Event hat bereits begonnen/);
});
