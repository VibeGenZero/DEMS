/**
 * Shared cases for the participant message (W-09): utils/participantMessage.js
 * builds the DM, its browser twin in public/js/admin/participant-message.js
 * the preview. Both must give the same text for the same input.
 */
const URL = 'https://dems.example/#event/ev1';

// [description, input, expected DM text]
const PARTICIPANT_MESSAGE_CASES = [
    [
        'one line',
        { title: 'Raid: Schattenfestung', text: 'Treffpunkt ist heute Tor 2.', sender: 'Mori', url: URL },
        '📣 **Nachricht zum Event „Raid: Schattenfestung“**\n\nTreffpunkt ist heute Tor 2.\n\n— Mori · Alle Infos: https://dems.example/#event/ev1'
    ],
    [
        'line breaks and markdown stay as typed',
        { title: 'Spieleabend', text: 'Hallo zusammen,\n\n**bitte** Headset mitbringen!\n- Snacks\n- Getränke', sender: 'Lena', url: URL },
        '📣 **Nachricht zum Event „Spieleabend“**\n\nHallo zusammen,\n\n**bitte** Headset mitbringen!\n- Snacks\n- Getränke\n\n— Lena · Alle Infos: https://dems.example/#event/ev1'
    ],
    [
        'text is trimmed, inner spaces stay',
        { title: 'Turnier', text: '   Start   um 20 Uhr  \n', sender: 'Mori (Admin)', url: URL },
        '📣 **Nachricht zum Event „Turnier“**\n\nStart   um 20 Uhr\n\n— Mori (Admin) · Alle Infos: https://dems.example/#event/ev1'
    ]
];

module.exports = { PARTICIPANT_MESSAGE_CASES, URL };
