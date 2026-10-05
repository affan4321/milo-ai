/**
 * Everything that depends on Zoom's web client lives here. NOT yet verified against a live Zoom call: Zoom's markup uses stable-ish
 * class names and aria-labels, which we lean on together with visible phrases. Run with BOT_DEBUG=1 on the first real call, read the
 * dumps in <data>/debug and adjust this file only. The bot joins as a named guest through the browser; hosts can disable that.
 */
export const S = {
  nameInput: '#input-for-name, input[placeholder*="name" i]',
  passcodeInput: '#input-for-pwd, input[type="password"]',
  joinButton: /^(join|join meeting)$/i,
  dismissButton: /^(got it|dismiss|not now|no thanks|ok|accept|continue|i agree)$/i,
  joinAudio: /^(join audio by computer|join with computer audio|computer audio)$/i,
  muteButton: 'button[aria-label="mute my microphone" i], button[aria-label="Mute" i]',
  stopVideoButton: 'button[aria-label="stop my video" i], button[aria-label="Stop Video" i]',
  leaveButton: 'button[aria-label="Leave" i], button.footer__leave-btn, button[aria-label*="leave" i]',
  leaveConfirm: /^(leave meeting|leave)$/i,
  chatButton: 'button[aria-label*="open the chat panel" i], button[aria-label^="chat" i], button[aria-label*="Chat" i]',
  chatInput: 'div[contenteditable="true"][aria-label*="message" i], textarea[aria-label*="message" i], textarea.chat-box__chat-textarea, #chat-input, div.chat-rtf-box__editor-outer [contenteditable="true"]',
  chatMessage: '.chat-message__text-box, [class*="chat-item__chat-info"], [class*="new-chat-message__container"]',
  chatSender: '[class*="chat-item__sender"], [class*="new-chat-message__sender"], [class*="sender"]',
  chatBody: '[class*="chat-message__text-content"], [class*="new-chat-message__text-content"], [class*="chat-message__text"]',
  // The tile Zoom outlines for whoever is speaking, and the name label inside it.
  activeSpeaker: '.speaker-active-container__video-frame, .speaker-bar-container__video-frame--active, [class*="video-avatar__avatar"][class*="active"]',
  speakerName: '.video-avatar__avatar-name, .video-avatar__avatar-footer span, [class*="avatar-name"], [class*="avatar-footer"]',
  participantsButton: 'button[aria-label*="participants" i]',
  participantRow: '.participants-item__item-layout, [role="listitem"][class*="participants-item"]',
  participantName: '.participants-item__display-name, [class*="display-name"]',
  participantCounter: '.footer-button__number-counter, [class*="number-counter"]',
  captcha: 'iframe[src*="recaptcha" i], iframe[title*="recaptcha" i]',
} as const;

/** Visible phrases, most specific first. */
export const TEXT = {
  waiting: /please wait,? the meeting host will let you in soon|the meeting host will let you in soon|waiting for the host to (start|let)|host will let you in|waiting room/i,
  denied: /the host (has )?denied your request|your request to join was (denied|declined)/i,
  guestsBlocked: /authorized attendees only|only authenticated users|sign in to join|this meeting is for (authorized|authenticated)|joining from (a )?browser is (disabled|not allowed)|host disabled.*browser|can.t join .* from (a |your )?browser/i,
  captcha: /not a robot|verify you.re human|unusual traffic/i,
  badLink: /invalid meeting id|meeting id (is )?(not valid|invalid)|this meeting link is invalid|meeting does not exist|invalid passcode|incorrect passcode|wrong passcode/i,
  alone: /you.re the only one here|you are the only one in this meeting|no one else is in this meeting/i,
  removed: /you have been removed from this meeting|the host (has )?removed you|removed you from the meeting/i,
  ended: /this meeting has been ended by (the )?host|the meeting (has )?ended|meeting is ended|you have left the meeting|you.ve left the meeting|this meeting has ended/i,
} as const;
