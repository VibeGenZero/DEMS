/**
 * Input validation middleware for DEMS
 * Pure JS validation without external libraries
 */

/**
 * Validate event creation/update body
 */
function validateEvent(req, res, next) {
    const { title, maxParticipants, accessMode, status, approvalMode } = req.body;

    const errors = [];

    // Title is required and must be non-empty string
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
        errors.push('Titel ist erforderlich.');
    } else if (title.trim().length > 200) {
        errors.push('Titel darf maximal 200 Zeichen lang sein.');
    }

    // maxParticipants must be a valid number >= 0
    if (maxParticipants !== undefined && maxParticipants !== null && maxParticipants !== '') {
        const parsed = parseInt(maxParticipants);
        if (isNaN(parsed) || parsed < 0) {
            errors.push('Maximale Teilnehmerzahl muss eine Zahl >= 0 sein.');
        }
    }

    // accessMode must be valid enum
    const validAccessModes = ['open', 'role-required'];
    if (accessMode && !validAccessModes.includes(accessMode)) {
        errors.push(`Zugangsmodus muss einer der folgenden sein: ${validAccessModes.join(', ')}`);
    }

    // approvalMode must be valid enum
    const validApprovalModes = ['manual', 'instant'];
    if (approvalMode && !validApprovalModes.includes(approvalMode)) {
        errors.push(`Genehmigungsmodus muss einer der folgenden sein: ${validApprovalModes.join(', ')}`);
    }

    // status must be valid enum
    const validStatuses = ['draft', 'active', 'archived', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
        errors.push(`Status muss einer der folgenden sein: ${validStatuses.join(', ')}`);
    }

    // Description length check
    if (req.body.description && typeof req.body.description === 'string' && req.body.description.length > 5000) {
        errors.push('Beschreibung darf maximal 5000 Zeichen lang sein.');
    }

    if (errors.length > 0) {
        console.log('[validateEvent] 400 error — body:', JSON.stringify(req.body), '— errors:', errors);
        return res.status(400).json({ error: errors.join(' ') });
    }

    next();
}

/**
 * Validate registration status update
 */
function validateRegStatus(req, res, next) {
    const { status } = req.body;
    const validStatuses = ['accepted', 'rejected', 'waitlisted'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Status muss einer der folgenden sein: ${validStatuses.join(', ')}` });
    }
    next();
}

/**
 * Validate bot message templates
 */
function validateBotMessages(req, res, next) {
    const { registration, accepted, rejected } = req.body;
    const maxLen = 2000;

    if (registration && registration.length > maxLen) {
        return res.status(400).json({ error: `Registrierungs-Nachricht darf max. ${maxLen} Zeichen sein.` });
    }
    if (accepted && accepted.length > maxLen) {
        return res.status(400).json({ error: `Angenommen-Nachricht darf max. ${maxLen} Zeichen sein.` });
    }
    if (rejected && rejected.length > maxLen) {
        return res.status(400).json({ error: `Abgelehnt-Nachricht darf max. ${maxLen} Zeichen sein.` });
    }

    next();
}

module.exports = { validateEvent, validateRegStatus, validateBotMessages };
