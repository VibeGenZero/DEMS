'use strict';

/**
 * The text the member assistant sees about one event: plain labelled sections
 * built only from data the asking member may see. Pure: everything it needs
 * is passed in, the loading lives in memberAssistant.js.
 *
 * Never included: the check-in code, Discord ids (users, roles, channels),
 * names or form answers of other members, the asker's name or id.
 */
const { describePlaces } = require('../utils/capacity');
const { getSlots, buildSlotSummary, findSlot, formatSlotLabel } = require('../utils/slotService');

/** Section names the model may cite as `Quelle: <name>`. */
const SOURCE_SECTIONS = ['Beschreibung', 'Teilnahmebedingungen', 'Termin', 'Plätze', 'Formular', 'Zusatzinfos'];

const FIELD_TYPES = {
    text: 'Text', textarea: 'Langtext', dropdown: 'Auswahl', checkbox: 'Ankreuzfeld',
    user: 'Mitglied', role: 'Rolle', channel: 'Kanal', mentionable: 'Mitglied oder Rolle'
};

const STATUS_TEXT = {
    pending: 'Deine Anmeldung ist eingegangen und wartet auf die Bestätigung durch die Orga.',
    accepted: 'Du bist angemeldet und bestätigt.',
    waitlisted: 'Du stehst auf der Warteliste.',
    offered: 'Dir wurde ein frei gewordener Platz angeboten, den du noch bestätigen musst.',
    tentative: 'Du hast mit „Vielleicht“ geantwortet und stehst auf der Ersatzbank ohne festen Platz.',
    rejected: 'Deine Anmeldung wurde abgelehnt.'
};

const countOf = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** `Samstag, 21.11.2026, 20:00 Uhr` in a time zone; empty for a missing or broken value. */
function formatDateTime(value, timezone) {
    const date = value instanceof Date ? value : new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('de-DE', {
        timeZone: timezone, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.weekday}, ${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute} Uhr`;
}

/** Names of required roles; a role the guild does not report is "eine bestimmte Rolle" (never its id). */
function roleList(roleIds, roleNames) {
    return (roleIds || []).map(id => (roleNames && roleNames[id]) || 'eine bestimmte Rolle').join(', ');
}

function termin(event, timezone) {
    const lines = [];
    if (event.title) lines.push(`Titel: ${event.title}`);
    if (event.category) lines.push(`Kategorie: ${event.category}`);
    for (const [label, value] of [
        ['Beginn', event.startDate], ['Ende', event.endDate],
        ['Anmeldeschluss', event.registrationDeadline], ['Abmeldeschluss', event.unregisterDeadline]
    ]) {
        const text = formatDateTime(value, timezone);
        if (text) lines.push(`${label}: ${text}`);
    }
    if (event.location) lines.push(`Ort: ${event.location}`);
    return lines;
}

function conditions(event, roleNames) {
    const lines = [];
    const roles = Array.isArray(event.requiredRoles) ? event.requiredRoles : [];
    if (event.accessMode === 'role-required' && roles.length) {
        lines.push(`Zugang: nur mit mindestens einer dieser Rollen: ${roleList(roles, roleNames)}`);
    } else {
        lines.push('Zugang: offen für alle Mitglieder');
    }
    lines.push(event.approvalMode === 'manual'
        ? 'Anmeldungen werden von der Orga bestätigt.'
        : 'Anmeldungen sind sofort bestätigt, solange Plätze frei sind.');
    lines.push(event.allowGuests !== false && !getSlots(event).length
        ? 'Gäste dürfen mitgebracht werden und belegen jeweils einen Platz.'
        : 'Gäste sind nicht erlaubt.');
    lines.push(event.allowTentative === true ? '„Vielleicht“ ist als Antwort möglich.' : '„Vielleicht“ ist nicht möglich.');
    return lines;
}

function places(event, registrations) {
    const info = describePlaces(registrations, Number(event.maxParticipants) || 0);
    const lines = [info.text];
    if (info.capacity > 0) lines.push(`${Math.max(info.capacity - info.taken, 0)} frei`);
    for (const note of [info.waitlistText, info.benchText]) if (note) lines.push(note);
    const slots = getSlots(event);
    if (slots.length) {
        lines.push('Rollen:');
        for (const slot of buildSlotSummary(slots, registrations)) {
            lines.push(`- ${formatSlotLabel(slot)}: ${slot.taken} von ${slot.capacity} belegt, ${Math.max(slot.capacity - slot.taken, 0)} frei`);
        }
    }
    return lines;
}

function form(event) {
    return (Array.isArray(event.formFields) ? event.formFields : []).map(field => {
        const options = Array.isArray(field.options) && field.options.length ? `, Optionen: ${field.options.join(' / ')}` : '';
        const hint = field.description ? ` – ${field.description}` : '';
        return `- ${field.label} (${FIELD_TYPES[field.type] || 'Text'}, ${field.required ? 'Pflicht' : 'freiwillig'}${options})${hint}`;
    });
}

function askerStatus(event, asker, roleNames) {
    const lines = [];
    const { registration, roleIds = [], waitlistPlace } = asker || {};
    if (!registration) {
        lines.push('Du bist für dieses Event nicht angemeldet.');
    } else {
        let text = STATUS_TEXT[registration.status] || 'Du hast dich für dieses Event angemeldet.';
        if (registration.status === 'waitlisted' && waitlistPlace) text = `Du stehst auf der Warteliste (Platz ${waitlistPlace}).`;
        lines.push(text);
        const slot = registration.slotId ? findSlot(getSlots(event), registration.slotId) : null;
        if (slot) lines.push(`Deine Rolle: ${formatSlotLabel(slot)}`);
    }
    const required = Array.isArray(event.requiredRoles) ? event.requiredRoles : [];
    if (event.accessMode === 'role-required' && required.length) {
        const holds = required.some(id => roleIds.includes(id));
        lines.push(holds
            ? 'Du hast eine der nötigen Rollen.'
            : `Du hast keine der nötigen Rollen (${roleList(required, roleNames)}).`);
    }
    return lines;
}

/**
 * Event context for the member assistant.
 *
 * @param {Object} params
 * @param {Object} params.event -> Event document data.
 * @param {string} params.eventId -> Event id (not written into the text).
 * @param {Array<Object>} params.registrations -> All registrations of the event; used for counts only.
 * @param {Object<string,string>} params.roleNames -> `{ [roleId]: name }`.
 * @param {{ registration: Object|null, roleIds: string[], waitlistPlace: number|null }} params.asker
 * @param {Date} params.now
 * @param {string} params.timezone -> IANA time zone for every written date-time.
 * @returns {string} -> Labelled sections, empty ones left out.
 */
function buildEventContext({ event, registrations = [], roleNames = {}, asker, now = new Date(), timezone }) {
    const sections = [
        ['Termin', termin(event, timezone)],
        ['Beschreibung', event.description ? [String(event.description).trim()] : []],
        ['Teilnahmebedingungen', conditions(event, roleNames)],
        ['Plätze', places(event, registrations)],
        ['Formular', form(event)],
        ['Zusatzinfos', event.aiNotes ? [String(event.aiNotes).trim()] : []],
        ['Dein Status', askerStatus(event, asker, roleNames)]
    ];
    const body = sections
        .filter(([, lines]) => lines.length > 0 && lines.join('').trim() !== '')
        .map(([name, lines]) => `${name}\n${lines.join('\n')}`);
    return [`Heute ist ${formatDateTime(now, timezone)}.`, ...body].join('\n\n');
}

/**
 * Cut the trailing `Quelle: <section>` line off an answer.
 *
 * @param {string} text -> Raw answer.
 * @returns {{ text: string, source: string }} -> Answer without the line; `source` only for a known section.
 */
function splitSource(text) {
    const raw = String(text || '').trimEnd();
    const cut = raw.lastIndexOf('\n') + 1;
    const match = raw.slice(cut).match(/^\s*Quelle:\s*(.*?)\s*$/);
    if (!match) return { text: raw.trim(), source: '' };
    return {
        text: raw.slice(0, cut).trim(),
        source: SOURCE_SECTIONS.includes(match[1]) ? match[1] : ''
    };
}

module.exports = { buildEventContext, splitSource, SOURCE_SECTIONS, formatDateTime };
