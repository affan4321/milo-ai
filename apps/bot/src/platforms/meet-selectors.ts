/**
 * Everything that depends on Google Meet's page lives here. Meet's markup is obfuscated and changes without notice, so we lean on
 * ARIA labels and visible phrases (the most stable parts) and keep them together. NOT yet verified against a live Meet call:
 * run with BOT_DEBUG=1 on the first real call, read the dumps in <data>/debug, and adjust this file only.
 */
export const S = {
  nameInput: 'input[aria-label="Your name" i], input[placeholder="Your name" i]',
  micOn: '[role="button"][aria-label*="Turn off microphone" i]',
  camOn: '[role="button"][aria-label*="Turn off camera" i]',
  joinButton: /^(ask to join|join now|join anyway|switch here)$/i,
  dismissButton: /^(got it|dismiss|not now|no thanks|continue without microphone and camera)$/i,
  leaveButton: '[role="button"][aria-label*="Leave call" i], button[aria-label*="Leave call" i]',
  captionsOff: '[role="button"][aria-label*="Turn on captions" i]',
  captionsRegion: '[role="region"][aria-label*="aption" i], [aria-label="Captions" i]',
  chatButton: '[role="button"][aria-label*="Chat with everyone" i]',
  chatInput: 'textarea[aria-label*="Send a message" i], textarea[placeholder*="Send a message" i]',
  chatSend: '[role="button"][aria-label*="Send a message" i], button[aria-label*="Send a message" i]',
  chatMessage: '[data-message-id]',
  peopleButton: '[role="button"][aria-label*="Show everyone" i], [role="button"][aria-label*="People" i]',
  participantTile: '[data-participant-id]',
  captcha: 'iframe[src*="recaptcha" i], iframe[title*="recaptcha" i]',
} as const;

/** Visible phrases, most specific first. */
export const TEXT = {
  waiting: /asking to be let in|someone will let you in soon|waiting for the host|waiting for someone to let you in/i,
  denied: /denied your request|request to join was denied|someone in the meeting denied/i,
  guestsBlocked: /you can.t join this (video )?call|isn.t allowed to join|can.t be joined by guests|only (people|users) (in|from) .* can join/i,
  signIn: /sign in to join|choose an account|you need to sign in/i,
  captcha: /not a robot|verify you.re human|unusual traffic/i,
  badLink: /check your meeting code|invalid video call name|meeting code .* (isn.t|is not) valid|couldn.t find (that|the) meeting/i,
  removed: /you.ve been removed from the meeting|you were removed from the meeting|removed you from the meeting/i,
  ended: /you left the meeting|the meeting has ended|this call has ended|return to home screen|you.ve left the call|call ended/i,
} as const;
