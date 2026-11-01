/**
 * Dummy data of the dev mock mode.
 *
 * buildSeedData(now) returns every document as { collection: { id: data } }.
 * All dates are relative to `now`, so the events never go stale, and every
 * document has a fixed ID, so seeding is repeatable and links stay stable.
 */
const { GUILD, PERSONAS, MEMBERS, ROLE_ID, CHANNEL_ID, defaultAvatar } = require('./mockGuild');
const { FORM_FIELD_TYPE, formatEntityAnswer } = require('../utils/formFields');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const EVENT_ID = {
    OPEN: 'dev-event-open',
    FORM: 'dev-event-form',
    FULL: 'dev-event-full',
    ROLE: 'dev-event-role',
    BIG_FORM: 'dev-event-bigform',
    RUNNING: 'dev-event-running',
    PAST: 'dev-event-past',
    ENDED: 'dev-event-ended',
    ARCHIVED: 'dev-event-archived',
    DRAFT: 'dev-event-draft',
    CANCELLED: 'dev-event-cancelled'
};
const SERIES_ID = 'dev-series-training';
const SERIES_EVENT_IDS = ['dev-event-series-1', 'dev-event-series-2', 'dev-event-series-3'];
/** Role slots of the raid event. */
const RAID_SLOT_ID = { TANK: 'tank', HEAL: 'heal', DPS: 'dps' };

/** Date polls of the seed. */
const POLL_ID = { OPEN: 'dev-poll-raid', DECIDED: 'dev-poll-summer' };

/** Check-in code of the running event. */
const CHECKIN_CODE = 'DEMO42';

/**
 * Banner file of every dummy event (dev/banners/<name>.svg, served at
 * /dev-banners only in mock mode). The workshop's file does not exist on
 * purpose, so the overview shows its colour fallback.
 */
const EVENT_BANNERS = {
    [EVENT_ID.OPEN]: 'spieleabend',
    [EVENT_ID.FORM]: 'turnier',
    [EVENT_ID.FULL]: 'koop',
    [EVENT_ID.ROLE]: 'raid',
    [EVENT_ID.BIG_FORM]: 'workshop',
    [EVENT_ID.RUNNING]: 'speedrun',
    [EVENT_ID.PAST]: 'retro',
    [EVENT_ID.ENDED]: 'spieleabend',
    [EVENT_ID.ARCHIVED]: 'sommerfest',
    [EVENT_ID.DRAFT]: 'halloween',
    [EVENT_ID.CANCELLED]: 'koop',
    ...Object.fromEntries(SERIES_EVENT_IDS.map(id => [id, 'training']))
};

/**
 * Absolute banner address; the mock mode sets BASE_URL to its own port.
 *
 * @param {string} name -> File name without .svg.
 * @returns {string} -> URL the browser can load.
 */
const bannerUrl = (name) => `${process.env.BASE_URL || 'http://localhost:3000'}/dev-banners/${name}.svg`;

// Everybody on the mock server, addressable by username (people.lena, ...)
const people = Object.fromEntries([...PERSONAS, ...MEMBERS].map(person => [person.username, person]));

// Five fields -> still fits into a Discord modal
const TOURNAMENT_FORM = [
    { label: 'Ingame-Name', type: FORM_FIELD_TYPE.TEXT, required: true, description: 'So wie er im Spiel angezeigt wird' },
    { label: 'Bevorzugte Rolle', type: FORM_FIELD_TYPE.DROPDOWN, required: true, options: ['Tank', 'Heiler', 'Schaden'] },
    { label: 'Regeln gelesen', type: FORM_FIELD_TYPE.CHECKBOX, required: true, description: 'Bestätige, dass du das Regelwerk kennst' },
    { label: 'Team-Rolle', type: FORM_FIELD_TYPE.ROLE, required: false },
    { label: 'Wunsch-Channel', type: FORM_FIELD_TYPE.CHANNEL, required: false }
];

// Seven fields -> too big for Discord, registration only on the website
const WORKSHOP_FORM = [
    { label: 'Name', type: FORM_FIELD_TYPE.TEXT, required: true },
    { label: 'Streaming-Erfahrung', type: FORM_FIELD_TYPE.DROPDOWN, required: true, options: ['Keine', 'Etwas', 'Viel'] },
    { label: 'Deine Ausrüstung', type: FORM_FIELD_TYPE.TEXTAREA, required: false, description: 'Kamera, Mikrofon, Software …' },
    { label: 'Welche Plattform nutzt du?', type: FORM_FIELD_TYPE.TEXT, required: false },
    { label: 'Mentor-Wunsch', type: FORM_FIELD_TYPE.USER, required: false },
    { label: 'Ansprechpartner', type: FORM_FIELD_TYPE.MENTIONABLE, required: false },
    { label: 'Aufzeichnung erlaubt', type: FORM_FIELD_TYPE.CHECKBOX, required: true }
];

/**
 * Date helpers bound to one reference time.
 *
 * @param {Date} now -> Reference time of the seed.
 * @returns {{ offset: Function, slot: Function }} -> Date helpers.
 */
function createClock(now) {
    return {
        /** ISO date `ms` milliseconds from now (negative = in the past). */
        offset: (ms) => new Date(now.getTime() + ms).toISOString(),
        /** ISO date of the full hour `hour` on the day `days` from now. */
        slot: (days, hour) => {
            const date = new Date(now.getTime() + days * DAY);
            date.setHours(hour, 0, 0, 0);
            return date.toISOString();
        }
    };
}

/**
 * Event document with every field the admin form writes.
 *
 * @param {Object} clock -> Result of createClock().
 * @param {Object} fields -> Fields that differ from the defaults.
 * @returns {Object} -> Event document.
 */
function buildEvent(clock, fields) {
    return {
        title: '',
        description: '',
        maxParticipants: 0,
        accessMode: 'open',
        requiredRoles: [],
        approvalMode: 'instant',
        assignRoleId: '',
        formFields: [],
        startDate: '',
        endDate: '',
        registrationDeadline: '',
        unregisterDeadline: '',
        registrationClosedRefreshed: false,
        bannerUrl: '',
        category: '',
        status: 'active',
        reminderHours: [],
        checkinMessage: '',
        customBotMessages: {},
        autoCreateChannels: false,
        channelConfig: {},
        allowGuests: true,
        accentColor: '',
        location: null,
        eventStartNotificationSent: false,
        recurring: false,
        recurringInterval: '',
        recurringUntil: '',
        createdAt: clock.offset(-14 * DAY),
        createdBy: people.mori.userId,
        ...fields
    };
}

function buildEvents(clock) {
    const events = {
        [EVENT_ID.OPEN]: buildEvent(clock, {
            title: 'Community-Spieleabend',
            description: 'Gemütlicher Abend mit Party-Games — jeder ist willkommen!\n\n**Ablauf**\n- 19:00 Treffen in der Lobby\n- 19:15 erste Runde\n- ab 21:00 freies Spielen',
            maxParticipants: 20,
            startDate: clock.slot(3, 19),
            endDate: clock.slot(3, 22),
            category: 'Gaming',
            accentColor: '#8b5cf6',
            reminderHours: [{ hours: 24, sent: false }, { hours: 1, sent: false }],
            location: { text: 'Lobby', channelId: CHANNEL_ID.LOBBY, channelType: 'voice' },
            // Synced to Discord (B-09): saving or cancelling it shows the server event in the mock log
            discordScheduledEventId: '180000000000000001',
            discordScheduledEventStatus: 'scheduled'
        }),
        [EVENT_ID.FORM]: buildEvent(clock, {
            title: 'Turnier: Arena-Cup',
            description: 'Solo-Turnier im K.-o.-System. Anmeldungen werden von der Turnierleitung bestätigt.',
            maxParticipants: 16,
            approvalMode: 'manual',
            formFields: TOURNAMENT_FORM,
            allowGuests: false,
            startDate: clock.slot(7, 18),
            endDate: clock.slot(7, 23),
            category: 'Turnier',
            accentColor: '#f59e0b',
            createdAt: clock.offset(-13 * DAY)
        }),
        [EVENT_ID.FULL]: buildEvent(clock, {
            title: 'Koop-Abend (5 Plätze)',
            description: 'Kleine Runde mit nur fünf Plätzen — wer zu spät kommt, landet auf der Warteliste.',
            maxParticipants: 5,
            startDate: clock.slot(2, 20),
            // Registration closed two hours ago: the closed state in mock mode (W-03)
            registrationDeadline: clock.offset(-2 * HOUR),
            endDate: clock.slot(2, 23),
            category: 'Gaming'
        }),
        [EVENT_ID.ROLE]: buildEvent(clock, {
            title: 'Raid: Schattenfestung',
            description: 'Nur für Mitglieder mit der Rolle **Raid-Team**.',
            maxParticipants: 6,
            allowGuests: false,
            slots: [
                { id: RAID_SLOT_ID.TANK, name: 'Tank', emoji: '🛡️', capacity: 1 },
                { id: RAID_SLOT_ID.HEAL, name: 'Heiler', emoji: '💚', capacity: 2 },
                { id: RAID_SLOT_ID.DPS, name: 'Schaden', emoji: '⚔️', capacity: 3 }
            ],
            accessMode: 'role-required',
            requiredRoles: [ROLE_ID.RAID_TEAM],
            startDate: clock.slot(5, 20),
            // Members can drop out until the evening before (W-03)
            unregisterDeadline: clock.slot(4, 20),
            endDate: clock.slot(5, 23),
            category: 'Raid',
            accentColor: '#22c55e',
            location: { text: 'Event-Voice', channelId: CHANNEL_ID.EVENT_VOICE, channelType: 'voice' },
            // Announced once with a ping for the raid team, with its discussion thread (B-05, B-14)
            announcements: [{
                channelId: CHANNEL_ID.ANNOUNCEMENTS,
                messageId: '130000000000000001',
                intro: `<@&${ROLE_ID.RAID_TEAM}>\nDie Schattenfestung wartet!`
            }],
            discordThread: { guildId: GUILD.id, threadId: '130000000000000002' }
        }),
        [EVENT_ID.BIG_FORM]: buildEvent(clock, {
            title: 'Workshop: Streaming-Setup',
            description: 'Wir richten gemeinsam OBS ein. Das Formular ist zu groß für Discord — Anmeldung nur über die Website.',
            approvalMode: 'manual',
            formFields: WORKSHOP_FORM,
            startDate: clock.slot(10, 18),
            endDate: clock.slot(10, 20),
            category: 'Workshop'
        }),
        [EVENT_ID.RUNNING]: buildEvent(clock, {
            title: 'Live: Speedrun-Marathon',
            description: 'Läuft gerade! Check-in mit dem Code aus dem Stream.',
            maxParticipants: 30,
            startDate: clock.offset(-30 * MINUTE),
            endDate: clock.offset(2 * HOUR),
            category: 'Gaming',
            checkinEnabled: true,
            checkinCode: CHECKIN_CODE,
            checkinMessage: 'Schön, dass du da bist! Viel Spaß beim Marathon.',
            eventStartNotificationSent: true,
            // Its Discord server event runs; „Beenden“ completes it (B-09)
            discordScheduledEventId: '180000000000000002',
            discordScheduledEventStatus: 'active',
            // „Beenden“ takes the role from its accepted members and deletes the channels (B-10)
            assignRoleId: ROLE_ID.EVENT,
            discordChannelId: '190000000000000001',
            discordTextChannelId: '190000000000000002'
        }),
        [EVENT_ID.PAST]: buildEvent(clock, {
            title: 'Retro-Spieleabend',
            description: 'Klassiker aus den 90ern.',
            maxParticipants: 12,
            startDate: clock.slot(-7, 19),
            endDate: clock.slot(-7, 22),
            category: 'Gaming',
            reminderHours: [{ hours: 24, sent: true }],
            checkinEnabled: true,
            checkinCode: '481516',
            eventStartNotificationSent: true,
            createdAt: clock.offset(-21 * DAY),
            // Archived at start a day after its end, then cleaned up: the channels go and
            // Aylin loses the role; Lena and Tom keep it for the running event (B-10)
            assignRoleId: ROLE_ID.EVENT,
            discordChannelId: '190000000000000003',
            discordTextChannelId: '190000000000000004'
        }),
        // Ended three hours ago: over, but archived only a day after its end (W-01)
        [EVENT_ID.ENDED]: buildEvent(clock, {
            title: 'Feierabend-Runde',
            description: 'Ein paar Runden nach der Arbeit.',
            maxParticipants: 8,
            startDate: clock.offset(-6 * HOUR),
            endDate: clock.offset(-3 * HOUR),
            category: 'Community',
            eventStartNotificationSent: true,
            createdAt: clock.offset(-5 * DAY)
        }),
        [EVENT_ID.ARCHIVED]: buildEvent(clock, {
            title: 'Sommerfest',
            description: 'Unser großes Sommerfest mit Turnier und Verlosung.',
            maxParticipants: 50,
            status: 'archived',
            startDate: clock.slot(-60, 16),
            endDate: clock.slot(-60, 23),
            category: 'Community',
            sourcePollId: POLL_ID.DECIDED,
            eventStartNotificationSent: true,
            createdAt: clock.offset(-90 * DAY)
        }),
        [EVENT_ID.DRAFT]: buildEvent(clock, {
            title: 'Entwurf: Halloween-Special',
            description: 'Noch in Planung — Details folgen.',
            status: 'draft',
            startDate: clock.slot(30, 20),
            endDate: clock.slot(30, 23),
            category: 'Community',
            createdAt: clock.offset(-2 * DAY)
        }),
        // Called off two weeks ago -> "Abgesagt" in the history of a profile
        [EVENT_ID.CANCELLED]: buildEvent(clock, {
            title: 'LAN-Abend',
            description: 'Musste ausfallen: Der Raum war doppelt belegt.',
            maxParticipants: 10,
            status: 'cancelled',
            startDate: clock.slot(-14, 18),
            endDate: clock.slot(-14, 23),
            category: 'Gaming',
            createdAt: clock.offset(-28 * DAY)
        })
    };

    const recurringUntil = clock.slot(15, 19).substring(0, 10);
    SERIES_EVENT_IDS.forEach((id, index) => {
        events[id] = buildEvent(clock, {
            title: 'Wöchentliches Training',
            description: 'Jede Woche zur gleichen Zeit: Aufwärmen, Taktik, Trainingsspiele.',
            maxParticipants: 8,
            startDate: clock.slot(1 + index * 7, 19),
            endDate: clock.slot(1 + index * 7, 21),
            category: 'Training',
            seriesId: SERIES_ID,
            recurring: true,
            recurringInterval: 'weekly',
            recurringUntil,
            createdAt: clock.offset(-10 * DAY)
        });
    });

    for (const [id, name] of Object.entries(EVENT_BANNERS)) events[id].bannerUrl = bannerUrl(name);
    return events;
}

const SEEDED_DM_CHOICES = { kira: { changes: false }, jonas: { reminders: false } };

function buildUsers(clock) {
    const seeded = [...PERSONAS.filter(persona => !persona.isNewcomer), ...MEMBERS];
    return Object.fromEntries(seeded.map(person => [person.userId, {
        id: person.userId,
        username: person.username,
        displayName: person.displayName,
        avatar: defaultAvatar(person.userId),
        // Dennis turned invitations off -> he must not show up in the guest search
        acceptInvitations: person.username !== 'dennis',
        // DM choices (W-16): Kira wants no change or cancellation DMs, Jonas no reminders
        ...(SEEDED_DM_CHOICES[person.username] ? { notifications: SEEDED_DM_CHOICES[person.username] } : {}),
        createdAt: clock.offset(-30 * DAY),
        updatedAt: clock.offset(-30 * DAY)
    }]));
}

/**
 * Registration document in the format of utils/registrationService.js.
 */
function buildRegistration(clock, eventId, person, fields = {}) {
    return {
        eventId,
        userId: person.userId,
        userName: person.displayName,
        status: 'accepted',
        formAnswers: {},
        guests: [],
        pendingGuests: [],
        source: 'web',
        createdAt: clock.offset(-3 * DAY),
        ...fields
    };
}

function buildRegistrations(clock) {
    const { mori, lena, tom, neo, kira, jonas, aylin, ben, chiara, dennis, elif, felix, greta } = people;
    const entry = (key, eventId, person, fields) => [`dev-reg-${key}`, buildRegistration(clock, eventId, person, fields)];
    const checkedIn = (checkedInAt) => ({ checkedIn: true, checkedInAt });
    const tournamentAnswers = (name, role, teamRole = '', channel = '') => ({
        'Ingame-Name': name,
        'Bevorzugte Rolle': role,
        'Regeln gelesen': true,
        'Team-Rolle': teamRole,
        'Wunsch-Channel': channel
    });

    return Object.fromEntries([
        // Open event -> Tom is deliberately not registered, so he can try it
        entry('open-lena', EVENT_ID.OPEN, lena, { createdAt: clock.offset(-5 * DAY) }),
        entry('open-kira', EVENT_ID.OPEN, kira, { source: 'discord', createdAt: clock.offset(-4 * DAY) }),
        entry('open-jonas', EVENT_ID.OPEN, jonas, { guests: [greta.userId] }),
        entry('open-aylin', EVENT_ID.OPEN, aylin, {
            pendingGuests: [{ userId: elif.userId, displayName: elif.displayName, avatar: defaultAvatar(elif.userId), status: 'pending' }],
            createdAt: clock.offset(-1 * DAY)
        }),

        // Tournament with form -> one request per status, Lena can fill in the form herself
        entry('form-kira', EVENT_ID.FORM, kira, {
            status: 'pending',
            formAnswers: tournamentAnswers('KiraX', 'Heiler',
                formatEntityAnswer(FORM_FIELD_TYPE.ROLE, 'Raid-Team', ROLE_ID.RAID_TEAM),
                formatEntityAnswer(FORM_FIELD_TYPE.CHANNEL, 'Event-Voice', CHANNEL_ID.EVENT_VOICE)),
            createdAt: clock.offset(-2 * DAY)
        }),
        entry('form-ben', EVENT_ID.FORM, ben, { source: 'discord', formAnswers: tournamentAnswers('BenTheTank', 'Tank'), createdAt: clock.offset(-4 * DAY) }),
        entry('form-felix', EVENT_ID.FORM, felix, { status: 'rejected', formAnswers: tournamentAnswers('Felix99', 'Schaden'), createdAt: clock.offset(-6 * DAY) }),
        // ... and waits for the tournament's approval ("Ausstehend")
        entry('form-tom', EVENT_ID.FORM, tom, { status: 'pending', formAnswers: tournamentAnswers('TomTom', 'Schaden'), createdAt: clock.offset(-1 * DAY) }),

        // Full event -> five accepted, two on the waitlist
        entry('full-lena', EVENT_ID.FULL, lena, { createdAt: clock.offset(-6 * DAY) }),
        entry('full-kira', EVENT_ID.FULL, kira, { createdAt: clock.offset(-5 * DAY) }),
        entry('full-jonas', EVENT_ID.FULL, jonas, { createdAt: clock.offset(-5 * DAY) }),
        entry('full-aylin', EVENT_ID.FULL, aylin, { source: 'discord', createdAt: clock.offset(-4 * DAY) }),
        entry('full-dennis', EVENT_ID.FULL, dennis, { createdAt: clock.offset(-3 * DAY) }),
        entry('full-elif', EVENT_ID.FULL, elif, { status: 'waitlisted', createdAt: clock.offset(-1 * DAY) }),
        entry('full-greta', EVENT_ID.FULL, greta, { status: 'waitlisted', createdAt: clock.offset(-12 * HOUR) }),
        // Tom (member persona) waits for a place, so the overview shows him "Warteliste"
        entry('full-tom', EVENT_ID.FULL, tom, { status: 'waitlisted', createdAt: clock.offset(-6 * HOUR) }),

        // Raid with role slots -> the tank slot is full, Kira plays her fallback role,
        // Felix waits for the tank slot; Lena (raider persona) can still pick a role
        entry('role-ben', EVENT_ID.ROLE, ben, {
            slotId: RAID_SLOT_ID.TANK, preferredSlotId: RAID_SLOT_ID.TANK, altSlotIds: [], createdAt: clock.offset(-4 * DAY)
        }),
        entry('role-kira', EVENT_ID.ROLE, kira, {
            source: 'discord', slotId: RAID_SLOT_ID.HEAL, preferredSlotId: RAID_SLOT_ID.TANK,
            altSlotIds: [RAID_SLOT_ID.HEAL], createdAt: clock.offset(-3 * DAY)
        }),
        entry('role-felix', EVENT_ID.ROLE, felix, {
            status: 'waitlisted', slotId: null, preferredSlotId: RAID_SLOT_ID.TANK, altSlotIds: [], createdAt: clock.offset(-2 * DAY)
        }),

        // Workshop -> web-only form; Neo (newbie persona) is Chiara's guest and must not see her answers
        entry('bigform-chiara', EVENT_ID.BIG_FORM, chiara, {
            status: 'pending',
            guests: [neo.userId],
            formAnswers: {
                'Name': 'Chiara',
                'Streaming-Erfahrung': 'Etwas',
                'Deine Ausrüstung': 'Webcam, USB-Mikrofon, OBS',
                'Welche Plattform nutzt du?': 'Twitch',
                'Mentor-Wunsch': formatEntityAnswer(FORM_FIELD_TYPE.USER, aylin.displayName, aylin.userId),
                'Ansprechpartner': '',
                'Aufzeichnung erlaubt': true
            }
        }),

        // Running event -> Tom is not checked in yet and can use CHECKIN_CODE; he has no Discord check-in
        // invitation yet, so generating a new code shows one in the mock log (B-07). Jonas got his
        // invitation at the start and has not clicked „Einchecken“ yet
        entry('running-tom', EVENT_ID.RUNNING, tom),
        entry('running-lena', EVENT_ID.RUNNING, lena, checkedIn(clock.offset(-20 * MINUTE))),
        entry('running-kira', EVENT_ID.RUNNING, kira, checkedIn(clock.offset(-15 * MINUTE))),
        entry('running-jonas', EVENT_ID.RUNNING, jonas, { checkinInvitedAt: clock.offset(-30 * MINUTE) }),

        // Past event with check-ins
        entry('past-lena', EVENT_ID.PAST, lena, checkedIn(clock.slot(-7, 19))),
        entry('past-tom', EVENT_ID.PAST, tom, checkedIn(clock.slot(-7, 19))),
        entry('past-aylin', EVENT_ID.PAST, aylin, checkedIn(clock.slot(-7, 19))),
        entry('past-jonas', EVENT_ID.PAST, jonas),

        // Archived event
        entry('archived-lena', EVENT_ID.ARCHIVED, lena, { createdAt: clock.offset(-70 * DAY) }),
        entry('archived-tom', EVENT_ID.ARCHIVED, tom, { createdAt: clock.offset(-70 * DAY) }),
        entry('archived-kira', EVENT_ID.ARCHIVED, kira, { createdAt: clock.offset(-68 * DAY) }),

        // Series
        entry('series1-lena', SERIES_EVENT_IDS[0], lena),
        entry('series1-ben', SERIES_EVENT_IDS[0], ben),
        entry('series2-lena', SERIES_EVENT_IDS[1], lena),

        // Profile page: a persona with a slot, one with a rejection, two with a cancelled event
        entry('role-mori', EVENT_ID.ROLE, mori, {
            slotId: RAID_SLOT_ID.DPS, preferredSlotId: RAID_SLOT_ID.DPS, altSlotIds: [], createdAt: clock.offset(-1 * DAY)
        }),
        entry('bigform-tom', EVENT_ID.BIG_FORM, tom, {
            status: 'rejected',
            formAnswers: { 'Name': 'Tom', 'Streaming-Erfahrung': 'Keine', 'Aufzeichnung erlaubt': true },
            createdAt: clock.offset(-2 * DAY)
        }),
        entry('cancelled-lena', EVENT_ID.CANCELLED, lena, { createdAt: clock.offset(-20 * DAY) }),
        entry('cancelled-tom', EVENT_ID.CANCELLED, tom, { createdAt: clock.offset(-20 * DAY) })
    ]);
}

function buildComments(clock) {
    const { mori, lena, kira, jonas, ben } = people;
    const comment = (person, eventId, text, createdAt, replyTo = null, fields = {}) => ({
        eventId,
        userId: person.userId,
        userName: person.displayName,
        userAvatar: defaultAvatar(person.userId),
        text,
        isAdmin: person === mori,
        replyTo,
        createdAt,
        ...fields
    });

    return {
        'dev-comment-open-1': comment(kira, EVENT_ID.OPEN, 'Freu mich schon! Wer bringt die Snacks mit? 🍕', clock.offset(-2 * DAY)),
        'dev-comment-open-2': comment(jonas, EVENT_ID.OPEN, 'Ich bring Chips mit 🍿', clock.offset(-2 * DAY + 2 * HOUR), 'dev-comment-open-1'),
        'dev-comment-open-3': comment(mori, EVENT_ID.OPEN, 'Start ist pünktlich um 19 Uhr, die Lobby ist 15 Minuten vorher offen.', clock.offset(-1 * DAY)),
        'dev-comment-form-1': comment(ben, EVENT_ID.FORM, 'Darf man als Duo antreten oder nur solo?', clock.offset(-3 * DAY)),
        'dev-comment-form-2': comment(mori, EVENT_ID.FORM, 'Nur solo — die Paarungen werden am Turniertag ausgelost.', clock.offset(-3 * DAY + 3 * HOUR), 'dev-comment-form-1'),
        'dev-comment-running-1': comment(lena, EVENT_ID.RUNNING, 'Stream läuft, kommt rein!', clock.offset(-10 * MINUTE)),
        // Raid with discussion thread (B-16): Kira wrote in Discord, Lena answered on the website
        // and her answer was mirrored into the thread
        'dev-comment-role-1': comment(kira, EVENT_ID.ROLE, 'Bringt bitte Tränke mit, der Endboss ist zäh.', clock.offset(-1 * DAY),
            null, { source: 'discord', discordMessageId: '150000000000000101' }),
        'dev-comment-role-2': comment(lena, EVENT_ID.ROLE, 'Ich hab 20 Stück dabei!', clock.offset(-1 * DAY + HOUR),
            'dev-comment-role-1', { source: 'web', discordMessageId: '150000000000000102' })
    };
}

function buildAuditLogs(clock) {
    const entry = (action, details, targetId, daysAgo) => ({
        action,
        adminId: people.mori.userId,
        details,
        targetId,
        timestamp: clock.offset(-daysAgo * DAY)
    });

    return {
        'dev-audit-01': entry('CREATE_EVENT', 'Created event "Community-Spieleabend"', EVENT_ID.OPEN, 14),
        'dev-audit-02': entry('CREATE_EVENT', 'Created event "Turnier: Arena-Cup"', EVENT_ID.FORM, 13),
        'dev-audit-03': entry('UPDATE_EVENT', 'Updated event "Turnier: Arena-Cup"', EVENT_ID.FORM, 12),
        'dev-audit-04': entry('UPDATE_EVENT_STATUS', 'Changed status to archived', EVENT_ID.ARCHIVED, 55),
        'dev-audit-05': entry('UPDATE_REGISTRATION_STATUS', 'Set status to accepted for user Ben', 'dev-reg-form-ben', 3),
        'dev-audit-06': entry('UPDATE_REGISTRATION_STATUS', 'Set status to rejected for user Felix', 'dev-reg-form-felix', 5),
        'dev-audit-07': entry('EXPORT_REGISTRATIONS', `Exported registrations for event ${EVENT_ID.PAST}`, EVENT_ID.PAST, 6),
        'dev-audit-08': entry('UPDATE_TEMPLATES', 'Updated bot message templates', null, 20),
        'dev-audit-09': entry('UPDATE_BOT_SETTINGS', 'Bot-Zentrale Einstellungen aktualisiert', null, 20),
        'dev-audit-10': entry('UPDATE_MAINTENANCE', 'Wartungseinstellungen aktualisiert', null, 15)
    };
}

function buildSettings(clock) {
    return {
        botMessages: {
            templates: {
                registration: '📋 Hey {user.name}, deine Anfrage für **{event.title}** ist eingegangen. Wir melden uns!',
                accepted: '✅ {user.mention}, du bist bei **{event.title}** dabei! Alle Infos: {event.url}',
                rejected: '❌ Leider hat es für **{event.title}** diesmal nicht geklappt.'
            }
        },
        botSettings: {
            config: {
                statusType: 'online',
                activityType: 'WATCHING',
                activityText: '{events.count} Events | Nächstes: {events.next}',
                dmNotifications: true,
                reminderEnabled: true,
                eventStartNotifications: true,
                autoChannelCreation: true,
                autoUpdatePresence: false,
                autoStatusCalendarEvents: false,
                announceChannel: CHANNEL_ID.ANNOUNCEMENTS,
                welcomeMessage: '',
                updatedAt: clock.offset(-20 * DAY)
            }
        },
        maintenanceSettings: {
            config: {
                warningEnabled: false,
                warningText: '',
                loginDisabled: false,
                registrationDisabled: false,
                plannedMaintenance: false,
                plannedMaintenanceStart: '',
                plannedMaintenanceEnd: '',
                plannedMaintenanceText: '',
                panicMode: false,
                panicActivatedAt: '',
                panicActivatedBy: '',
                updatedAt: clock.offset(-15 * DAY),
                updatedBy: people.mori.userId
            }
        }
    };
}

/**
 * Build the complete dummy data set.
 *
 * @param {Date} [now] -> Reference time; all dates are relative to it.
 * @returns {Object} -> `{ [collection]: { [documentId]: data } }`.
 */
function buildPolls(clock) {
    const base = {
        description: '',
        accessMode: 'open',
        requiredRoles: [],
        winnerOptionId: '',
        eventId: '',
        announcements: [],
        createdBy: people.mori.userId
    };
    return {
        // Open -> the raider persona (Lena) has not voted yet and can try it
        [POLL_ID.OPEN]: {
            ...base,
            title: 'Termin für den Herbst-Raid',
            description: 'Wann habt ihr Zeit für **Schattenfestung (heroisch)**?',
            status: 'open',
            accessMode: 'role-required',
            requiredRoles: [ROLE_ID.RAID_TEAM],
            // Own answers instead of passt / wenn nötig / passt nicht
            labels: { yes: 'Bin dabei', maybe: 'Vielleicht', no: 'Kann nicht' },
            options: [
                { id: 'raid-a', startDate: clock.slot(7, 20), endDate: clock.slot(7, 23) },
                { id: 'raid-b', startDate: clock.slot(9, 19), endDate: '' },
                { id: 'raid-c', startDate: clock.slot(12, 20), endDate: '' }
            ],
            deadline: clock.offset(3 * DAY),
            createdAt: clock.offset(-2 * DAY),
            updatedAt: clock.offset(-2 * DAY),
            closedAt: ''
        },
        // Decided -> led to the archived summer party
        [POLL_ID.DECIDED]: {
            ...base,
            title: 'Sommerfest-Termin',
            status: 'decided',
            options: [
                { id: 'summer-1', startDate: clock.slot(-60, 16), endDate: clock.slot(-60, 23) },
                { id: 'summer-2', startDate: clock.slot(-59, 16), endDate: '' }
            ],
            deadline: '',
            winnerOptionId: 'summer-1',
            eventId: EVENT_ID.ARCHIVED,
            createdAt: clock.offset(-95 * DAY),
            updatedAt: clock.offset(-90 * DAY),
            closedAt: clock.offset(-90 * DAY)
        }
    };
}

function buildPollVotes(clock) {
    const { ben, kira, felix, lena, tom } = people;
    const vote = (pollId, person, yes, maybe, daysAgo) => [`${pollId}_${person.userId}`, {
        pollId, userId: person.userId, userName: person.displayName, yes, maybe, updatedAt: clock.offset(-daysAgo * DAY)
    }];
    return Object.fromEntries([
        vote(POLL_ID.OPEN, ben, ['raid-a', 'raid-b'], [], 2),
        vote(POLL_ID.OPEN, kira, ['raid-a'], ['raid-c'], 1),
        vote(POLL_ID.OPEN, felix, ['raid-b'], ['raid-a'], 1),
        vote(POLL_ID.DECIDED, lena, ['summer-1'], [], 93),
        vote(POLL_ID.DECIDED, tom, [], ['summer-1'], 92)
    ]);
}

/** One shared event template for the wizard's "Aus Vorlage starten" (W-10). */
function buildEventTemplates(clock) {
    return {
        'dev-template-raid': {
            name: 'Raid-Abend',
            settings: {
                title: 'Raid-Abend',
                description: 'Wöchentlicher Raid. Bitte 15 Minuten vorher im Voice sein.',
                bannerUrl: '',
                accentColor: '#22c55e',
                category: 'Raid',
                location: { text: 'Event-Voice', channelId: CHANNEL_ID.EVENT_VOICE, channelType: 'voice' },
                maxParticipants: 6,
                accessMode: 'role-required',
                requiredRoles: [ROLE_ID.RAID_TEAM],
                approvalMode: 'manual',
                allowGuests: false,
                slots: [
                    { id: 'tpl-tank', name: 'Tank', emoji: '', capacity: 1 },
                    { id: 'tpl-heal', name: 'Heiler', emoji: '', capacity: 2 },
                    { id: 'tpl-dps', name: 'Schaden', emoji: '', capacity: 3 }
                ],
                assignRoleId: '',
                formFields: [{ label: 'Charaktername', type: 'text', required: true, options: [], description: 'Name deines Charakters im Spiel' }],
                reminderHours: [{ hours: 24 }, { hours: 1 }],
                checkinMessage: '',
                autoCreateChannels: false,
                channelConfig: {},
                customBotMessages: {}
            },
            createdAt: clock.offset(-10 * DAY),
            createdBy: people.mori.userId,
            updatedAt: null,
            updatedBy: null
        },
        // Without slots: /event erstellen prefills title, description and places from it (B-13)
        'dev-template-community': {
            name: 'Community-Abend',
            settings: {
                title: 'Community-Abend',
                description: 'Brettspiele, Quatschen und Snacks im Voice.',
                bannerUrl: '',
                accentColor: '#f59e0b',
                category: 'Community',
                location: null,
                maxParticipants: 12,
                accessMode: 'open',
                requiredRoles: [],
                approvalMode: 'instant',
                allowGuests: true,
                slots: [],
                assignRoleId: '',
                formFields: [],
                reminderHours: [{ hours: 24 }],
                checkinMessage: '',
                autoCreateChannels: false,
                channelConfig: {},
                customBotMessages: {}
            },
            createdAt: clock.offset(-4 * DAY),
            createdBy: people.mori.userId,
            updatedAt: null,
            updatedBy: null
        }
    };
}

function buildSeedData(now = new Date()) {
    const clock = createClock(now);
    return {
        events: buildEvents(clock),
        users: buildUsers(clock),
        registrations: buildRegistrations(clock),
        comments: buildComments(clock),
        auditLogs: buildAuditLogs(clock),
        polls: buildPolls(clock),
        pollVotes: buildPollVotes(clock),
        eventTemplates: buildEventTemplates(clock),
        ...buildSettings(clock)
    };
}

module.exports = { buildSeedData, EVENT_ID, SERIES_EVENT_IDS, CHECKIN_CODE, RAID_SLOT_ID, POLL_ID, EVENT_BANNERS };
