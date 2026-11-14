'use strict';

// JSON answers are requested by prompt, not through provider-specific features,
// so every provider behaves the same.
const JSON_HINT = 'Respond with valid JSON only, without any other text.';

module.exports = { JSON_HINT };
