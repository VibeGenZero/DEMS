/**
 * Setup mode of a fresh installation (#138): whether the wizard has to run,
 * and the setup PIN that unlocks it.
 *
 * Setup mode applies when no setup was completed and the environment (after
 * the stored configuration was laid over it) still lacks a Discord value the
 * login needs. It never applies in dev mock mode. The PIN lives in memory
 * only: SETUP_PIN, or a random 8-digit PIN printed at every start.
 */
const crypto = require('crypto');
const { hasRequiredDiscordValues, isSetupCompleted } = require('./systemConfig');
const { safeEqual } = require('../middleware/auth');

let required = false;
let pin = null;

/**
 * Decide at start whether DEMS runs in setup mode, and print the PIN if so.
 * Call after loadSystemConfig().
 *
 * @param {Object} [options] -> `{ env, mockMode, log }`; defaults process.env, the mock switch, console.log.
 * @returns {Promise<boolean>} -> True in setup mode.
 */
async function initSetupState({ env = process.env, mockMode = require('../dev/mockMode').IS_MOCK_MODE, log = console.log } = {}) {
    required = !mockMode && !(await isSetupCompleted()) && !hasRequiredDiscordValues(env);
    pin = null;
    if (!required) return false;

    const fixed = typeof env.SETUP_PIN === 'string' ? env.SETUP_PIN.trim() : '';
    pin = fixed || String(crypto.randomInt(0, 100000000)).padStart(8, '0');
    const address = env.BASE_URL || `http://localhost:${env.PORT || 3000}`;
    // Production cookies are Secure -> the wizard works only behind HTTPS (TLS proxy)
    const how = env.NODE_ENV === 'production' ? 'über HTTPS (hinter deinem TLS-Proxy)' : 'im Browser';
    log('\n🔑 ════════════════════════════════════════════════════');
    log(`   DEMS ist noch nicht eingerichtet. Setup-PIN: ${pin}`);
    log(`   Öffne DEMS ${how} (${address}) und gib die PIN ein.`);
    log('════════════════════════════════════════════════════════\n');
    return true;
}

/** Whether DEMS runs in setup mode. */
function isSetupRequired() {
    return required;
}

/**
 * Compare an entered PIN in constant time.
 *
 * @param {*} input -> PIN from the request.
 * @returns {boolean}
 */
function checkSetupPin(input) {
    return required && !!pin && typeof input === 'string' && safeEqual(input.trim(), pin);
}

/** End setup mode; the PIN stops working. */
function endSetupMode() {
    required = false;
    pin = null;
}

module.exports = { initSetupState, isSetupRequired, checkSetupPin, endSetupMode };
