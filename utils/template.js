/**
 * Placeholders like {user.name} in bot message templates.
 */

/**
 * Replace template variables in bot messages. split/join instead of a regex
 * replace: values like "$&" (in a user or event name) stay literal, and a
 * "." in a variable name is no wildcard.
 *
 * @param {string} template -> Text with {variable} placeholders.
 * @param {Object<string, *>} variables -> Placeholder name → value.
 * @returns {string} -> Text with the values inserted.
 */
function parseTemplate(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.split(`{${key}}`).join(String(value));
    }
    return result;
}

module.exports = { parseTemplate };
