// utils/debugLog.js
// Verbose debug logger — only active when DEBUG_MODE=true in .env
// Usage: debugLog('label', { any: 'data' })

const IS_DEBUG = process.env.DEBUG_MODE === 'true';

const COLORS = {
    reset: '\x1b[0m',
    cyan:  '\x1b[36m',
    yellow:'\x1b[33m',
    magenta:'\x1b[35m',
    gray:  '\x1b[90m',
};

function timestamp() {
    return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

function debugLog(label, data) {
    if (!IS_DEBUG) return;
    const ts = `${COLORS.gray}[DEBUG ${timestamp()}]${COLORS.reset}`;
    const lbl = `${COLORS.cyan}${label}${COLORS.reset}`;
    if (data !== undefined) {
        console.log(`${ts} ${lbl}`, data);
    } else {
        console.log(`${ts} ${lbl}`);
    }
}

module.exports = { debugLog, IS_DEBUG };
