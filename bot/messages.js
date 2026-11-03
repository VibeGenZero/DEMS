/**
 * Messages of the bot: DMs, channel messages, the event announcement as a
 * Components V2 message with its buttons (B-05), and refreshing stored announcements.
 */
const { ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } = require('discord.js');
const { db, doc, getDoc, updateDoc } = require('../firebaseAdmin');
const { debugLog } = require('../utils/debugLog');
const { buildEventUrl } = require('../utils/eventUrl');
const { bannerForDiscord } = require('../utils/bannerStore');
const { isRegistrationClosed } = require('../utils/eventListing');
const { formatPlaces } = require('../utils/capacity');
const { fitsIntoDiscordModal } = require('../utils/formFields');
const { hasSlots, formatSlotLabel, buildRoster } = require('../utils/slotService');
const { client, state } = require('./client');
const { TIMEZONE, REGISTER_BUTTON_PREFIX, TENTATIVE_BUTTON_PREFIX, SLOT_BUTTON_PREFIX, ROSTER_NAMES_MAX } = require('./constants');
const { toAccentColor, fitText, MESSAGE_TEXT_MAX } = require('./layout');

/**
 * Send a DM to a user
 */
async function sendDM(userId, message) {
    if (!state.isReady) {
        console.warn('Bot not ready yet, cannot send DM');
        return false;
    }
    debugLog('bot.sendDM', { userId, messageType: typeof message === 'string' ? 'text' : 'embed' });
    try {
        const user = await client.users.fetch(userId);
        await user.send(message);
        state.dmsSent++;
        console.log(`📩 DM sent to ${user.tag}`);
        return true;
    } catch (err) {
        console.error(`Failed to send DM to ${userId}:`, err.message);
        return false;
    }
}

/**
 * Post a Components V2 message (announcement or date poll) in a channel.
 *
 * The ping line is part of the payload (buildAnnouncementIntro); the options
 * only decide who may actually be notified.
 *
 * @param {string} channelId -> Target text channel.
 * @param {Object} payload -> From buildEventAnnouncement() or buildPollMessage().
 * @param {Object} [options] -> `{ roleIds, pingEveryone }` as chosen in the announce dialog.
 * @returns {Promise<Object|false>} -> `{ channelId, messageId, guildId }` of the sent message, false on failure.
 */
async function sendChannelMessage(channelId, payload, options = {}) {
    if (!state.isReady) {
        console.warn('Bot not ready yet, cannot send channel message');
        return false;
    }
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.send) {
            console.error('Channel not found or not a text channel:', channelId);
            return false;
        }

        const roleIds = Array.isArray(options.roleIds) ? options.roleIds : [];
        const message = await channel.send({
            ...payload,
            allowedMentions: {
                parse: options.pingEveryone ? ['everyone', 'roles'] : ['roles'],
                roles: roleIds
            }
        });
        console.log(`📢 Announcement sent to channel ${channelId}`);
        return { channelId: channel.id, messageId: message.id, guildId: channel.guildId || null };
    } catch (err) {
        console.error(`Failed to send channel message:`, err.message);
        return false;
    }
}

/**
 * Build an event announcement as a Components V2 message (B-05).
 *
 * Ping line above a container in the event colour: banner, title and
 * description, the facts, one block per slot (with its button while the
 * event can be joined from Discord) and the button row. With a roster the
 * message shows live numbers.
 *
 * @param {Object} event -> Event data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} [roster] -> Line-up from loadEventRoster().
 * @param {string} [intro] -> Ping line from buildAnnouncementIntro(), '' for none.
 * @returns {{ flags: number, components: Array }} -> Payload for channel.send() / message.edit().
 * @example
 * await channel.send(buildEventAnnouncement(event, eventId, roster, intro));
 */
function buildEventAnnouncement(event, eventId, roster, intro = '') {
    const joinable = canRegisterViaDiscord(event);
    const heading = `## 🎉 ${escapeMarkdown(String(event.title || ''))}`;
    const facts = buildEventFacts(event, roster);
    const blocks = hasSlots(event) ? buildLineupBlocks(event, eventId, roster, joinable) : [];

    // The description gets what the other texts leave of Discord's budget; the event page keeps the full text
    const used = (intro || '').length + heading.length + 1 + facts.length + blocks.reduce((sum, block) => sum + block.text.length, 0);
    const description = event.description ? fitText(event.description, MESSAGE_TEXT_MAX - used) : 'Keine Beschreibung.';

    const container = new ContainerBuilder().setAccentColor(toAccentColor(event.accentColor));
    // External URL as is; an uploaded banner (W-12) as BASE_URL + path
    const banner = bannerForDiscord(event.bannerUrl);
    if (banner.url) {
        container.addMediaGalleryComponents(gallery => gallery.addItems(item => item.setURL(banner.url)));
    }
    container.addTextDisplayComponents(
        text => text.setContent(`${heading}\n${description}`),
        text => text.setContent(facts)
    );
    container.addSeparatorComponents(separator => separator);
    for (const block of blocks) {
        if (block.button) {
            container.addSectionComponents(section => section
                .addTextDisplayComponents(text => text.setContent(block.text))
                .setButtonAccessory(block.button));
        } else {
            container.addTextDisplayComponents(text => text.setContent(block.text));
        }
    }
    container.addActionRowComponents(row => row.addComponents(...buildAnnouncementButtons(event, eventId, joinable)));

    const components = intro ? [new TextDisplayBuilder().setContent(intro), container] : [container];
    return { flags: MessageFlags.IsComponentsV2, components };
}

/**
 * Date in the configured time zone, as the announcement shows it.
 *
 * @param {string} [value] -> ISO date.
 * @returns {string} -> e.g. "1.12.2026, 19:00:00"; '' for no or an unreadable date.
 */
function formatDiscordDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('de-DE', { timeZone: TIMEZONE });
}

/**
 * Facts of an announcement, one line each.
 *
 * @param {Object} event -> Event data.
 * @param {Object} [roster] -> Line-up with live numbers.
 * @returns {string} -> Date, places, access, then waitlist, bench, category and deadlines when set.
 */
function buildEventFacts(event, roster) {
    const lines = [
        `🗓️ **Datum:** ${formatDiscordDate(event.startDate) || 'TBA'}`,
        `👥 **Plätze:** ${formatParticipantCount(event, roster)}`,
        `🔓 **Zugang:** ${event.accessMode === 'open' ? 'Offen für alle' : 'Rollen-Requirement'}`
    ];
    if (roster && roster.waitlistCount > 0) lines.push(`⏳ **Warteliste:** ${roster.waitlistCount}`);
    // „Vielleicht“ answers take no place (B-17)
    if (roster && roster.benchCount > 0) lines.push(`🤔 **Ersatzbank:** ${roster.benchCount}`);
    if (event.category) lines.push(`🏷️ **Kategorie:** ${escapeMarkdown(String(event.category))}`);
    // Optional deadlines, in the format of the date (W-03)
    for (const [label, value] of [['⏰ **Anmeldung bis:**', event.registrationDeadline], ['⏰ **Abmeldung bis:**', event.unregisterDeadline]]) {
        const date = formatDiscordDate(value);
        if (date) lines.push(`${label} ${date}`);
    }
    return lines.join('\n');
}

/**
 * Line-up blocks of a slot event.
 *
 * @param {Object} event -> Event data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} [roster] -> Line-up; without one every slot is empty.
 * @param {boolean} joinable -> Whether the slot buttons are shown.
 * @returns {Array<{ text: string, button: ButtonBuilder|null }>} -> One block per slot.
 */
function buildLineupBlocks(event, eventId, roster, joinable) {
    const lineup = roster || buildRoster(event, []);
    return lineup.slots.map(slot => ({
        text: `**${escapeMarkdown(formatRosterSlotTitle(slot))}**\n${formatRosterMembers(slot)}`,
        button: joinable ? buildSlotButton(eventId, slot, lineup) : null
    }));
}

/**
 * Places line of the announcement.
 *
 * @param {Object} event -> Event data.
 * @param {Object} [roster] -> Line-up with live numbers.
 * @returns {string} -> The places sentence of utils/capacity.js ("3 von 10 Plätzen belegt (inkl. 1 Gast)"), without a roster the static capacity.
 */
function formatParticipantCount(event, roster) {
    if (!roster) return event.maxParticipants > 0 ? `Max. ${event.maxParticipants}` : 'Unbegrenzt';
    return formatPlaces(roster.places);
}

/**
 * Block title of one slot, e.g. "🛡️ Tank 2/2 ✅".
 *
 * @param {Object} slot -> Roster slot.
 * @returns {string} -> Title with ✅ when full and ⚠️ when overbooked.
 */
function formatRosterSlotTitle(slot) {
    let marker = '';
    if (slot.taken > slot.capacity) marker = ' ⚠️';
    else if (slot.taken === slot.capacity) marker = ' ✅';
    return `${formatSlotLabel(slot)} ${slot.taken}/${slot.capacity}${marker}`;
}

/**
 * Line-up of one slot: the first names, then "+N".
 *
 * @param {Object} slot -> Roster slot.
 * @returns {string} -> Names, escaped for Discord markdown.
 */
function formatRosterMembers(slot) {
    if (slot.members.length === 0) return '— frei —';
    const names = slot.members.slice(0, ROSTER_NAMES_MAX).map(member => escapeMarkdown(member.displayName));
    const hidden = slot.members.length - ROSTER_NAMES_MAX;
    return hidden > 0 ? `${names.join(', ')}, +${hidden}` : names.join(', ');
}

/**
 * Check whether an event can be joined directly from Discord.
 *
 * Events without a form are always joinable. Events with a form are joinable
 * as long as the form fits into a Discord modal -> at most five fields, each
 * of a known field type.
 *
 * @param {Object} event -> The event document data.
 * @returns {boolean} -> True when the "Anmelden" button may be shown.
 * @example
 * if (canRegisterViaDiscord(event)) row.addComponents(registerButton);
 */
function canRegisterViaDiscord(event) {
    if (!event) return false;
    if (event.status && event.status !== 'active') return false;
    // Closed by the end or the registration deadline (W-03)
    if (isRegistrationClosed(event)) return false;
    return fitsIntoDiscordModal(event);
}

/**
 * Buttons of the last row of an announcement.
 *
 * "Anmelden" for an event without slots while it can be joined from Discord
 * (slot events carry their buttons beside the line-up), "Vielleicht" while it
 * can be joined and allows it (B-17), then always the link to the event page.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {boolean} joinable -> Result of canRegisterViaDiscord(event).
 * @returns {ButtonBuilder[]} -> One to three buttons.
 */
function buildAnnouncementButtons(event, eventId, joinable) {
    const buttons = [];
    if (joinable && !hasSlots(event)) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`${REGISTER_BUTTON_PREFIX}:${eventId}`)
                .setLabel('Anmelden')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅')
        );
    }
    if (joinable && event.allowTentative === true) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`${TENTATIVE_BUTTON_PREFIX}:${eventId}`)
                .setLabel('Vielleicht')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🤔')
        );
    }
    buttons.push(
        new ButtonBuilder()
            .setLabel('Zum Event')
            .setStyle(ButtonStyle.Link)
            .setURL(buildEventUrl(eventId))
            .setEmoji('🔗')
    );
    return buttons;
}

/**
 * Build the button of one slot.
 *
 * Full slots stay clickable -> the click can still lead to a fallback role
 * or the waitlist.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} slot -> The slot.
 * @param {Object} [roster] -> Line-up with the taken places.
 * @returns {ButtonBuilder} -> The slot button.
 */
function buildSlotButton(eventId, slot, roster) {
    const rosterSlot = roster ? roster.slots.find(entry => entry.id === slot.id) : null;
    const isFull = !!rosterSlot && rosterSlot.taken >= slot.capacity;
    const button = new ButtonBuilder()
        .setCustomId(`${SLOT_BUTTON_PREFIX}:${eventId}:${slot.id}`)
        .setLabel(isFull ? `${slot.name} (voll)` : slot.name)
        .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Primary);
    if (slot.emoji) button.setEmoji(slot.emoji);
    return button;
}

// Discord error codes for "Unknown Channel" and "Unknown Message"
const DISCORD_GONE_ERROR_CODES = [10003, 10008];

/**
 * Whether a Discord API error means the channel or message no longer exists.
 *
 * @param {*} err -> Error thrown by discord.js.
 * @returns {boolean} -> True for deleted channels or messages.
 */
function isGoneDiscordError(err) {
    return !!err && DISCORD_GONE_ERROR_CODES.includes(err.code);
}

/**
 * Re-render every stored Discord message as a Components V2 message.
 *
 * Each record gets its own payload (its ping line differs). A record posted
 * before B-05 has no `intro`: its message text becomes the intro, and the
 * same edit drops text and embed, so the old message turns into the new
 * layout. Edits never notify anybody again.
 *
 * @param {Array<Object>} announcements -> `[{ channelId, messageId, intro? }]`.
 * @param {function(Object): Object} buildPayload -> Record (with intro) -> V2 payload.
 * @returns {Promise<Array<Object>>} -> The records that still exist; converted ones with their intro.
 */
async function editStoredMessages(announcements, buildPayload) {
    const kept = [];
    for (const announcement of announcements) {
        try {
            const channel = await client.channels.fetch(announcement.channelId);
            const message = await channel.messages.fetch(announcement.messageId);
            const record = typeof announcement.intro === 'string'
                ? announcement
                : { ...announcement, intro: message.content || '' };
            await message.edit({
                ...buildPayload(record),
                content: null,
                embeds: [],
                allowedMentions: { parse: [] }
            });
            kept.push(record);
        } catch (err) {
            if (isGoneDiscordError(err)) continue;
            console.error('Failed to edit a stored message:', err.message);
            kept.push(announcement);
        }
    }
    return kept;
}

/**
 * Replace one posted V2 message.
 *
 * @param {string} channelId -> Channel of the message.
 * @param {string} messageId -> The message.
 * @param {Object} payload -> New V2 payload.
 * @returns {Promise<boolean>} -> True when edited; false while offline, for a deleted message or on errors (logged).
 */
async function editChannelMessage(channelId, messageId, payload) {
    if (!state.isReady) return false;
    try {
        const channel = await client.channels.fetch(channelId);
        const message = await channel.messages.fetch(messageId);
        await message.edit({ ...payload, content: null, embeds: [], allowedMentions: { parse: [] } });
        return true;
    } catch (err) {
        if (!isGoneDiscordError(err)) console.error('Failed to edit a channel message:', err.message);
        return false;
    }
}

/**
 * Re-render every stored announcement of an event with the live line-up.
 *
 * Deleted messages are dropped from `event.announcements`; other errors are
 * logged and the message is kept for the next attempt.
 *
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<boolean>} -> True when announcements were processed.
 */
async function refreshEventAnnouncements(eventId) {
    if (!state.isReady) return false;
    try {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) return false;

        const event = eventSnap.data();
        const announcements = Array.isArray(event.announcements) ? event.announcements : [];
        if (announcements.length === 0) return false;

        const { loadEventRoster } = require('../utils/eventUtils');
        const roster = await loadEventRoster(eventId, event);
        const kept = await editStoredMessages(announcements, (record) => buildEventAnnouncement(event, eventId, roster, record.intro));

        if (recordsChanged(announcements, kept)) {
            await updateDoc(doc(db, 'events', eventId), { announcements: kept });
        }
        return true;
    } catch (err) {
        console.error('refreshEventAnnouncements failed:', err.message);
        return false;
    }
}

/**
 * Whether refreshed records differ from the stored ones (dropped or converted).
 *
 * @param {Array<Object>} before -> Stored records.
 * @param {Array<Object>} after -> Result of editStoredMessages().
 * @returns {boolean} -> True when they must be written back.
 */
function recordsChanged(before, after) {
    return before.length !== after.length || after.some((record, index) => record !== before[index]);
}

module.exports = {
    sendDM,
    sendChannelMessage,
    buildEventAnnouncement,
    canRegisterViaDiscord,
    buildSlotButton,
    isGoneDiscordError,
    editStoredMessages,
    editChannelMessage,
    recordsChanged,
    refreshEventAnnouncements
};
