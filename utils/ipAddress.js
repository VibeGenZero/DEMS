/**
 * IP address helpers for the trust proxy rule (utils/trustProxy.js) and the
 * address guard of the AI connection (ai/addressGuard.js).
 */
const net = require('net');

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * An address in the form net.BlockList checks: an IPv4-mapped IPv6 address
 * (`::ffff:127.0.0.1`, how a dual-stack socket reports IPv4 peers) becomes
 * plain IPv4, brackets of a URL host (`[::1]`) are dropped.
 *
 * @param {string} address -> IP address.
 * @returns {{ address: string, type: 'ipv4'|'ipv6' }|null} -> null when it is no IP address.
 */
function normalizeIp(address) {
    const text = String(address || '').trim().replace(/^\[(.*)\]$/, '$1');
    const mapped = MAPPED_V4.exec(text);
    if (mapped) return net.isIPv4(mapped[1]) ? { address: mapped[1], type: 'ipv4' } : null;
    const family = net.isIP(text);
    if (family === 4) return { address: text, type: 'ipv4' };
    if (family === 6) return { address: text, type: 'ipv6' };
    return null;
}

/**
 * Whether an address lies in a block list.
 *
 * @param {net.BlockList} list -> Ranges to check against.
 * @param {string} address -> IP address (mapped IPv4 and brackets allowed).
 * @returns {boolean} -> false for anything that is no IP address.
 */
function inBlockList(list, address) {
    const ip = normalizeIp(address);
    return !!ip && list.check(ip.address, ip.type);
}

module.exports = { normalizeIp, inBlockList };
