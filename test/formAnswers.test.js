const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeFormAnswers, FORM_ANSWER_MAX_LENGTH } = require('../utils/formFields');

const FIELDS = [
    { label: 'Charakter', type: 'text', required: true },
    { label: 'Klasse', type: 'dropdown', options: ['Krieger', 'Magier'] },
    { label: 'Regeln gelesen', type: 'checkbox', required: true },
    { label: 'Mitspieler', type: 'user' }
];

test('keeps only the fields of the form, in form order', () => {
    const answers = sanitizeFormAnswers(FIELDS, {
        Admin: true, 'Regeln gelesen': true, Charakter: 'Thrall', __proto__: { polluted: true }, Klasse: 'Magier'
    });
    assert.deepEqual(Object.keys(answers), ['Charakter', 'Klasse', 'Regeln gelesen']);
    assert.deepEqual(answers, { Charakter: 'Thrall', Klasse: 'Magier', 'Regeln gelesen': true });
    assert.equal({}.polluted, undefined);
});

test('checkboxes are strict booleans, other answers strings', () => {
    const answers = sanitizeFormAnswers(FIELDS, {
        Charakter: { nested: 'x' }, 'Regeln gelesen': 'true', Mitspieler: ['@a', '@b']
    });
    assert.deepEqual(answers, { Charakter: '', 'Regeln gelesen': false, Mitspieler: '' });
});

test('a dropdown accepts only its own options', () => {
    assert.deepEqual(sanitizeFormAnswers(FIELDS, { Klasse: 'Hacker' }), { Klasse: '' });
});

test('text answers are cut to the maximum length', () => {
    const long = 'x'.repeat(FORM_ANSWER_MAX_LENGTH + 50);
    assert.equal(FORM_ANSWER_MAX_LENGTH, 2000);
    assert.equal(sanitizeFormAnswers(FIELDS, { Charakter: long }).Charakter.length, FORM_ANSWER_MAX_LENGTH);
});

test('an event without a form stores no answers', () => {
    assert.deepEqual(sanitizeFormAnswers([], { Admin: true, notes: 'x'.repeat(10) }), {});
    assert.deepEqual(sanitizeFormAnswers(FIELDS, 'kaputt'), {});
    assert.deepEqual(sanitizeFormAnswers(FIELDS, null), {});
});
