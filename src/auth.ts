import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getUserByEmail } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";
import type { UserRole } from "@/lib/auth/users";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      repId: string | null;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = String(creds?.email ?? "").toLowerCase().trim();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        const user = await getUserByEmail(email);
        if (!user || !verifyPassword(password, user.passwordHash)) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          repId: user.repId,
        };
      },
    }),
  ],
  callbacks: {
    // Persist id/role/repId on the token at sign-in. (Role changes take effect on
    // next sign-in; sensitive API routes re-check the live DB role for security.)
    jwt: ({ token, user }) => {
      if (user) {
        token.uid = (user as { id: string }).id;
        token.role = (user as { role: UserRole }).role;
        token.repId = (user as { repId: string | null }).repId;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = (token.role as UserRole) ?? "none";
        session.user.repId = (token.repId as string | null) ?? null;
      }
      return session;
    },
  },
});
