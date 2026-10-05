/** Microsoft's own tenant id for personal (consumer) accounts such as outlook.com, whose email addresses Microsoft verifies. */
export const MSA_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

/**
 * Decide whether a Microsoft sign-in may be trusted as "this person owns this email". Milo identifies people by email, and an
 * Entra tenant admin can put ANY address in the `email` claim, which would let them sign in as someone else. So we require either
 * a personal Microsoft account, or the `xms_edov` ("email domain owner verified") claim, which an app registration can enable.
 */
export function microsoftIdentity(profile: Record<string, unknown>): { email: string; name: string | null } | { error: string } {
  const raw = (profile.email ?? profile.preferred_username) as unknown;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Microsoft didn't share an email address for this account." };
  const verified = profile.xms_edov === true || profile.xms_edov === "1" || profile.xms_edov === 1 || profile.tid === MSA_TENANT;
  if (!verified) return { error: "Microsoft hasn't confirmed that you own this email address. Ask your admin to enable the optional claim xms_edov for Milo, or sign in with Google." };
  return { email, name: typeof profile.name === "string" ? profile.name : null };
}
