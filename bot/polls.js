/**
 * Date polls in Discord: the poll embed and buttons, refreshing posted polls
 * and the vote buttons and selects.
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, escapeMarkdown } = require('discord.js');
const { db, doc, updateDoc } = require('../firebaseAdmin');
const { buildEventUrl, buildPollUrl } = require('../utils/eventUrl');
const { isRegistrationBlocked } = require('../middleware/maintenance');
const { tallyPoll, getFavoriteOptionId, formatPollOption, isPollOpen, canVote, getPollLabels } = require('../utils/pollService');
const { SELECT_OPTION_LABEL_MAX_LENGTH, POLL_VOTE_PREFIX, POLL_YES_PREFIX, POLL_MAYBE_PREFIX, POLL_NAMES_MAX, POLL_DESCRIPTION_MAX_LENGTH } = require('./constants');
const { state } = require('./client');
const { editStoredMessages } = require('./messages');
const { resolveInteractionRoles, ensureUserProfile } = require('./registration');

/**
 * Build the embed of a date poll.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @param {Object} tally -> Result of tallyPoll().
 * @returns {EmbedBuilder} -> The embed.
 */
function buildPollEmbed(poll, tally) {
    const decided = poll.status === 'decided';
    const closed = !decided && !isPollOpen(poll);
    let title = `📅 ${poll.title}`;
    if (decided) title = `✅ Termin steht: ${poll.title}`;
    else if (closed) title = `🔒 Abstimmung beendet: ${poll.title}`;

    const embed = new EmbedBuilder()
        .setColor(decided ? 0x22c55e : 0x8b5cf6)
        .setTitle(title.substring(0, 256));

    const winner = decided ? poll.options.find(option => option.id === poll.winnerOptionId) : null;
    const description = winner
        ? `**${formatPollOption(winner)}**`
        : (poll.description || '').substring(0, POLL_DESCRIPTION_MAX_LENGTH);
    if (description) embed.setDescription(description);

    const highlightId = decided ? poll.winnerOptionId : getFavoriteOptionId(tally);
    const labels = getPollLabels(poll);
    tally.options.forEach(entry => {
        const option = poll.options.find(candidate => candidate.id === entry.optionId);
        let marker = '';
        if (entry.optionId === highlightId) marker = decided ? '✅ ' : '🏆 ';
        embed.addFields({ name: `${marker}${formatPollOption(option)}`, value: `✅ ${entry.yes} · 🤔 ${entry.maybe}\n${formatPollVoters(entry, labels)}`, inline: false });
    });

    const votes = `${tally.voterCount} ${tally.voterCount === 1 ? 'Stimme' : 'Stimmen'}`;
    let footer = `Abstimmung beendet · ${votes}`;
    if (!decided && !closed) {
        footer = poll.deadline
            ? `⏰ Abstimmung bis ${formatPollOption({ startDate: poll.deadline })} · ${votes}`
            : `Abstimmung offen · ${votes}`;
    }
    embed.setFooter({ text: footer });
    return embed;
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
 * Buttons below a poll message.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @returns {ActionRowBuilder[]} -> One row.
 */
function buildPollComponents(poll) {
    const row = new ActionRowBuilder();
    if (poll.status === 'decided' && poll.eventId) {
        row.addComponents(
            new ButtonBuilder().setLabel('Zum Event').setStyle(ButtonStyle.Link).setURL(buildEventUrl(poll.eventId)).setEmoji('🔗')
        );
        return [row];
    }
    if (isPollOpen(poll)) {
        row.addComponents(
            new ButtonBuilder().setCustomId(`${POLL_VOTE_PREFIX}:${poll.id}`).setLabel('Abstimmen').setStyle(ButtonStyle.Primary).setEmoji('🗳️')
        );
    }
    row.addComponents(
        new ButtonBuilder().setLabel('Im Web ansehen').setStyle(ButtonStyle.Link).setURL(buildPollUrl(poll.id)).setEmoji('🔗')
    );
    return [row];
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
        const kept = await editStoredMessages(announcements, {
            embeds: [buildPollEmbed(poll, tally)],
            components: buildPollComponents(poll)
        });
        if (kept.length !== announcements.length) {
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
        const embed = new EmbedBuilder()
            .setColor(0x6b7280)
            .setTitle(`🗑️ Abstimmung gelöscht: ${poll.title}`.substring(0, 256))
            .setDescription('Diese Abstimmung wurde von einem Admin gelöscht.');
        await editStoredMessages(announcements, { embeds: [embed], components: [] });
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
    buildPollEmbed,
    buildPollComponents,
    buildPollVoteReply,
    refreshPollMessages,
    markPollMessagesDeleted,
    handlePollVoteButton,
    handlePollVoteSelect
};
