/**
 * Express `trust proxy` from TRUST_PROXY (security report 2026-11).
 *
 * The old fixed value 1 trusted the last X-Forwarded-For entry of every
 * request, so a client that reached the port directly chose its own req.ip
 * and escaped every IP-based limit (setup PIN, login, /api). The default now
 * trusts one hop only when the direct peer is on a loopback, link-local or
 * private address: a reverse proxy on the same host or in the Docker network.
 * A client from the internet keeps its own address.
 */
const net = require('net');
const { inBlockList } = require('./ipAddress');

const PROXY_PEERS = new net.BlockList();
// Loopback
PROXY_PEERS.addSubnet('127.0.0.0', 8, 'ipv4');
PROXY_PEERS.addAddress('::1', 'ipv6');
// Link-local
PROXY_PEERS.addSubnet('169.254.0.0', 16, 'ipv4');
PROXY_PEERS.addSubnet('fe80::', 10, 'ipv6');
// Private networks (RFC 1918, unique local IPv6): Docker networks, LAN
PROXY_PEERS.addSubnet('10.0.0.0', 8, 'ipv4');
PROXY_PEERS.addSubnet('172.16.0.0', 12, 'ipv4');
PROXY_PEERS.addSubnet('192.168.0.0', 16, 'ipv4');
PROXY_PEERS.addSubnet('fc00::', 7, 'ipv6');

/**
 * Default rule: trust the direct peer (hop 0) when it is a local proxy, and nothing behind it.
 *
 * @param {string} address -> Address of this hop.
 * @param {number} hop -> 0 = the socket peer, 1 = the last X-Forwarded-For entry, …
 * @returns {boolean}
 */
function trustLocalProxy(address, hop) {
    return hop === 0 && inBlockList(PROXY_PEERS, address);
}

/**
 * The value for app.set('trust proxy', …).
 *
 * @param {string} [raw] -> TRUST_PROXY: empty = default rule, `false`/`0` = no proxy,
 *   a number = that many hops, `true` = every hop (only behind a proxy that strips the header),
 *   anything else = Express list of proxy addresses (e.g. `loopback, 10.0.0.0/8`).
 * @returns {Function|boolean|number|string}
 */
function trustProxySetting(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return trustLocalProxy;
    const lower = value.toLowerCase();
    if (lower === 'false') return false;
    if (lower === 'true') return true;
    if (/^\d+$/.test(value)) return Number(value) || false;
    return value;
}

module.exports = { trustProxySetting };
