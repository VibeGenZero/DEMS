const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

// Guild names often end in "Server" already ("DEMS Dev Server") -> no "Server Server"
test('the server texts never append "Server" to the guild name', async () => {
    const { app } = await loadFrontendApp({});

    assert.deepEqual({ ...app.serverNameTexts('DEMS Dev Server') }, {
        meta: 'Dein Event-Management-System für DEMS Dev Server',
        events: 'Entdecke die Events von DEMS Dev Server und melde dich an!'
    });
    assert.deepEqual({ ...app.serverNameTexts('Raid-Gilde') }, {
        meta: 'Dein Event-Management-System für Raid-Gilde',
        events: 'Entdecke die Events von Raid-Gilde und melde dich an!'
    });
});
