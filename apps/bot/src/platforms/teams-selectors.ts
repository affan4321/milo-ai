/**
 * Everything that depends on Microsoft Teams' web client lives here. NOT yet verified against a live Teams call: Teams uses
 * `data-tid` attributes (more stable than class names) and visible phrases. Run with BOT_DEBUG=1 on the first real call, read the
 * dumps in <data>/debug and adjust this file only. The bot joins as an anonymous guest; tenants can disable that.
 */
export const S = {
  // Launcher page ("How do you want to join?") that offers the desktop app. We always pick the browser.
  joinOnWeb: /^(continue on this browser|join on the web instead|use the web app instead)$/i,
  nameInput: 'input[data-tid="prejoin-display-name-input"], input[placeholder*="name" i]',
  micToggle: '[role="checkbox"][aria-label*="microphone" i][aria-checked="true"], [role="switch"][aria-label*="microphone" i][aria-checked="true"], [data-tid="toggle-mute"][aria-checked="true"]',
  camToggle: '[role="checkbox"][aria-label*="camera" i][aria-checked="true"], [role="switch"][aria-label*="camera" i][aria-checked="true"], [data-tid="toggle-video"][aria-checked="true"]',
  joinButton: /^(join now|join)$/i,
  dismissButton: /^(got it|dismiss|not now|no thanks|continue without audio or video|continue)$/i,
  leaveButton: '[data-tid="hangup-button"], button[aria-label^="Leave" i], [role="button"][aria-label^="Leave" i]',
  moreButton: '[data-tid="more-button"], button[aria-label="More" i], button[aria-label^="More actions" i]',
  captionsMenu: /^(language and speech|captions)$/i,
  captionsOn: /^(turn on live captions|live captions)$/i,
  captionsRegion: '[data-tid="closed-caption-renderer-wrapper"], [data-tid="closed-captions-v2-items-renderer"]',
  captionAuthor: '[data-tid="author"]',
  captionText: '[data-tid="closed-caption-text"]',
  chatButton: '[data-tid="chat-button"], button[aria-label^="Chat" i], [role="button"][aria-label^="Chat" i]',
  chatInput: '[data-tid="ckeditor"][contenteditable="true"], div[role="textbox"][contenteditable="true"]',
  chatSend: '[data-tid="newMessageCommands-send"], button[aria-label="Send" i]',
  chatMessage: '[data-tid="chat-pane-message"], [data-tid="message-body"]',
  chatAuthor: '[data-tid="message-author-name"]',
  chatBody: '[data-tid="chat-pane-message"] [id^="content-"], [data-tid="message-body"] [data-tid="chat-message-content"]',
  peopleButton: '[data-tid="roster-button"], button[aria-label="People" i], [role="button"][aria-label="People" i]',
  rosterItem: '[data-tid="roster-list"] [role="treeitem"], [data-tid="participants-list"] [role="listitem"]',
  rosterCount: '[data-tid="roster-title-section"], [data-tid="participants-header"]',
} as const;

/** Visible phrases, most specific first. */
export const TEXT = {
  waiting: /someone in the meeting should let you in soon|waiting for (people|someone) to let you in|when the meeting starts, we.ll let people know you.re waiting|we.ve let people in the meeting know you.re waiting/i,
  denied: /denied your request|your request to join was declined|you were not let in|the organizer declined/i,
  guestsBlocked: /anonymous users? can.t join|only (people|users) (in|from) .* can join|sign in to join|your organi[sz]ation (doesn.t|does not) allow|you need to sign in to join this meeting/i,
  captcha: /not a robot|verify you.re human|unusual traffic/i,
  badLink: /meeting (link|id) .* (isn.t|is not) valid|we couldn.t find (that|the) meeting|this meeting (link )?(has expired|doesn.t exist)|invalid meeting link/i,
  alone: /you.re the only one here|you.re the only person here|no one else is here/i,
  removed: /you.ve been removed from (this|the) meeting|removed you from (this|the) meeting|the organizer removed you/i,
  ended: /you left the meeting|the meeting has ended|you.ve left the meeting|this meeting has ended|rejoin|call ended/i,
} as const;
