/**
 * Messages of the bot: DMs, channel messages, the event announcement embed with
 * its buttons, and refreshing stored announcements.
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } = require('discord.js');
const { db, doc, getDoc, updateDoc } = require('../firebaseAdmin');
const { debugLog } = require('../utils/debugLog');
const { buildEventUrl } = require('../utils/eventUrl');
const { bannerForDiscord } = require('../utils/bannerStore');
const { isRegistrationClosed } = require('../utils/eventListing');
const { formatPlaces } = require('../utils/capacity');
const { fitsIntoDiscordModal } = require('../utils/formFields');
const { getSlots, hasSlots, formatSlotLabel } = require('../utils/slotService');
const { client, state } = require('./client');
const { TIMEZONE, REGISTER_BUTTON_PREFIX, SLOT_BUTTON_PREFIX, BUTTONS_PER_ROW, ROSTER_NAMES_MAX } = require('./constants');

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
 * Send a rich embed message to a Discord channel
 * @param {string} channelId
 * @param {EmbedBuilder} embed
 * @param {Object} [options] - Additional options
 * @param {string} [options.text] - Text content above the embed
 * @param {string[]} [options.roleIds] - Role IDs to mention
 * @param {boolean} [options.pingEveryone] - Whether to mention @everyone
 * @param {ActionRowBuilder[]} [options.components] - Button rows below the embed
 * @returns {Promise<Object|false>} -> { channelId, messageId } of the sent message, false on failure.
 */
async function sendChannelMessage(channelId, embed, options = {}) {
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

        // Build content string with mentions
        let contentParts = [];

        // Role pings
        if (options.roleIds && options.roleIds.length > 0) {
            const roleMentions = options.roleIds.map(id => `<@&${id}>`).join(' ');
            contentParts.push(roleMentions);
        }

        // @everyone ping
        if (options.pingEveryone) {
            contentParts.push('@everyone');
        }

        // Custom text
        if (options.text && options.text.trim()) {
            contentParts.push(options.text.trim());
        }

        const content = contentParts.length > 0 ? contentParts.join('\n') : undefined;

        const message = await channel.send({
            content,
            embeds: [embed],
            components: options.components || [],
            allowedMentions: {
                parse: options.pingEveryone ? ['everyone', 'roles'] : ['roles'],
                roles: options.roleIds || []
            }
        });
        console.log(`📢 Announcement sent to channel ${channelId}`);
        return { channelId: channel.id, messageId: message.id };
    } catch (err) {
        console.error(`Failed to send channel message:`, err.message);
        return false;
    }
}

/**
 * Build an event announcement embed.
 *
 * With a roster the embed shows live numbers: the places sentence, the
 * waitlist and, for slot events, one field per slot with the first names.
 *
 * @param {Object} event -> Event data.
 * @param {string} [registrationLink] -> Link to the event page.
 * @param {Object} [roster] -> Line-up from loadEventRoster().
 * @returns {EmbedBuilder} -> The embed.
 */
function buildEventEmbed(event, registrationLink, roster) {
    const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`🎉 ${event.title}`)
        .setDescription(cutForEmbed(event.description) || 'Keine Beschreibung.')
        .addFields(
            { name: '🗓️ Datum', value: event.startDate ? new Date(event.startDate).toLocaleString('de-DE', { timeZone: TIMEZONE }) : 'TBA', inline: true },
            { name: '👥 Plätze', value: formatParticipantCount(event, roster), inline: true },
            { name: '🔓 Zugang', value: event.accessMode === 'open' ? 'Offen für alle' : 'Rollen-Requirement', inline: true }
        )
        .setFooter({ text: 'DEMS — Event Management' })
        .setTimestamp();

    if (roster && roster.slots.length > 0) {
        roster.slots.forEach(slot => {
            embed.addFields({ name: formatRosterSlotTitle(slot), value: formatRosterMembers(slot), inline: true });
        });
    }
    if (roster && roster.waitlistCount > 0) {
        embed.addFields({ name: '⏳ Warteliste', value: String(roster.waitlistCount), inline: true });
    }

    // External URL as is; an uploaded banner (W-12) as BASE_URL + path
    const banner = bannerForDiscord(event.bannerUrl);
    if (banner.url) {
        embed.setImage(banner.url);
    }

    if (event.category) {
        embed.addFields({ name: '🏷️ Kategorie', value: event.category, inline: true });
    }

    // Optional deadlines, in the format of the date field (W-03)
    const deadlineFields = [['⏰ Anmeldung bis', event.registrationDeadline], ['⏰ Abmeldung bis', event.unregisterDeadline]];
    deadlineFields.forEach(([name, value]) => {
        if (value && !Number.isNaN(new Date(value).getTime())) {
            embed.addFields({ name, value: new Date(value).toLocaleString('de-DE', { timeZone: TIMEZONE }), inline: true });
        }
    });

    if (registrationLink) {
        embed.addFields({ name: '📋 Anmeldung', value: `[Hier anmelden](${registrationLink})`, inline: false });
    }

    return embed;
}

// Discord refuses an embed description above 4096 characters; events allow 5000
const EMBED_DESCRIPTION_MAX = 4096;

/**
 * Event description as an embed takes it; the event page keeps the full text.
 *
 * @param {string} [text] -> Description of the event.
 * @returns {string} -> The text, or its first characters and "…" when it is too long for Discord.
 */
function cutForEmbed(text) {
    if (!text || text.length <= EMBED_DESCRIPTION_MAX) return text;
    let cut = text.slice(0, EMBED_DESCRIPTION_MAX - 1);
    // A cut through an emoji would leave half a character
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut}…`;
}

/**
 * Participant field of the embed.
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
 * Field title of one slot, e.g. "🛡️ Tank 2/2 ✅".
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
 * Field value of one slot: the first names, then "+N".
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
 * Build the button rows that are attached to an event announcement.
 *
 * Slot events get one button per slot, normal events the "Anmelden" button,
 * both only while the event can be joined from Discord. The link button is
 * always the last button.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} [roster] -> Line-up, marks full slots.
 * @returns {ActionRowBuilder[]} -> Components array ready for channel.send().
 * @example
 * await channel.send({ embeds: [embed], components: buildEventComponents(event, eventId, roster) });
 */
function buildEventComponents(event, eventId, roster) {
    const buttons = [];

    if (canRegisterViaDiscord(event)) {
        if (hasSlots(event)) {
            getSlots(event).forEach(slot => buttons.push(buildSlotButton(eventId, slot, roster)));
        } else {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`${REGISTER_BUTTON_PREFIX}:${eventId}`)
                    .setLabel('Anmelden')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );
        }
    }

    buttons.push(
        new ButtonBuilder()
            .setLabel('Zum Event')
            .setStyle(ButtonStyle.Link)
            .setURL(buildEventUrl(eventId))
            .setEmoji('🔗')
    );

    const rows = [];
    for (let index = 0; index < buttons.length; index += BUTTONS_PER_ROW) {
        rows.push(new ActionRowBuilder().addComponents(...buttons.slice(index, index + BUTTONS_PER_ROW)));
    }
    return rows;
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
 * Edit every stored Discord message with the same payload.
 *
 * @param {Array<Object>} announcements -> `[{ channelId, messageId }]`.
 * @param {Object} payload -> Message edit payload.
 * @returns {Promise<Array<Object>>} -> The announcements that still exist.
 */
async function editStoredMessages(announcements, payload) {
    const kept = [];
    for (const announcement of announcements) {
        try {
            const channel = await client.channels.fetch(announcement.channelId);
            const message = await channel.messages.fetch(announcement.messageId);
            await message.edit(payload);
            kept.push(announcement);
        } catch (err) {
            if (isGoneDiscordError(err)) continue;
            console.error('Failed to edit a stored message:', err.message);
            kept.push(announcement);
        }
    }
    return kept;
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
        const embed = buildEventEmbed(event, buildEventUrl(eventId), roster);
        const components = buildEventComponents(event, eventId, roster);

        const kept = await editStoredMessages(announcements, { embeds: [embed], components });

        if (kept.length !== announcements.length) {
            await updateDoc(doc(db, 'events', eventId), { announcements: kept });
        }
        return true;
    } catch (err) {
        console.error('refreshEventAnnouncements failed:', err.message);
        return false;
    }
}

module.exports = {
    sendDM,
    sendChannelMessage,
    buildEventEmbed,
    canRegisterViaDiscord,
    buildEventComponents,
    isGoneDiscordError,
    editStoredMessages,
    refreshEventAnnouncements
};
