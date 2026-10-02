#!/usr/bin/env node
/**
 * Knowledge graph of the project wiki (docs/wiki).
 *
 * Every wiki page starts with a frontmatter block that declares its node id,
 * type, tags, the source files it documents and typed edges to other nodes.
 * This script parses all pages, validates them, derives the reverse edges and
 * writes docs/wiki/graph.json -> a compact, machine-readable index that tools
 * and LLMs can load instead of reading the whole wiki.
 *
 * Usage:
 *   node scripts/wiki-graph.js          -> validate and (re)write graph.json
 *   node scripts/wiki-graph.js --check  -> validate only, fail when graph.json is stale
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const WIKI_DIR = path.join(REPO_ROOT, 'docs', 'wiki');
const GRAPH_FILE = path.join(WIKI_DIR, 'graph.json');

/** Allowed node types. */
const NODE_TYPES = ['overview', 'module', 'concept', 'ops', 'howto', 'reference'];

/** Edges an author declares in the frontmatter. */
const EDGE_TYPES = ['depends_on', 'part_of', 'see_also'];

/** Fields every page must declare. */
const REQUIRED_FIELDS = ['id', 'title', 'type', 'tags', 'sources'];

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TLDR_PATTERN = /^> TL;DR:\s*(.+)$/m;
const LINK_PATTERN = /\]\(([^)\s]+)\)/g;
const EXTERNAL_LINK = /^([a-z]+:|#)/i;

/**
 * Parse the frontmatter block of a wiki page.
 *
 * Supports exactly the subset the wiki uses: `key: value` scalars (optionally
 * quoted) and flow lists `key: [a, b]`.
 *
 * @param {string} text -> Complete page content.
 * @returns {{ data: Object, body: string }} -> Frontmatter fields and the page body.
 * @throws {Error} -> When the block is missing or a line is malformed.
 */
function parseFrontmatter(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines[0] !== '---') {
        throw new Error('page does not start with a frontmatter block (---)');
    }

    const end = lines.indexOf('---', 1);
    if (end === -1) {
        throw new Error('frontmatter has no closing ---');
    }

    const data = {};
    for (const line of lines.slice(1, end)) {
        if (!line.trim()) continue;
        const match = line.match(/^([a-z_]+):\s*(.*)$/);
        if (!match) {
            throw new Error(`malformed frontmatter line: "${line}"`);
        }
        data[match[1]] = parseValue(match[2].trim());
    }

    return { data, body: lines.slice(end + 1).join('\n') };
}

/**
 * Convert a frontmatter value into a string or a list of strings.
 *
 * @param {string} raw -> Value as written after the colon.
 * @returns {string|string[]} -> Parsed value.
 */
function parseValue(raw) {
    if (raw.startsWith('[') && raw.endsWith(']')) {
        return raw.slice(1, -1).split(',').map(item => unquote(item.trim())).filter(Boolean);
    }
    return unquote(raw);
}

function unquote(value) {
    return value.replace(/^(["'])(.*)\1$/, '$2');
}

/**
 * Collect all markdown files below a directory, sorted.
 *
 * @param {string} dir -> Directory to scan.
 * @returns {string[]} -> Paths relative to `dir`, with forward slashes.
 */
function listMarkdownFiles(dir) {
    const files = [];
    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.md')) files.push(path.relative(dir, full).split(path.sep).join('/'));
        }
    };
    walk(dir);
    return files.sort();
}

/**
 * Collect the relative link targets of a page body.
 *
 * @param {string} body -> Markdown body of the page.
 * @param {string} pageDir -> Absolute directory of the page.
 * @returns {Array<{ target: string, absolute: string }>} -> Links without anchors, resolved on disk.
 */
function collectLinks(body, pageDir) {
    return [...body.matchAll(LINK_PATTERN)]
        .map(match => match[1])
        .filter(target => !EXTERNAL_LINK.test(target))
        .map(target => {
            const withoutAnchor = target.split('#')[0];
            return { target: withoutAnchor, absolute: path.resolve(pageDir, withoutAnchor) };
        });
}

/**
 * Load every wiki page as a node.
 *
 * @param {string} wikiDir -> Root directory of the wiki.
 * @returns {Array<Object>} -> Frontmatter fields plus `path`, `file`, `summary` and `links`.
 */
function loadNodes(wikiDir) {
    return listMarkdownFiles(wikiDir).map(file => {
        const absolute = path.join(wikiDir, file);
        const { data, body } = parseFrontmatter(fs.readFileSync(absolute, 'utf8'));
        const tldr = body.match(TLDR_PATTERN);
        return {
            ...data,
            path: file,
            file: path.posix.basename(file, '.md'),
            summary: tldr ? tldr[1].trim() : '',
            links: collectLinks(body, path.dirname(absolute))
        };
    });
}

/**
 * Check every rule of the wiki graph.
 *
 * @param {Array<Object>} nodes -> Result of loadNodes().
 * @param {string} repoRoot -> Repository root the `sources` paths are relative to.
 * @returns {string[]} -> One message per broken rule, empty when the wiki is valid.
 */
function validateNodes(nodes, repoRoot) {
    const errors = [];
    const ids = new Set();

    for (const node of nodes) {
        const label = node.id || node.path;

        for (const field of REQUIRED_FIELDS) {
            if (node[field] === undefined) errors.push(`${label}: missing field "${field}"`);
        }
        if (node.id !== undefined) {
            if (ids.has(node.id)) errors.push(`${label}: duplicate id`);
            ids.add(node.id);
            if (!ID_PATTERN.test(node.id)) errors.push(`${label}: id must be lowercase-kebab-case`);
            if (node.id !== node.file) errors.push(`${label}: id must match the file name "${node.file}"`);
        }
        if (node.type !== undefined && !NODE_TYPES.includes(node.type)) {
            errors.push(`${label}: unknown type "${node.type}"`);
        }
        for (const list of ['tags', 'sources', ...EDGE_TYPES]) {
            if (node[list] !== undefined && !Array.isArray(node[list])) {
                errors.push(`${label}: "${list}" must be a list like [a, b]`);
            }
        }
        for (const source of asList(node.sources)) {
            if (!fs.existsSync(path.join(repoRoot, source))) {
                errors.push(`${label}: source "${source}" does not exist`);
            }
        }
        if (!node.summary) errors.push(`${label}: missing "> TL;DR:" summary`);
        for (const link of node.links || []) {
            if (!fs.existsSync(link.absolute)) errors.push(`${label}: broken link "${link.target}"`);
        }
    }

    for (const node of nodes) {
        for (const type of EDGE_TYPES) {
            for (const target of asList(node[type])) {
                if (target === node.id) errors.push(`${node.id}: ${type} points to itself`);
                else if (!ids.has(target)) errors.push(`${node.id}: unknown ${type} target "${target}"`);
            }
        }
    }

    return errors;
}

function asList(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Build the graph: nodes with all neighbours (declared and derived) plus the
 * declared edges.
 *
 * Derived neighbours: `used_by` (reverse of depends_on), `parts` (reverse of
 * part_of); see_also is treated as symmetric.
 *
 * @param {Array<Object>} nodes -> Valid result of loadNodes().
 * @returns {{ nodes: Array<Object>, edges: Array<Object> }} -> Deterministic graph.
 */
function buildGraph(nodes) {
    const edges = [];
    for (const node of nodes) {
        for (const type of EDGE_TYPES) {
            for (const target of asList(node[type])) edges.push({ from: node.id, to: target, type });
        }
    }
    edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));

    const neighbours = (id, type, direction) => edges
        .filter(edge => edge.type === type && edge[direction === 'out' ? 'from' : 'to'] === id)
        .map(edge => edge[direction === 'out' ? 'to' : 'from']);
    const unique = (list) => [...new Set(list)].sort();

    const graphNodes = nodes
        .map(node => ({
            id: node.id,
            title: node.title,
            type: node.type,
            path: node.path,
            summary: node.summary,
            tags: [...asList(node.tags)].sort(),
            sources: [...asList(node.sources)].sort(),
            depends_on: unique(neighbours(node.id, 'depends_on', 'out')),
            used_by: unique(neighbours(node.id, 'depends_on', 'in')),
            part_of: unique(neighbours(node.id, 'part_of', 'out')),
            parts: unique(neighbours(node.id, 'part_of', 'in')),
            see_also: unique([...neighbours(node.id, 'see_also', 'out'), ...neighbours(node.id, 'see_also', 'in')])
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    return { nodes: graphNodes, edges };
}

/**
 * Serialize the graph exactly as it is stored in graph.json.
 *
 * @param {Object} graph -> Result of buildGraph().
 * @returns {string} -> Pretty-printed JSON with a trailing newline.
 */
function serializeGraph(graph) {
    return `${JSON.stringify(graph, null, 2)}\n`;
}

function main() {
    const checkOnly = process.argv.includes('--check');
    const nodes = loadNodes(WIKI_DIR);
    const errors = validateNodes(nodes, REPO_ROOT);

    if (errors.length > 0) {
        console.error(`❌ Wiki graph is invalid (${errors.length} problem(s)):`);
        errors.forEach(error => console.error(`   - ${error}`));
        process.exit(1);
    }

    const graph = buildGraph(nodes);
    const json = serializeGraph(graph);

    if (checkOnly) {
        const current = fs.existsSync(GRAPH_FILE) ? fs.readFileSync(GRAPH_FILE, 'utf8').replace(/\r\n/g, '\n') : '';
        if (current !== json) {
            console.error('❌ docs/wiki/graph.json is stale -> run "npm run wiki"');
            process.exit(1);
        }
        console.log(`✅ Wiki graph is valid and up to date (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
        return;
    }

    fs.writeFileSync(GRAPH_FILE, json);
    console.log(`✅ Wrote docs/wiki/graph.json (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
}

if (require.main === module) main();

module.exports = {
    parseFrontmatter,
    loadNodes,
    validateNodes,
    buildGraph,
    serializeGraph,
    NODE_TYPES,
    EDGE_TYPES,
    WIKI_DIR,
    GRAPH_FILE
};
