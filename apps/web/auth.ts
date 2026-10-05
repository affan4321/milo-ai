import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { eq } from "drizzle-orm";
import { getDb, users, preferences } from "@milo/db";
import { saveOAuthConnection, syncConnection } from "@milo/calendar";
import { microsoftIdentity } from "@/lib/auth-rules";

const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"].join(" ");

const MS_SCOPES = ["openid", "profile", "email", "offline_access", "https://graph.microsoft.com/Calendars.Read"].join(" ");
export const microsoftEnabled = !!(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // Microsoft is added only when its app registration is configured, so the sign-in page never offers a button that can't work.
    ...(microsoftEnabled ? [MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID, clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID || "common"}/v2.0`,
      authorization: { params: { scope: MS_SCOPES } },
    })] : []),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // offline + consent so Google returns a refresh token every time (needed for background calendar sync)
      authorization: { params: { scope: SCOPES, access_type: "offline", prompt: "consent" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  trustHost: true,
  callbacks: {
    async signIn({ account, profile }) {
      if (!account || !profile) return false;
      let email: string, name: string | null, image: string | null = null, kind: "google" | "microsoft";
      if (account.provider === "google") {
        if (!profile.email || profile.email_verified === false) return false;
        email = profile.email.toLowerCase(); name = profile.name ?? null; image = (profile.picture as string | undefined) ?? null; kind = "google";
      } else if (account.provider === "microsoft-entra-id") {
        const id = microsoftIdentity(profile as Record<string, unknown>);
        if ("error" in id) { console.warn(`[auth] Microsoft sign-in refused: ${id.error}`); return false; }
        email = id.email; name = id.name; kind = "microsoft";
      } else return false;
      const db = getDb();
      let [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user) {
        [user] = await db.insert(users).values({ email, name, image }).returning();
        await db.insert(preferences).values({ userId: user!.id }).onConflictDoNothing();
      }
      const connId = await saveOAuthConnection(db, user!.id, kind, account.refresh_token);
      if (connId) void syncConnection(db, connId).catch(() => {}); // first sync in the background; failures land on the connection
      return true;
    },
    async jwt({ token }) {
      if (token.email && !token.uid) {
        const [u] = await getDb().select().from(users).where(eq(users.email, token.email.toLowerCase()));
        if (u) token.uid = u.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) (session.user as { id?: string }).id = token.uid as string;
      return session;
    },
  },
});
