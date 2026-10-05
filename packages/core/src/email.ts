export const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
]);
export const emailDomain = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";
export const isPersonalEmail = (email: string) => PERSONAL_DOMAINS.has(emailDomain(email));
