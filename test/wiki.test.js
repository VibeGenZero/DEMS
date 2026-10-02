const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir } = require('./helpers');
const {
    parseFrontmatter,
    loadNodes,
    validateNodes,
    buildGraph,
    serializeGraph,
    WIKI_DIR,
    GRAPH_FILE
} = require('../scripts/wiki-graph');

const REPO_ROOT = path.join(__dirname, '..');

/**
 * Write a wiki page with frontmatter into `dir`.
 *
 * @param {string} dir -> Wiki directory.
 * @param {string} file -> File name relative to `dir`.
 * @param {Object} fields -> Frontmatter fields (arrays become flow lists).
 * @param {string} [body] -> Page body.
 */
function writePage(dir, file, fields, body = '> TL;DR: Example page.\n') {
    const lines = Object.entries(fields).map(([key, value]) =>
        `${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value}`);
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `---\n${lines.join('\n')}\n---\n# ${fields.title}\n\n${body}`);
}

const page = (id, extra = {}) => ({
    id,
    title: `Title of ${id}`,
    type: 'concept',
    tags: ['example'],
    sources: ['server.js'],
    ...extra
});

test('parseFrontmatter reads scalars and flow lists, with CRLF line endings', () => {
    const text = '---\r\nid: data-model\r\ntitle: "Data model"\r\ntags: [db, firestore]\r\nsources: []\r\n---\r\n# Data model\r\n';
    const { data, body } = parseFrontmatter(text);
    assert.deepEqual(data, { id: 'data-model', title: 'Data model', tags: ['db', 'firestore'], sources: [] });
    assert.equal(body.trim(), '# Data model');
});

test('parseFrontmatter rejects pages without frontmatter or with malformed lines', () => {
    assert.throws(() => parseFrontmatter('# No frontmatter\n'), /frontmatter/);
    assert.throws(() => parseFrontmatter('---\nid data-model\n---\n'), /line/);
    assert.throws(() => parseFrontmatter('---\nid: x\n'), /closing/);
});

test('validateNodes reports every broken rule', () => {
    const dir = createTempDir('wiki-invalid');
    writePage(dir, 'concepts/a.md', page('a', { depends_on: ['missing-node'] }));
    writePage(dir, 'concepts/b.md', page('b', { type: 'unknown-type' }));
    writePage(dir, 'concepts/c.md', page('c', { sources: ['does/not/exist.js'] }));
    writePage(dir, 'concepts/d.md', page('d'), 'No summary here.\n');
    writePage(dir, 'concepts/e.md', page('wrong-id'));
    writePage(dir, 'concepts/f.md', page('f', { see_also: ['f'] }));
    writePage(dir, 'other/a.md', page('a'));
    writePage(dir, 'concepts/g.md', { id: 'g', title: 'No type', tags: ['x'], sources: [] });

    const errors = validateNodes(loadNodes(dir), REPO_ROOT).join('\n');
    assert.match(errors, /a: unknown depends_on target "missing-node"/);
    assert.match(errors, /b: unknown type "unknown-type"/);
    assert.match(errors, /c: source "does\/not\/exist\.js" does not exist/);
    assert.match(errors, /d: missing "> TL;DR:" summary/);
    assert.match(errors, /wrong-id: id must match the file name "e"/);
    assert.match(errors, /f: see_also points to itself/);
    assert.match(errors, /a: duplicate id/);
    assert.match(errors, /g: missing field "type"/);
});

test('validateNodes reports relative links that do not resolve', () => {
    const dir = createTempDir('wiki-links');
    writePage(dir, 'modules/server.md', page('server', { type: 'module' }),
        '> TL;DR: Links.\n\nSee [auth](../concepts/auth.md#flow), [gone](../concepts/gone.md), [web](https://example.com) and [top](#top).\n');
    writePage(dir, 'concepts/auth.md', page('auth'));

    const errors = validateNodes(loadNodes(dir), REPO_ROOT);
    assert.deepEqual(errors, ['server: broken link "../concepts/gone.md"']);
});

test('a valid wiki produces no errors', () => {
    const dir = createTempDir('wiki-valid');
    writePage(dir, 'modules/server.md', page('server', { type: 'module' }));
    writePage(dir, 'concepts/auth.md', page('auth', { depends_on: ['server'], see_also: ['server'] }));
    assert.deepEqual(validateNodes(loadNodes(dir), REPO_ROOT), []);
});

test('buildGraph derives reverse edges and sorts deterministically', () => {
    const dir = createTempDir('wiki-graph');
    writePage(dir, 'modules/server.md', page('server', { type: 'module' }));
    writePage(dir, 'concepts/auth.md', page('auth', { depends_on: ['server'], see_also: ['csrf'] }));
    writePage(dir, 'concepts/csrf.md', page('csrf', { part_of: ['auth'] }));
    writePage(dir, 'concepts/session.md', page('session', { see_also: ['auth'] }));

    const graph = buildGraph(loadNodes(dir));
    const byId = Object.fromEntries(graph.nodes.map(node => [node.id, node]));

    assert.deepEqual(graph.nodes.map(node => node.id), ['auth', 'csrf', 'server', 'session']);
    assert.deepEqual(byId.server.used_by, ['auth']);
    assert.deepEqual(byId.auth.parts, ['csrf']);
    assert.deepEqual(byId.csrf.part_of, ['auth']);
    assert.equal(byId.auth.path, 'concepts/auth.md');
    assert.equal(byId.auth.summary, 'Example page.');
    assert.deepEqual(graph.edges, [
        { from: 'auth', to: 'csrf', type: 'see_also' },
        { from: 'auth', to: 'server', type: 'depends_on' },
        { from: 'csrf', to: 'auth', type: 'part_of' },
        { from: 'session', to: 'auth', type: 'see_also' }
    ]);
});

test('see_also is symmetric and skips nodes already linked by a stronger relation', () => {
    const dir = createTempDir('wiki-see-also');
    writePage(dir, 'concepts/auth.md', page('auth', { see_also: ['csrf'] }));
    writePage(dir, 'concepts/csrf.md', page('csrf', { part_of: ['auth'] }));
    writePage(dir, 'concepts/session.md', page('session', { see_also: ['auth'] }));

    const byId = Object.fromEntries(buildGraph(loadNodes(dir)).nodes.map(node => [node.id, node]));
    assert.deepEqual(byId.auth.see_also, ['session']);
    assert.deepEqual(byId.session.see_also, ['auth']);
    assert.deepEqual(byId.csrf.see_also, []);
});

test('serializeGraph writes valid JSON with one node and one edge per line', () => {
    const dir = createTempDir('wiki-serialize');
    writePage(dir, 'modules/server.md', page('server', { type: 'module' }));
    writePage(dir, 'concepts/auth.md', page('auth', { depends_on: ['server'] }));

    const graph = buildGraph(loadNodes(dir));
    const text = serializeGraph(graph);
    assert.deepEqual(JSON.parse(text), graph);

    const lines = text.trimEnd().split('\n');
    for (const node of graph.nodes) {
        assert.equal(lines.filter(line => line.includes(`"id":"${node.id}"`)).length, 1, node.id);
    }
    assert.ok(lines.some(line => line.trim().startsWith('{"from":"auth","to":"server"')));
    assert.ok(text.endsWith('\n'));
});

test('the project wiki is valid and graph.json is up to date', () => {
    const nodes = loadNodes(WIKI_DIR);
    assert.deepEqual(validateNodes(nodes, REPO_ROOT), []);

    const expected = serializeGraph(buildGraph(nodes));
    const actual = fs.readFileSync(GRAPH_FILE, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(actual, expected, 'docs/wiki/graph.json is stale -> run "npm run wiki"');
});
