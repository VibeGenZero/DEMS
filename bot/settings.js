/**
 * Bot control center: status, settings, presence (status and activity text)
 * and the running events shown there.
 */
const { ActivityType } = require('discord.js');
const { db, collection, doc, getDocs, setDoc, query, where } = require('../firebaseAdmin');
const { loadBotSettings, rememberBotSettings } = require('../utils/botSettings');
const { isEventOver } = require('../utils/eventListing');
const { client, state } = require('./client');
const { isReminderSchedulerRunning } = require('./scheduler');
const { TIMEZONE } = require('./constants');

let presenceUpdateInterval = null;

/**
 * Get bot status information for the control center
 */
function getBotStatus() {
    const guild = client.guilds?.cache.get(process.env.DISCORD_GUILD_ID);
    return {
        online: state.isReady,
        username: client.user?.tag || null,
        avatarUrl: client.user?.displayAvatarURL({ size: 128 }) || null,
        uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : 0,
        startedAt: state.startedAt ? state.startedAt.toISOString() : null,
        ping: client.ws.ping || 0,
        guildName: guild?.name || null,
        guildMemberCount: guild?.memberCount || 0,
        guildId: process.env.DISCORD_GUILD_ID || null,
        dmsSent: state.dmsSent,
        commandsProcessed: state.commandsProcessed,
        reminderSchedulerActive: isReminderSchedulerRunning(),
        presenceAutoUpdate: isPresenceAutoUpdating(),
    };
}

/**
 * Bot settings with defaults for every key (cached, utils/botSettings.js).
 *
 * @returns {Promise<Object>}
 */
async function getBotSettings() {
    return loadBotSettings();
}

/**
 * Save bot settings to the database and apply them
 */
async function saveBotSettings(settings) {
    try {
        const stored = { ...settings, updatedAt: new Date().toISOString() };
        await setDoc(doc(db, 'botSettings', 'config'), stored);
        rememberBotSettings(stored);
        await applyBotSettings();
        return true;
    } catch (err) {
        console.error('Failed to save bot settings:', err.message);
        return false;
    }
}

/**
 * Build template variables for activity text from live event data
 * Supported variables:
 *   {events.count}        — Number of active events
 *   {events.next}         — Title of the next upcoming event
 *   {events.next.date}    — Date of the next upcoming event (short format)
 *   {events.next.time}    — Time of the next upcoming event
 *   {events.next.participants} — Current participant count of next event
 *   {events.list}         — Comma-separated list of next 2 event titles
 *   {events.list.details} — Next 2 events with date (e.g. "Event1 (12. Mär) | Event2 (15. Mär)")
 *   {server.members}      — Guild member count
 *   {server.name}         — Guild name
 *   {link.events}         — URL to events page
 */
async function buildActivityVariables() {
    const vars = {};
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    // Server info
    const guild = client.guilds?.cache.get(process.env.DISCORD_GUILD_ID);
    vars['server.members'] = guild?.memberCount || 0;
    vars['server.name'] = guild?.name || 'Server';
    vars['link.events'] = `${baseUrl}/#events`;

    // Fetch active events (lightweight — no registration stats needed here)
    try {
        const q = query(collection(db, 'events'), where('status', '==', 'active'));
        const snapshot = await getDocs(q);
        const events = [];
        snapshot.forEach(d => events.push({ id: d.id, ...d.data() }));

        // Sort by startDate ascending (soonest first)
        const now = new Date();
        events.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

        // Filter to upcoming/current events (not in the past)
        const upcoming = events.filter(e => {
            if (!e.startDate) return true;
            const end = e.endDate ? new Date(e.endDate) : new Date(new Date(e.startDate).getTime() + 2 * 60 * 60 * 1000);
            return end > now;
        });

        vars['events.count'] = upcoming.length;

        if (upcoming.length > 0) {
            const next = upcoming[0];
            vars['events.next'] = next.title || 'Unbekannt';

            if (next.startDate) {
                const d = new Date(next.startDate);
                vars['events.next.date'] = d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', timeZone: TIMEZONE });
                vars['events.next.time'] = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
            } else {
                vars['events.next.date'] = 'TBD';
                vars['events.next.time'] = 'TBD';
            }

            vars['events.next.participants'] = next.currentParticipants || 0;

            // List of up to 2 events
            const listEvents = upcoming.slice(0, 2);
            vars['events.list'] = listEvents.map(e => e.title).join(', ');
            vars['events.list.details'] = listEvents.map(e => {
                const dateStr = e.startDate
                    ? new Date(e.startDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', timeZone: TIMEZONE })
                    : 'TBD';
                return `${e.title} (${dateStr})`;
            }).join(' | ');
        } else {
            vars['events.next'] = 'Keine Events';
            vars['events.next.date'] = '-';
            vars['events.next.time'] = '-';
            vars['events.next.participants'] = 0;
            vars['events.list'] = 'Keine Events';
            vars['events.list.details'] = 'Keine Events geplant';
        }
    } catch (err) {
        console.error('Failed to build activity variables:', err.message);
        vars['events.count'] = 0;
        vars['events.next'] = 'Fehler';
        vars['events.next.date'] = '-';
        vars['events.next.time'] = '-';
        vars['events.next.participants'] = 0;
        vars['events.list'] = '-';
        vars['events.list.details'] = '-';
    }

    return vars;
}

/**
 * Apply bot settings (presence, activity, etc.)
 */
async function applyBotSettings() {
    if (!state.isReady) return;
    try {
        const settings = await getBotSettings();

        // Set presence status
        const statusMap = { online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'invisible' };
        let status = statusMap[settings.statusType] || 'online';

        // Auto-Status based on calendar events (only when autoUpdatePresence is enabled)
        if (settings.autoStatusCalendarEvents && settings.autoUpdatePresence) {
            try {
                const now = new Date();
                const q = query(collection(db, 'events'), where('status', '==', 'active'));
                const snapshot = await getDocs(q);
                const events = [];
                snapshot.forEach(d => events.push({ id: d.id, ...d.data() }));

                // Same end rule as the event overview (utils/eventListing.js)
                const running = events.some(e => e.startDate && new Date(e.startDate) <= now && !isEventOver(e, now));

                const upcoming = events.some(e => {
                    if (!e.startDate) return false;
                    const start = new Date(e.startDate);
                    return start > now;
                });

                if (running) {
                    status = 'dnd';       // Event läuft gerade
                } else if (upcoming) {
                    status = 'online';    // Event steht an
                } else {
                    status = 'idle';      // Keine Events in Zukunft geplant
                }
            } catch (err) {
                console.error('Auto-Status calendar check failed:', err.message);
            }
        }

        // Set activity
        const activityTypeMap = {
            PLAYING: ActivityType.Playing,
            WATCHING: ActivityType.Watching,
            LISTENING: ActivityType.Listening,
            COMPETING: ActivityType.Competing,
        };

        const activities = [];
        if (settings.activityText) {
            // Parse template variables in activity text
            const vars = await buildActivityVariables();
            let activityText = settings.activityText;
            for (const [key, value] of Object.entries(vars)) {
                activityText = activityText.replace(new RegExp(`\\{${key.replace('.', '\\.')}\\}`, 'g'), String(value));
            }

            activities.push({
                name: activityText.substring(0, 128),
                type: activityTypeMap[settings.activityType] || ActivityType.Watching
            });
        }

        client.user.setPresence({ status, activities });

        // The reminder scheduler always runs (deadline refresh, start handling);
        // reminderEnabled is checked per pass in checkReminders (B-02)

        // Toggle presence auto-update (refreshes activity text with live event data)
        if (settings.autoUpdatePresence && !presenceUpdateInterval) {
            presenceUpdateInterval = setInterval(applyBotSettings, 5 * 60 * 1000); // Every 5 min
            console.log('🔄 Presence Auto-Update aktiviert (alle 5 Min.)');
        } else if (!settings.autoUpdatePresence && presenceUpdateInterval) {
            clearInterval(presenceUpdateInterval);
            presenceUpdateInterval = null;
            console.log('🔄 Presence Auto-Update deaktiviert');
        }

    } catch (err) {
        console.error('Failed to apply bot settings:', err.message);
    }
}

/**
 * Stop the presence auto-update (graceful shutdown).
 */
function stopPresenceUpdates() {
    if (presenceUpdateInterval) {
        clearInterval(presenceUpdateInterval);
        presenceUpdateInterval = null;
    }
}

/**
 * Whether the presence text refreshes itself every 5 minutes (bot control center status).
 *
 * @returns {boolean}
 */
function isPresenceAutoUpdating() {
    return !!presenceUpdateInterval;
}

/**
 * Get currently running (active) events with live data
 */
async function getRunningEvents() {
    try {
        const q = query(collection(db, 'events'), where('status', '==', 'active'));
        const snapshot = await getDocs(q);
        const events = [];
        for (const docSnap of snapshot.docs) {
            const event = { id: docSnap.id, ...docSnap.data() };
            // Ended events are no longer running; the scheduler archives them a day later
            if (isEventOver(event)) continue;
            // Count registrations
            const regQ = query(
                collection(db, 'registrations'),
                where('eventId', '==', docSnap.id)
            );
            const regSnap = await getDocs(regQ);
            let accepted = 0, pending = 0, waitlisted = 0, tentative = 0;
            regSnap.forEach(r => {
                const s = r.data().status;
                if (s === 'accepted') accepted++;
                else if (s === 'pending') pending++;
                else if (s === 'waitlisted') waitlisted++;
                else if (s === 'tentative') tentative++;
            });
            event.registrationStats = { accepted, pending, waitlisted, tentative, total: regSnap.size };
            events.push(event);
        }
        events.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
        return events;
    } catch (err) {
        console.error('Failed to get running events:', err.message);
        return [];
    }
}

module.exports = {
    getBotStatus,
    getBotSettings,
    saveBotSettings,
    applyBotSettings,
    stopPresenceUpdates,
    getRunningEvents
};
