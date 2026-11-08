const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

// Docs that tell operators how to back up the database
const DOCS = ['README.md', 'docs/wiki/ops/deployment.md'];

test('documented pg_dump backups run without a TTY', () => {
    for (const file of DOCS) {
        const lines = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').split(/\r?\n/).filter(line => line.includes('pg_dump'));
        assert.ok(lines.length > 0, `${file} documents no pg_dump backup`);
        for (const line of lines) {
            // Without -T, docker compose exec allocates a TTY and the redirected dump can get CRLF line ends
            assert.match(line, /docker compose exec -T postgres pg_dump/, `${file}: ${line.trim()}`);
        }
    }
});
