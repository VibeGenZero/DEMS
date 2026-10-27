/**
 * Date polls in Discord: the poll message (Components V2) and its buttons, refreshing posted polls
 * and the vote buttons and selects.
 */
const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, escapeMarkdown } = require('discord.js');
const { db, doc, updateDoc } = require('../firebaseAdmin');
const { buildEventUrl, buildPollUrl } = require('../utils/eventUrl');
const { isRegistrationBlocked } = require('../middleware/maintenance');
const { tallyPoll, getFavoriteOptionId, formatPollOption, isPollOpen, canVote, getPollLabels } = require('../utils/pollService');
const { SELECT_OPTION_LABEL_MAX_LENGTH, POLL_VOTE_PREFIX, POLL_YES_PREFIX, POLL_MAYBE_PREFIX, POLL_NAMES_MAX, POLL_DESCRIPTION_MAX_LENGTH } = require('./constants');
const { state } = require('./client');
const { editStoredMessages, recordsChanged } = require('./messages');
const { DEMS_ACCENT, MESSAGE_TEXT_MAX, fitText } = require('./layout');
const { resolveInteractionRoles, ensureUserProfile } = require('./registration');

// Container colours of a poll: open (DEMS accent), decided, closed or deleted
const POLL_DECIDED_COLOR = 0x22c55e;
const POLL_ENDED_COLOR = 0x6b7280;

/**
 * Build a date poll as a Components V2 message (B-05).
 *
 * Ping line above a container: title with description (or the chosen date),
 * one block per option with counts and the first "passt" names, the deadline
 * or end state with the vote count, and the buttons.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @param {Object} tally -> Result of tallyPoll().
 * @param {string} [intro] -> Ping line from buildAnnouncementIntro(), '' for none.
 * @returns {{ flags: number, components: Array }} -> Payload for channel.send() / message.edit().
 */
function buildPollMessage(poll, tally, intro = '') {
    const decided = poll.status === 'decided';
    const closed = !decided && !isPollOpen(poll);
    const title = escapeMarkdown(String(poll.title || ''));
    let heading = `## 📅 ${title}`;
    if (decided) heading = `## ✅ Termin steht: ${title}`;
    else if (closed) heading = `## 🔒 Abstimmung beendet: ${title}`;

    const highlightId = decided ? poll.winnerOptionId : getFavoriteOptionId(tally);
    const labels = getPollLabels(poll);
    const options = tally.options.map(entry => {
        const option = poll.options.find(candidate => candidate.id === entry.optionId);
        let marker = '';
        if (entry.optionId === highlightId) marker = decided ? '✅ ' : '🏆 ';
        return `**${marker}${formatPollOption(option)}**\n✅ ${entry.yes} · 🤔 ${entry.maybe}\n${formatPollVoters(entry, labels)}`;
    }).join('\n\n');

    const votes = `${tally.voterCount} ${tally.voterCount === 1 ? 'Stimme' : 'Stimmen'}`;
    let footer = `Abstimmung beendet · ${votes}`;
    if (!decided && !closed) {
        footer = poll.deadline
            ? `⏰ Abstimmung bis ${formatPollOption({ startDate: poll.deadline })} · ${votes}`
            : `Abstimmung offen · ${votes}`;
    }

    const winner = decided ? poll.options.find(option => option.id === poll.winnerOptionId) : null;
    // The description gets what the other texts leave of Discord's budget
    const used = (intro || '').length + heading.length + 1 + options.length + footer.length;
    const description = winner
        ? `**${formatPollOption(winner)}**`
        : fitText(fitText(poll.description, POLL_DESCRIPTION_MAX_LENGTH), MESSAGE_TEXT_MAX - used);

    let accent = DEMS_ACCENT;
    if (decided) accent = POLL_DECIDED_COLOR;
    else if (closed) accent = POLL_ENDED_COLOR;

    const container = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(
            text => text.setContent(description ? `${heading}\n${description}` : heading),
            text => text.setContent(options || '— keine Termine —'),
            text => text.setContent(footer)
        )
        .addActionRowComponents(row => row.addComponents(...buildPollButtons(poll)));

    const components = intro ? [new TextDisplayBuilder().setContent(intro), container] : [container];
    return { flags: MessageFlags.IsComponentsV2, components };
}

/**
 * Notice that replaces the posted messages of a deleted poll.
 *
 * @param {Object} poll -> The poll that is being deleted.
 * @returns {{ flags: number, components: Array }} -> Grey container without buttons.
 */
function buildPollDeletedMessage(poll) {
    const container = new ContainerBuilder()
        .setAccentColor(POLL_ENDED_COLOR)
        .addTextDisplayComponents(text => text.setContent(
            `## 🗑️ Abstimmung gelöscht: ${escapeMarkdown(String(poll.title || ''))}\nDiese Abstimmung wurde von einem Admin gelöscht.`
        ));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Second line of a poll field: the first "passt" names.
 *
 * @param {Object} entry -> Tally option.
 * @param {Object} [labels] -> Answers of the poll (getPollLabels).
 * @returns {string} -> Names, escaped for Discord markdown.
 */
function formatPollVoters(entry, labels = getPollLabels(null)) {
    if (entry.yes + entry.maybe === 0) return '— noch keine Stimmen —';
    if (entry.yes === 0) return `🤔 nur „${escapeMarkdown(labels.maybe)}“`;
    const names = entry.yesVoters.slice(0, POLL_NAMES_MAX).map(voter => escapeMarkdown(voter.displayName));
    const hidden = entry.yesVoters.length - POLL_NAMES_MAX;
    return hidden > 0 ? `${names.join(', ')}, +${hidden}` : names.join(', ');
}

/**
 * Buttons at the end of a poll message.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @returns {ButtonBuilder[]} -> "Zum Event" when decided; else "Abstimmen" while open and "Im Web ansehen".
 */
function buildPollButtons(poll) {
    if (poll.status === 'decided' && poll.eventId) {
        return [new ButtonBuilder().setLabel('Zum Event').setStyle(ButtonStyle.Link).setURL(buildEventUrl(poll.eventId)).setEmoji('🔗')];
    }
    const buttons = [];
    if (isPollOpen(poll)) {
        buttons.push(new ButtonBuilder().setCustomId(`${POLL_VOTE_PREFIX}:${poll.id}`).setLabel('Abstimmen').setStyle(ButtonStyle.Primary).setEmoji('🗳️'));
    }
    buttons.push(new ButtonBuilder().setLabel('Im Web ansehen').setStyle(ButtonStyle.Link).setURL(buildPollUrl(poll.id)).setEmoji('🔗'));
    return buttons;
}

/**
 * Ephemeral voting answer with two prefilled selects.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @param {{ yes: string[], maybe: string[] }} vote -> The member's current vote.
 * @param {string} [statusLine] -> Extra line, e.g. the saved confirmation.
 * @returns {Object} -> `{ content, components }` for reply/editReply.
 */
function buildPollVoteReply(poll, vote, statusLine = '') {
    const select = (prefix, placeholder, selected) => new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`${prefix}:${poll.id}`)
            .setPlaceholder(placeholder)
            .setMinValues(0)
            .setMaxValues(poll.options.length)
            .addOptions(poll.options.map(option => ({
                label: formatPollOption(option).substring(0, SELECT_OPTION_LABEL_MAX_LENGTH),
                value: option.id,
                default: selected.includes(option.id)
            })))
    );
    const labels = getPollLabels(poll);
    const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
    const lines = [`🗳️ **${poll.title}**`, 'Wähle deine Termine – Änderungen werden sofort gespeichert.'];
    if (statusLine) lines.push(statusLine);
    return {
        content: lines.join('\n'),
        components: [
            select(POLL_YES_PREFIX, `✅ ${capitalize(labels.yes)} …`, vote.yes || []),
            select(POLL_MAYBE_PREFIX, `🤔 ${capitalize(labels.maybe)} …`, vote.maybe || [])
        ]
    };
}

/**
 * Re-render every posted message of a poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<boolean>} -> True when messages were processed.
 */
async function refreshPollMessages(pollId) {
    if (!state.isReady) return false;
    try {
        const { loadPoll, loadPollVotes } = require('../utils/pollStore');
        const poll = await loadPoll(pollId);
        if (!poll) return false;
        const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
        if (announcements.length === 0) return false;

        const tally = tallyPoll(poll, await loadPollVotes(pollId));
        const kept = await editStoredMessages(announcements, (record) => buildPollMessage(poll, tally, record.intro));
        if (recordsChanged(announcements, kept)) {
            await updateDoc(doc(db, 'polls', pollId), { announcements: kept });
        }
        return true;
    } catch (err) {
        console.error('refreshPollMessages failed:', err.message);
        return false;
    }
}

/**
 * Turn the posted messages of a deleted poll into a short notice.
 *
 * @param {Object} poll -> The poll that is being deleted.
 * @returns {Promise<boolean>} -> True when messages were processed.
 */
async function markPollMessagesDeleted(poll) {
    if (!state.isReady) return false;
    try {
        const announcements = Array.isArray(poll.announcements) ? poll.announcements : [];
        if (announcements.length === 0) return false;
        // The ping line goes away with the poll
        await editStoredMessages(announcements, () => buildPollDeletedMessage(poll));
        return true;
    } catch (err) {
        console.error('markPollMessagesDeleted failed:', err.message);
        return false;
    }
}

/**
 * Handle "Abstimmen" below a poll message.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<void>}
 */
async function handlePollVoteButton(interaction, pollId) {
    // Acknowledge first -> loading the poll and the roles can take a moment
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { loadPoll, loadUserVote } = require('../utils/pollStore');
    const poll = await loadPoll(pollId);
    if (!poll) {
        return interaction.editReply({ content: '❌ Diese Abstimmung gibt es nicht mehr.' });
    }
    if (!isPollOpen(poll)) {
        return interaction.editReply({ content: '🔒 Die Abstimmung ist beendet.' });
    }
    if (await isRegistrationBlocked()) {
        return interaction.editReply({ content: '❌ Abstimmungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.' });
    }
    const roleIds = await resolveInteractionRoles(interaction);
    if (!canVote(poll, roleIds)) {
        return interaction.editReply({ content: '❌ Du hast nicht die erforderliche Rolle für diese Abstimmung.' });
    }
    const vote = await loadUserVote(pollId, interaction.user.id);
    await interaction.editReply(buildPollVoteReply(poll, vote));
}

/**
 * Handle a change in one of the two vote selects.
 *
 * The changed list wins: a date picked as "wenn nötig" leaves "passt" and
 * the other way round.
 *
 * @param {import('discord.js').StringSelectMenuInteraction} interaction -> The select interaction.
 * @param {string} pollId -> The poll document ID.
 * @param {'yes'|'maybe'} kind -> Which list was changed.
 * @returns {Promise<void>}
 */
async function handlePollVoteSelect(interaction, pollId, kind) {
    await interaction.deferUpdate();
    if (await isRegistrationBlocked()) {
        return interaction.editReply({ content: '❌ Abstimmungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.', components: [] });
    }
    const { loadPoll, savePollVote } = require('../utils/pollStore');
    const picked = Array.isArray(interaction.values) ? interaction.values : [];
    // The changed list wins; merged under the poll lock -> a parallel web click is not lost
    const merge = (stored) => (kind === 'yes'
        ? { yes: picked, maybe: stored.maybe.filter(id => !picked.includes(id)) }
        : { yes: stored.yes.filter(id => !picked.includes(id)), maybe: picked });

    const roleIds = await resolveInteractionRoles(interaction);
    const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
    const result = await savePollVote({
        pollId,
        user: { id: interaction.user.id, displayName, roles: roleIds },
        update: merge
    });
    if (!result.ok) {
        return interaction.editReply({ content: `❌ ${result.error}`, components: [] });
    }

    // Discord voters show up with name and avatar on the website
    await ensureUserProfile(interaction.user, displayName);
    const poll = await loadPoll(pollId);
    const labels = getPollLabels(poll);
    const status = `💾 Gespeichert: ${result.vote.yes.length}× ${escapeMarkdown(labels.yes)}, ${result.vote.maybe.length}× ${escapeMarkdown(labels.maybe)}.`;
    await interaction.editReply(buildPollVoteReply(poll, result.vote, status));
}

module.exports = {
    buildPollMessage,
    buildPollDeletedMessage,
    buildPollVoteReply,
    refreshPollMessages,
    markPollMessagesDeleted,
    handlePollVoteButton,
    handlePollVoteSelect
};
