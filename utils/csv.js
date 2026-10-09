/**
 * CSV cells for the registration export.
 */

// A spreadsheet runs a cell starting with one of these as a formula (CSV injection)
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One quoted CSV cell; formula starts get a leading apostrophe so Excel and
 * LibreOffice show the text instead of running it.
 *
 * @param {*} value -> Cell value.
 * @returns {string} -> Quoted cell.
 */
function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (FORMULA_START.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

module.exports = { csvCell };
