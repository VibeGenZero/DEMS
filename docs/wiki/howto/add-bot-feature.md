---
id: add-bot-feature
title: How to add a bot feature (helper, command, button)
type: howto
tags: [howto, discord, bot, slash-command, button, dm, mock]
sources: [bot.js, bot, dev/mockBot.js, test/mockBot.test.js, test/botModules.test.js]
depends_on: [bot, discord-integration, dev-mock-mode]
see_also: [reminders-presence, add-api-endpoint]
---
# How to add a bot feature (helper, command, button)

> TL;DR: Discord-facing helpers live in the area module of `bot/` (table in [bot](../modules/bot.md)), guarded by `state.isReady` and `try/catch`, and are exported through `bot.js`; each gets a logging twin in `dev/mockBot.js` so mock mode and tests work. Slash commands go into `bot/commands.js`, buttons/modals into the module of their area with a prefixed custom id constant in `bot/constants.js` and one routing line in `bot/interactions.js`.

## A) New helper called from routes

1. The area module in `bot/` (messages, guild, channels, …; a new area gets its own file, every file ≤ 500 lines — `test/botModules.test.js` checks it):
   ```js
   /**
    * <What it does in Discord>.
    *
    * @param {string} userId -> Discord user id.
    * @returns {Promise<boolean>} -> True on success.
    */
   async function pingUser(userId) {
       if (!state.isReady) return false;
       try {
           // discord.js calls
           return true;
       } catch (err) {
           console.error('Failed to ping user:', err.message);
           return false;
       }
   }
   ```
   Import `client` and `state` from `./client`; add the function to the module's `module.exports`.
2. `bot.js`: import it from the module and add it to `module.exports` (before the mock override line at the end). Pin the new name in the export list of `test/botModules.test.js`.
3. `dev/mockBot.js`: same signature and return shape, log with `mockLog('…', details)`; add it to its `module.exports`.
4. `test/mockBot.test.js`: assert the mock's return value through `require('../bot')`; `test/botRealExports.test.js`: assert the neutral value of the real helper while the bot is not ready.

## B) Slash command

1. `bot/commands.js` → `registerSlashCommands`: add a `new SlashCommandBuilder()...` (German description). Commands are guild-scoped and re-registered on every ready.
2. `bot/commands.js` → `handleChatCommand`: handle `interaction.commandName === '<name>'` (and `handleAutocomplete` if needed). Count nothing; `state.commandsProcessed` is counted centrally in `handleInteraction`.
3. Reply with `flags: MessageFlags.Ephemeral` for private answers.

## C) Button / modal

1. Constant `const MY_PREFIX = 'my_action';` in `bot/constants.js` next to `REGISTER_BUTTON_PREFIX`.
2. Handler in the module of the area (e.g. `handleMyButton(interaction, id)` in `bot/registration.js`); custom id `${MY_PREFIX}:<id>`.
3. `bot/interactions.js` → `handleInteraction`: parse with `interaction.customId.split(':')` in the button/modal/select branch and call the handler, wrapped in `try/catch`; on error `editReply` (if deferred) or `reply` with a German message.

## Rules

- User-facing text in German; templates through `parseTemplate(template, vars)`.
- Need another gateway intent? Add it to the `Client` options in `bot/client.js` AND enable it in the developer portal if privileged.
- Modules in `bot/` require each other, never `../bot` (the facade); code outside the bot requires only `bot.js`. Both are checked by `test/botModules.test.js`.
- Calls between bot modules bypass the mock — keep logic that should be simulated in exported helpers.
- Keep requires of `utils/registrationService`, `utils/eventUtils`, `utils/pollStore` and `utils/announcementRefresh` inside functions: those utils require `bot.js` at load time.
