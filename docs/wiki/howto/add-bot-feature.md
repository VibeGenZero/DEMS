---
id: add-bot-feature
title: How to add a bot feature (helper, command, button)
type: howto
tags: [howto, discord, bot, slash-command, button, dm, mock]
sources: [bot.js, dev/mockBot.js, test/mockBot.test.js]
depends_on: [bot, discord-integration, dev-mock-mode]
see_also: [reminders-presence, add-api-endpoint]
---
# How to add a bot feature (helper, command, button)

> TL;DR: Discord-facing helpers live in `bot.js`, guarded by `isReady` and `try/catch`, are exported, and get a logging twin in `dev/mockBot.js` so mock mode and tests work. Slash commands are added in `registerSlashCommands` and handled in the `interactionCreate` dispatcher; buttons/modals use a prefixed custom id constant.

## A) New helper called from routes

1. `bot.js`:
   ```js
   /**
    * <What it does in Discord>.
    *
    * @param {string} userId -> Discord user id.
    * @returns {Promise<boolean>} -> True on success.
    */
   async function pingUser(userId) {
       if (!isReady) return false;
       try {
           // discord.js calls
           return true;
       } catch (err) {
           console.error('Failed to ping user:', err.message);
           return false;
       }
   }
   ```
2. Add it to `module.exports` (before the mock override line at the end).
3. `dev/mockBot.js`: same signature and return shape, log with `mockLog('…', details)`; add it to its `module.exports`.
4. `test/mockBot.test.js`: assert the mock's return value through `require('../bot')`.

## B) Slash command

1. `registerSlashCommands`: add a `new SlashCommandBuilder()...` (German description). Commands are guild-scoped and re-registered on every ready.
2. Dispatcher (`client.on('interactionCreate'`): handle `interaction.commandName === '<name>'` in the chat-input part (and the autocomplete part if needed). Increment nothing else; `commandsProcessedCount` is counted centrally.
3. Reply with `flags: MessageFlags.Ephemeral` for private answers.

## C) Button / modal

1. Constant `const MY_PREFIX = 'my_action';` next to `REGISTER_BUTTON_PREFIX`.
2. Custom id `${MY_PREFIX}:<id>`; parse with `interaction.customId.split(':')` in the button/modal branch of the dispatcher.
3. Wrap the handler in `try/catch`; on error `editReply` (if deferred) or `reply` with a German message.

## Rules

- User-facing text in German; templates through `parseTemplate(template, vars)`.
- Need another gateway intent? Add it to the `Client` options AND enable it in the developer portal if privileged.
- Internal calls between bot functions bypass the mock — keep logic that should be simulated in exported helpers.
