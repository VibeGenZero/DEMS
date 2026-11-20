'use strict';

/**
 * Address guard of every AI request (security report 2026-11): admins type
 * the base URL, and the server fetched whatever it named, cloud metadata
 * included. Refused are link-local addresses (169.254.0.0/16 with the AWS,
 * GCP and Azure metadata service, fe80::/10) and the other known metadata
 * addresses, written or resolved through DNS; only http and https are
 * fetched, and redirects are never followed. Loopback and private networks
 * stay open on purpose: a local Ollama lives there.
 *
 * Limit: the check resolves the host itself and fetch resolves it again, so a
 * DNS server that changes its answer in between (rebinding) is not caught.
 */
const dns = require('dns');
const net = require('net');
const { AiError } = require('./errors');
const { normalizeIp, inBlockList } = require('../utils/ipAddress');

const BLOCKED_ADDRESSES = new net.BlockList();
BLOCKED_ADDRESSES.addSubnet('169.254.0.0', 16, 'ipv4');
BLOCKED_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
BLOCKED_ADDRESSES.addAddress('100.100.100.200', 'ipv4'); // Alibaba Cloud metadata
BLOCKED_ADDRESSES.addAddress('fd00:ec2::254', 'ipv6'); // AWS metadata over IPv6

const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata.goog']);
const SCHEMES = new Set(['http:', 'https:']);

/** Lower case, without brackets and the trailing dot of a fully qualified name. */
function plainHost(hostname) {
    return String(hostname || '').toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
}

/**
 * Whether a written host (name or IP, as a URL carries it) is refused, without DNS.
 *
 * @param {string} hostname -> Host of a URL (`169.254.169.254`, `[fe80::1]`, `metadata.google.internal`).
 * @returns {boolean}
 */
function isBlockedAiHost(hostname) {
    const host = plainHost(hostname);
    return BLOCKED_HOSTS.has(host) || inBlockList(BLOCKED_ADDRESSES, host);
}

/**
 * Throw `blocked_address` unless the URL may be fetched.
 *
 * @param {string} url -> Full request URL.
 * @param {Function} lookup -> dns.promises.lookup or a double.
 * @returns {Promise<void>}
 * @throws {AiError}
 */
async function assertAllowedUrl(url, lookup) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new AiError('unreachable');
    }
    if (!SCHEMES.has(parsed.protocol) || isBlockedAiHost(parsed.hostname)) throw new AiError('blocked_address');
    const host = plainHost(parsed.hostname);
    if (normalizeIp(host)) return;
    let addresses;
    try {
        addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
        // Not resolvable here: fetch fails the same way and reports it as unreachable
        return;
    }
    if (addresses.some((entry) => inBlockList(BLOCKED_ADDRESSES, entry.address))) throw new AiError('blocked_address');
}

/**
 * fetch for the AI adapters: checks the address first and never follows a redirect.
 *
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl] -> fetch to call (default: the global fetch at call time).
 * @param {Function} [options.lookup] -> DNS lookup (default dns.promises.lookup).
 * @returns {(url: string, init?: Object) => Promise<Response>}
 */
function createGuardedFetch({ fetchImpl = (...args) => fetch(...args), lookup = dns.promises.lookup } = {}) {
    return async (url, init = {}) => {
        await assertAllowedUrl(String(url), lookup);
        return fetchImpl(url, { ...init, redirect: 'error' });
    };
}

module.exports = { createGuardedFetch, isBlockedAiHost };
