import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { getDb, users, preferences } from "@milo/db";
import { saveGoogleConnection, syncConnection } from "@milo/calendar";

const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"].join(" ");

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
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
      if (account?.provider !== "google" || !profile?.email) return false;
      if (profile.email_verified === false) return false;
      const db = getDb();
      const email = profile.email.toLowerCase();
      let [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user) {
        [user] = await db.insert(users).values({ email, name: profile.name ?? null, image: (profile.picture as string | undefined) ?? null }).returning();
        await db.insert(preferences).values({ userId: user!.id }).onConflictDoNothing();
      }
      const connId = await saveGoogleConnection(db, user!.id, account.refresh_token);
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
