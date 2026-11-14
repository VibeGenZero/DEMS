/**
 * Members ask the event assistant in Discord: `/ask` (German `/frage`) and
 * „Frage stellen“ on announcements, which opens a modal with one question.
 * Both answer privately through ai/memberAssistant.js, with the same checks
 * and limits as the website. No question or answer text is logged, and no
 * reply of this module can mention anybody.
 */
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
    escapeMarkdown
} = require('discord.js');
const { buildEventUrl } = require('../utils/eventUrl');
const { answerEventQuestion, AskRefusal } = require('../ai/memberAssistant');
const { isFeatureOn, getAiSettings } = require('../ai/settings');
const { ASK_MODAL_PREFIX, ASK_QUESTION_FIELD_ID, MODAL_TITLE_MAX_LENGTH } = require('./constants');
const { fitText } = require('./layout');
const { resolveInteractionRoles } = require('./registration');
const { hasAdminRole } = require('./adminCommands');

const QUESTION_MAX = 500;
const QUOTE_MAX = 200;
const ANSWER_MAX = 2000;
const SWITCHED_OFF = 'Der Event-Assistent ist gerade ausgeschaltet.';
const FAILED = '❌ Die Frage konnte nicht verarbeitet werden.';
// Heading of an announcement (bot/messages.js): the modal takes the title from it
const HEADING_PREFIX = '## 🎉 ';

/** A fresh "nobody is mentioned" setting for every reply. */
const noMentions = () => ({ parse: [] });

/**
 * Event title from the heading of the message a button sits on, so the
 * modal opens without a database read.
 *
 * @param {Object} [message] -> The clicked message (discord.js components or their JSON).
 * @returns {string} -> Title, '' when the message has no announcement heading.
 */
function titleFromMessage(message) {
    const pending = [...(message?.components || [])];
    while (pending.length > 0) {
        const component = pending.shift();
        const content = component?.content ?? component?.data?.content;
        if (typeof content === 'string' && content.startsWith(HEADING_PREFIX)) {
            // escapeMarkdown put a backslash before every Markdown character
            return content.slice(HEADING_PREFIX.length).split('\n')[0].replace(/\\(.)/g, '$1');
        }
        if (Array.isArray(component?.components)) pending.push(...component.components);
    }
    return '';
}

/**
 * Modal of „Frage stellen“: one paragraph input.
 *
 * @param {Object} event -> Event data (only `title` is read; may be empty).
 * @param {string} eventId -> The event document ID.
 * @returns {ModalBuilder} -> Modal ready for interaction.showModal().
 */
function buildAskModal(event, eventId) {
    const title = String(event?.title || '').trim();
    return new ModalBuilder()
        .setCustomId(`${ASK_MODAL_PREFIX}:${eventId}`)
        .setTitle(title ? fitText(`Frage: ${title}`, MODAL_TITLE_MAX_LENGTH) : 'Frage zum Event')
        .addLabelComponents(new LabelBuilder()
            .setLabel('Deine Frage')
            .setTextInputComponent(new TextInputBuilder()
                .setCustomId(ASK_QUESTION_FIELD_ID)
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(QUESTION_MAX)
                .setRequired(true)));
}

/**
 * The private answer: assistant name, the question quoted on one line, the
 * answer and a link to the event.
 *
 * @param {Object} params
 * @param {string} params.name -> Assistant name from the AI settings.
 * @param {string} params.question -> The member's question.
 * @param {string} params.text -> The assistant's answer.
 * @param {string} params.eventId -> The event document ID.
 * @returns {Object} -> Options for editReply.
 */
function buildAskAnswer({ name, question, text, eventId }) {
    const quote = escapeMarkdown(fitText(String(question || '').replace(/\s+/g, ' ').trim(), QUOTE_MAX));
    const content = fitText(`**${escapeMarkdown(String(name || ''))}**\n> ${quote}\n\n${String(text || '')}`, ANSWER_MAX);
    const link = new ButtonBuilder().setLabel('Zum Event').setStyle(ButtonStyle.Link).setURL(buildEventUrl(eventId)).setEmoji('🔗');
    return { content, components: [new ActionRowBuilder().addComponents(link)], allowedMentions: noMentions() };
}

/** Log a failure with its code or name only (never the question or the error text). */
function logFailure(err) {
    console.error('Event assistant in Discord failed:', err?.code || err?.name || 'error');
}

/**
 * Answer privately with the fixed failure sentence; an expired interaction is ignored.
 *
 * @param {Object} interaction -> Any interaction of this module.
 * @param {*} err -> What went wrong.
 * @returns {Promise<void>}
 */
async function failPrivately(interaction, err) {
    logFailure(err);
    try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: FAILED, allowedMentions: noMentions() });
        else await interaction.reply({ content: FAILED, flags: MessageFlags.Ephemeral, allowedMentions: noMentions() });
    } catch { /* interaction already expired */ }
}

/** The refusal while the feature is off (an old button, a cached command, an open modal). */
const replySwitchedOff = (interaction) => interaction.reply({
    content: SWITCHED_OFF, flags: MessageFlags.Ephemeral, allowedMentions: noMentions()
});

/**
 * Defer privately, ask the assistant and edit the answer in. Discord allows
 * three seconds for the first response, so nothing slow comes before the defer.
 *
 * @param {Object} interaction -> Command or submitted modal.
 * @param {Object} params -> `{ eventId, question, client }`; `client` replaces the AI client (tests).
 * @returns {Promise<void>}
 */
async function answerQuestion(interaction, { eventId, question, client }) {
    if (!isFeatureOn('memberDiscord')) {
        await replySwitchedOff(interaction);
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const roles = await resolveInteractionRoles(interaction);
        const isAdmin = await hasAdminRole(interaction);
        const { text } = await answerEventQuestion({
            eventId: String(eventId || ''), user: { id: interaction.user.id, roles, isAdmin }, question, client
        });
        await interaction.editReply(buildAskAnswer({ name: getAiSettings().assistantName, question, text, eventId }));
    } catch (err) {
        if (err instanceof AskRefusal) {
            await interaction.editReply({ content: `❌ ${err.error}`, allowedMentions: noMentions() });
            return;
        }
        throw err;
    }
}

/**
 * /ask event:<id> question:<text> (German /frage).
 *
 * @param {Object} interaction -> Chat input command.
 * @param {Object} [options] -> `{ client }` replaces the AI client (tests).
 * @returns {Promise<void>} -> Never rejects.
 */
async function handleAskCommand(interaction, { client } = {}) {
    try {
        await answerQuestion(interaction, {
            eventId: interaction.options.getString('event'), question: interaction.options.getString('question'), client
        });
    } catch (err) {
        await failPrivately(interaction, err);
    }
}

/**
 * Click on „Frage stellen“: opens the modal at once.
 *
 * @param {Object} interaction -> Button interaction.
 * @param {string} eventId -> The event document ID from the custom ID.
 * @returns {Promise<void>} -> Never rejects.
 */
async function handleAskButton(interaction, eventId) {
    try {
        if (!isFeatureOn('memberDiscord')) {
            await replySwitchedOff(interaction);
            return;
        }
        await interaction.showModal(buildAskModal({ title: titleFromMessage(interaction.message) }, eventId));
    } catch (err) {
        await failPrivately(interaction, err);
    }
}

/**
 * Submitted question modal: answered like the command.
 *
 * @param {Object} interaction -> Modal submit interaction.
 * @param {string} eventId -> The event document ID from the custom ID.
 * @param {Object} [options] -> `{ client }` replaces the AI client (tests).
 * @returns {Promise<void>} -> Never rejects.
 */
async function handleAskModal(interaction, eventId, { client } = {}) {
    try {
        let question = '';
        try { question = interaction.fields.getTextInputValue(ASK_QUESTION_FIELD_ID) || ''; } catch { /* input missing */ }
        await answerQuestion(interaction, { eventId, question, client });
    } catch (err) {
        await failPrivately(interaction, err);
    }
}

module.exports = { buildAskModal, buildAskAnswer, handleAskCommand, handleAskButton, handleAskModal };
