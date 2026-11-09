/**
 * Admin slash commands (B-13): `/event erstellen` and `/abstimmung erstellen`
 * open a modal; the event becomes a draft that can be published or announced
 * from the answer, the poll is posted at once. Only members with the DEMS
 * admin role (DISCORD_ADMIN_ROLE_ID) pass; every entry point checks it.
 *
 * Saving and posting go through utils/adminActions.js (shared with the
 * website), loaded inside the handlers so mock mode gets its twins.
 */
const crypto = require('crypto');
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { db, collection, doc, getDoc, getDocs, addDoc } = require('../firebaseAdmin');
const { buildEventUrl } = require('../utils/eventUrl');
const { DATE_FORMAT_HINT, parseLocalDateTime, parseEndInput, parsePollLines } = require('../utils/localDateTime');
const { normalizeSlots } = require('../utils/slotService');
const { resolveInteractionRoles } = require('./registration');
const {
    ADMIN_EVENT_MODAL_PREFIX, ADMIN_POLL_MODAL_PREFIX, ADMIN_EVENT_PUBLISH_PREFIX,
    ADMIN_EVENT_ACTIVATE_PREFIX, ADMIN_RETRY_PREFIX
} = require('./constants');
const { getTimezone } = require('../utils/timezone');

const NOT_ADMIN = '⛔ Nur Admins können Events und Abstimmungen erstellen.';
const TEMPLATE_GONE = 'Diese Vorlage gibt es nicht mehr.';
// Placeholder of the custom ID when the modal has no template
const NO_TEMPLATE = '-';
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const AUTOCOMPLETE_MAX = 25;
const EXPIRED = 'Die Eingabe ist abgelaufen. Starte den Befehl neu.';
const CORRECTION_TTL_MS = 15 * 60 * 1000;
const EVENT_FIELDS = ['title', 'start', 'end', 'places', 'description'];
const POLL_FIELDS = ['title', 'dates', 'description'];

/**
 * Refused modal input, kept 15 minutes for „Korrigieren“ (in memory: a
 * restart forgets it, the button then says so). Keys are 8 random characters.
 */
const corrections = {
    entries: new Map(),
    /**
     * @param {Object} entry -> `{ kind: 'event'|'poll', templateId?, withPlaces?, values }`.
     * @param {string} userId -> The admin who typed it.
     * @param {number} [now] -> Milliseconds, for tests.
     * @returns {string} -> Key for the button.
     */
    remember(entry, userId, now = Date.now()) {
        for (const [key, stored] of this.entries) if (stored.expires <= now) this.entries.delete(key);
        const key = crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
        this.entries.set(key, { ...entry, userId, expires: now + CORRECTION_TTL_MS });
        return key;
    },
    /**
     * @param {string} key -> Key from the button.
     * @param {string} userId -> The clicking admin.
     * @param {number} [now] -> Milliseconds, for tests.
     * @returns {Object|null} -> The entry, or null when unknown, expired or typed by somebody else.
     */
    recall(key, userId, now = Date.now()) {
        const entry = this.entries.get(key);
        if (!entry || entry.expires <= now || entry.userId !== userId) return null;
        return entry;
    }
};

/**
 * Whether the member of an interaction holds the DEMS admin role.
 *
 * @param {Object} interaction -> Any interaction from a guild.
 * @returns {Promise<boolean>} -> False without a configured admin role.
 */
async function hasAdminRole(interaction) {
    const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
    if (!adminRoleId) return false;
    const roleIds = await resolveInteractionRoles(interaction);
    return roleIds.includes(adminRoleId);
}

/**
 * Answer privately, also after a defer.
 *
 * @param {Object} interaction -> The interaction.
 * @param {string|Object} message -> Text or payload.
 * @returns {Promise<*>}
 */
function answerPrivately(interaction, message) {
    const payload = typeof message === 'string' ? { content: message } : message;
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

/**
 * A stored event template with its id, or null.
 *
 * @param {string} templateId -> Template document id.
 * @returns {Promise<Object|null>}
 */
async function loadTemplate(templateId) {
    if (!templateId || templateId === NO_TEMPLATE) return null;
    const snap = await getDoc(doc(db, 'eventTemplates', templateId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Offer the event templates while an admin types the option `vorlage`.
 *
 * @param {Object} interaction -> Autocomplete interaction of /event.
 * @returns {Promise<void>}
 */
async function handleTemplateAutocomplete(interaction) {
    try {
        if (!(await hasAdminRole(interaction))) return await interaction.respond([]);
        const typed = String(interaction.options.getFocused() || '').toLowerCase();
        const snapshot = await getDocs(collection(db, 'eventTemplates'));
        const choices = snapshot.docs
            .map(entry => ({ name: String(entry.data().name || ''), value: entry.id }))
            .filter(choice => choice.name && choice.name.toLowerCase().includes(typed))
            .sort((a, b) => a.name.localeCompare(b.name, 'de'))
            .slice(0, AUTOCOMPLETE_MAX)
            .map(choice => ({ name: choice.name.substring(0, 100), value: choice.value }));
        await interaction.respond(choices);
    } catch {
        await interaction.respond([]).catch(() => {});
    }
}

/**
 * One labelled text input of a modal; a value is only set when there is one.
 *
 * @param {Object} spec -> `{ id, label, style, required, maxLength, placeholder, description, value }`.
 * @returns {LabelBuilder}
 */
function textInput({ id, label, style = TextInputStyle.Short, required = false, maxLength, placeholder, description, value }) {
    const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required);
    if (maxLength) input.setMaxLength(maxLength);
    if (placeholder) input.setPlaceholder(placeholder);
    if (value) input.setValue(String(value).substring(0, maxLength || DESCRIPTION_MAX));
    const labelled = new LabelBuilder().setLabel(label).setTextInputComponent(input);
    if (description) labelled.setDescription(description);
    return labelled;
}

/**
 * Modal of /event erstellen.
 *
 * @param {Object} options
 * @param {string} [options.templateId] -> Template the modal was opened with.
 * @param {Object} [options.values] -> `{ title, start, end, places, description }` to prefill.
 * @param {boolean} [options.withPlaces] -> False for a slot template (places come from the slots).
 * @returns {ModalBuilder}
 */
function buildEventModal({ templateId = NO_TEMPLATE, values = {}, withPlaces = true } = {}) {
    const labels = [
        textInput({ id: 'title', label: 'Titel', required: true, maxLength: TITLE_MAX, value: values.title }),
        textInput({ id: 'start', label: 'Beginn', required: true, maxLength: 20, placeholder: '24.12.2026 19:30', value: values.start }),
        textInput({
            id: 'end', label: 'Ende (optional)', maxLength: 20, placeholder: '22:00 oder 25.12.2026 01:00',
            description: 'Nur eine Uhrzeit = gleicher Tag, früher als der Beginn = Folgetag', value: values.end
        })
    ];
    if (withPlaces) {
        labels.push(textInput({ id: 'places', label: 'Plätze (optional)', maxLength: 5, placeholder: 'leer oder 0 = unbegrenzt', value: values.places }));
    }
    labels.push(textInput({ id: 'description', label: 'Beschreibung (optional)', style: TextInputStyle.Paragraph, maxLength: DESCRIPTION_MAX, value: values.description }));
    return new ModalBuilder()
        .setCustomId(`${ADMIN_EVENT_MODAL_PREFIX}:${templateId || NO_TEMPLATE}`)
        .setTitle('Event erstellen')
        .addLabelComponents(...labels);
}

/**
 * Modal of /abstimmung erstellen.
 *
 * @param {Object} [values] -> `{ title, dates, description }` to prefill.
 * @returns {ModalBuilder}
 */
function buildPollModal(values = {}) {
    return new ModalBuilder()
        .setCustomId(ADMIN_POLL_MODAL_PREFIX)
        .setTitle('Abstimmung erstellen')
        .addLabelComponents(
            textInput({ id: 'title', label: 'Titel', required: true, maxLength: TITLE_MAX, value: values.title }),
            textInput({
                id: 'dates', label: 'Termine', style: TextInputStyle.Paragraph, required: true, maxLength: 1000,
                placeholder: '24.12.2026 19:30\n27.12.2026 18:00 – 22:00',
                description: 'Ein Termin pro Zeile (2–10), Ende optional nach „–“', value: values.dates
            }),
            textInput({ id: 'description', label: 'Beschreibung (optional)', style: TextInputStyle.Paragraph, maxLength: DESCRIPTION_MAX, value: values.description })
        );
}

/**
 * Modal values a template brings: title, description and, without slots, the places.
 *
 * @param {Object|null} template -> Stored template.
 * @returns {{ values: Object, withPlaces: boolean }}
 */
function templateValues(template) {
    const settings = template?.settings || {};
    const withPlaces = !(Array.isArray(settings.slots) && settings.slots.length > 0);
    const places = parseInt(settings.maxParticipants) || 0;
    return {
        withPlaces,
        values: {
            title: settings.title || '',
            description: settings.description || '',
            places: withPlaces && places > 0 ? String(places) : ''
        }
    };
}

/**
 * /event erstellen [vorlage]: admin check, then the (prefilled) modal.
 *
 * @param {Object} interaction -> Chat input command.
 * @returns {Promise<void>}
 */
async function handleEventCreateCommand(interaction) {
    if (!(await hasAdminRole(interaction))) return answerPrivately(interaction, NOT_ADMIN);
    const templateId = interaction.options.getString('template');
    let template = null;
    if (templateId) {
        template = await loadTemplate(templateId);
        if (!template) return answerPrivately(interaction, TEMPLATE_GONE);
    }
    const { values, withPlaces } = templateValues(template);
    await interaction.showModal(buildEventModal({ templateId: template?.id, values, withPlaces }));
}

/**
 * /abstimmung erstellen: admin check, then the modal.
 *
 * @param {Object} interaction -> Chat input command.
 * @returns {Promise<void>}
 */
async function handlePollCreateCommand(interaction) {
    if (!(await hasAdminRole(interaction))) return answerPrivately(interaction, NOT_ADMIN);
    await interaction.showModal(buildPollModal());
}

/** The link row that stays after a draft button was used. */
const webLinkRow = (eventId) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setURL(buildEventUrl(eventId)).setLabel('Im Web öffnen').setStyle(ButtonStyle.Link)
);

// Answers of publishDraft refusals
const DRAFT_REFUSALS = {
    missing: '❌ Diesen Entwurf gibt es nicht mehr.',
    not_draft: 'ℹ️ Dieser Entwurf ist schon veröffentlicht.',
    no_start: '❌ Ohne Beginn kann der Entwurf nicht veröffentlicht werden.'
};

/**
 * „Veröffentlichen & ankündigen“ / „Nur veröffentlichen“ on the draft answer:
 * publish the draft like the website, optionally announce it, then replace
 * the buttons with the result and the web link.
 *
 * @param {Object} interaction -> Button interaction.
 * @param {boolean} announce -> Also post the announcement.
 * @param {string} eventId -> The draft.
 * @returns {Promise<*>}
 */
async function handleDraftButton(interaction, announce, eventId) {
    if (!(await hasAdminRole(interaction))) return answerPrivately(interaction, NOT_ADMIN);
    // Publishing, channels and the post can take longer than Discord's 3 seconds
    await interaction.deferUpdate();

    const { publishDraft, announceEvent } = require('../utils/adminActions');
    const published = await publishDraft(eventId, interaction.user.id, { via: 'discord' });
    if (!published.ok) {
        const components = published.code === 'missing' ? [] : [webLinkRow(eventId)];
        return interaction.editReply({ content: DRAFT_REFUSALS[published.code], components });
    }

    let result = '✅ Veröffentlicht.';
    if (announce) {
        const announced = await announceEvent(eventId, interaction.user.id, { via: 'discord' });
        result = announced.ok ? '✅ Veröffentlicht und angekündigt.' : `⚠️ Veröffentlicht, aber nicht angekündigt: ${announced.error}`;
    }
    return interaction.editReply({
        content: `${result}\n**${published.event.title}** · ${formatStart(published.event.startDate)}`,
        components: [webLinkRow(eventId)]
    });
}

/**
 * Answer a refused modal with the reason and „Korrigieren“.
 *
 * @param {Object} interaction -> The deferred modal submit.
 * @param {string} reason -> German reason.
 * @param {Object} entry -> What to reopen: `{ kind, templateId?, withPlaces?, values }`.
 * @returns {Promise<*>}
 */
function refuseInput(interaction, reason, entry) {
    const key = corrections.remember(entry, interaction.user.id);
    return interaction.editReply({
        content: `❌ ${reason}`,
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${ADMIN_RETRY_PREFIX}:${key}`).setLabel('Korrigieren').setStyle(ButtonStyle.Primary)
        )]
    });
}

/** Typed values of a modal by input id ('' for an input the modal does not have). */
function readValues(interaction, ids) {
    return Object.fromEntries(ids.map(id => {
        let value = '';
        try { value = interaction.fields.getTextInputValue(id) || ''; } catch { /* input not in this modal */ }
        return [id, value];
    }));
}

/** Start in the server time zone, e.g. "Do., 24.12.2026, 19:30". */
const formatStart = (iso) => new Date(iso).toLocaleString('de-DE', {
    timeZone: getTimezone(), weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

/**
 * Check the typed event values; the first problem wins.
 *
 * @param {Object} values -> Typed values.
 * @param {boolean} withPlaces -> Whether the modal asked for places.
 * @param {Date} now -> Reference time.
 * @returns {{ fields: Object } | { error: string }} -> `{ title, description, startDate, endDate, maxParticipants? }`.
 */
function readEventInput(values, withPlaces, now) {
    const title = values.title.trim();
    if (!title) return { error: 'Titel ist erforderlich.' };
    const start = parseLocalDateTime(values.start, getTimezone());
    if (!start) return { error: `Beginn: bitte als ${DATE_FORMAT_HINT} angeben.` };
    if (start <= now) return { error: 'Der Beginn muss in der Zukunft liegen.' };
    const end = parseEndInput(values.end, start, getTimezone());
    if (end === undefined) return { error: `Ende: bitte als Uhrzeit (22:00) oder als ${DATE_FORMAT_HINT} angeben.` };
    if (end && end <= start) return { error: 'Das Ende muss nach dem Beginn liegen.' };
    const fields = { title, description: values.description.trim(), startDate: start.toISOString(), endDate: end ? end.toISOString() : '' };
    if (withPlaces) {
        const places = values.places.trim();
        if (places && !/^\d+$/.test(places)) return { error: 'Plätze: bitte eine ganze Zahl ab 0 angeben.' };
        fields.maxParticipants = places ? parseInt(places, 10) : 0;
    }
    return { fields };
}

/**
 * Submit of the event modal: check, save as draft, answer with the summary
 * and the buttons to publish or announce it.
 *
 * @param {Object} interaction -> Modal submit.
 * @param {string} [templateId] -> Template id from the custom ID, or '-'.
 * @returns {Promise<*>}
 */
async function handleAdminEventModal(interaction, templateId = NO_TEMPLATE) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await hasAdminRole(interaction))) return answerPrivately(interaction, NOT_ADMIN);

    const template = await loadTemplate(templateId);
    if (templateId && templateId !== NO_TEMPLATE && !template) return answerPrivately(interaction, TEMPLATE_GONE);
    const { withPlaces } = templateValues(template);
    const values = readValues(interaction, EVENT_FIELDS);
    const retry = { kind: 'event', templateId: template?.id || NO_TEMPLATE, withPlaces, values };

    const input = readEventInput(values, withPlaces, new Date());
    if (input.error) return refuseInput(interaction, input.error, retry);

    const settings = template?.settings || {};
    const slotResult = normalizeSlots(settings.slots);
    if (slotResult.error) return refuseInput(interaction, slotResult.error, retry);

    const { buildNewEvent } = require('../utils/adminActions');
    const { checkEventFields } = require('../middleware/validators');
    const { addAuditLog } = require('../utils/eventUtils');
    const event = buildNewEvent({ ...settings, ...input.fields, slots: slotResult.slots, status: 'draft' }, interaction.user.id);
    const errors = await checkEventFields(event);
    if (errors.length > 0) return refuseInput(interaction, errors.join(' '), retry);

    const ref = await addDoc(collection(db, 'events'), event);
    await addAuditLog('CREATE_EVENT', interaction.user.id, `Created event "${event.title}" in Discord`, ref.id);

    const places = event.maxParticipants > 0 ? String(event.maxParticipants) : 'unbegrenzt';
    return interaction.editReply({
        content: [
            `📝 Entwurf angelegt: **${event.title}**`,
            `🗓️ Beginn: ${formatStart(event.startDate)}`,
            `👥 Plätze: ${places}`,
            'Veröffentliche ihn hier oder bearbeite ihn im Web.'
        ].join('\n'),
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${ADMIN_EVENT_PUBLISH_PREFIX}:${ref.id}`).setLabel('Veröffentlichen & ankündigen').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`${ADMIN_EVENT_ACTIVATE_PREFIX}:${ref.id}`).setLabel('Nur veröffentlichen').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setURL(buildEventUrl(ref.id)).setLabel('Im Web öffnen').setStyle(ButtonStyle.Link)
        )]
    });
}

/**
 * Submit of the poll modal: check, create the open poll and post it to the
 * announcement channel at once; the answer links the posted message.
 *
 * @param {Object} interaction -> Modal submit.
 * @returns {Promise<*>}
 */
async function handleAdminPollModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await hasAdminRole(interaction))) return answerPrivately(interaction, NOT_ADMIN);

    const values = readValues(interaction, POLL_FIELDS);
    const retry = { kind: 'poll', values };
    const title = values.title.trim();
    if (!title) return refuseInput(interaction, 'Titel ist erforderlich.', retry);
    const lines = parsePollLines(values.dates, getTimezone());
    if (lines.error) return refuseInput(interaction, lines.error, retry);

    const { createPoll, announcePoll } = require('../utils/adminActions');
    const created = await createPoll({ title, description: values.description.trim(), options: lines.options }, interaction.user.id, { via: 'discord' });
    if (!created.ok) return refuseInput(interaction, created.error, retry);

    const announced = await announcePoll(created.poll.id, interaction.user.id, { via: 'discord' });
    if (!announced.ok) {
        return interaction.editReply({ content: `⚠️ Abstimmung „${title}“ angelegt, aber nicht gepostet: ${announced.error}`, components: [] });
    }
    const { guildId, channelId, messageId } = announced.sent;
    const link = `https://discord.com/channels/${interaction.guildId || guildId}/${channelId}/${messageId}`;
    return interaction.editReply({ content: `✅ Abstimmung „${title}“ gepostet.\n${link}`, components: [] });
}

/**
 * „Korrigieren“: reopen the refused modal with the typed values.
 *
 * @param {Object} interaction -> Button interaction.
 * @param {string} key -> Correction key.
 * @returns {Promise<*>}
 */
async function handleRetryButton(interaction, key) {
    if (!(await hasAdminRole(interaction))) return answerPrivately(interaction, NOT_ADMIN);
    const entry = corrections.recall(key, interaction.user.id);
    if (!entry) return answerPrivately(interaction, EXPIRED);
    const modal = entry.kind === 'poll'
        ? buildPollModal(entry.values)
        : buildEventModal({ templateId: entry.templateId, values: entry.values, withPlaces: entry.withPlaces });
    return interaction.showModal(modal);
}

module.exports = {
    NOT_ADMIN,
    corrections,
    hasAdminRole,
    buildEventModal,
    buildPollModal,
    handleTemplateAutocomplete,
    handleEventCreateCommand,
    handlePollCreateCommand,
    handleDraftButton,
    handleAdminEventModal,
    handleAdminPollModal,
    handleRetryButton
};
