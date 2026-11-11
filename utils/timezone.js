/**
 * The server time zone for dates in bot messages, series and Discord modals.
 * Read at call time, so a value the setup wizard or the admin "System" view
 * stores (utils/systemConfig.js) takes effect without a restart (#138).
 */
const DEFAULT_TIMEZONE = 'Europe/Berlin';

/**
 * @returns {string} -> IANA time zone from TIMEZONE, else Europe/Berlin.
 */
function getTimezone() {
    return process.env.TIMEZONE || DEFAULT_TIMEZONE;
}

module.exports = { DEFAULT_TIMEZONE, getTimezone };
