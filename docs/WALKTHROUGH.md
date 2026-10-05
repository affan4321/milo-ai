# Milo walkthrough

A guided tour for a first-time reviewer, in the order a real user meets things. Each step names what to look for.

1. **Sign in and onboard.** Google (or Microsoft) sign-in, then connect a calendar or paste an ICS link, choose which calls to
   record and share, and confirm the consent notice. Home then lists real upcoming events with a "Milo will record" switch.
2. **Send Milo to a call.** Home → "Send Milo to a meeting", paste a Meet, Zoom or Teams link (or let auto-record do it). The card
   shows plain-language states: joining, waiting to be admitted, recording, processing, ready. The bot posts a consent message in chat.
3. **Talk, then `/milo highlight`.** Type it in the meeting chat while talking; the highlight covers the 30 seconds before.
4. **Open the finished meeting.** Transcript follows playback; click a line to seek; speakers carry real names (rename applies
   everywhere). Switch summary templates, tick action items and jump to their source moment, browse chapters.
5. **Clip and share.** Turn a highlight into a clip; open the public link in a private window with no sign-in.
6. **Search and Ask.** Search a phrase from two meetings: both hits land on the right timestamp. Ask Milo a cross-meeting
   question: answers cite numbered moments that open the right second. Chats are saved; start a new one or edit a message.
7. **Team, playlists, alerts.** Team Calls shows teammates' shared meetings; add meetings to a playlist; create an alert for a
   phrase and see hits. After processing, a recap email goes to the owner and chosen attendees (in dev it appears in `.data/outbox`).
8. **Settings and theme.** Preferences auto-save. The sidebar "Theme" switch cycles system, light and dark.
9. **Failure behaviour.** Stop the bot: upload still works. Stop the worker: browsing, playback and search still work. When the
   AI is over its quota the summary shows a clear "retrying" state while transcript and playback remain usable.

What is not verified live: Teams and Zoom joining (selectors), Microsoft sign-in, and real email delivery.
