import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const googleConfigured =
  Boolean(process.env.AUTH_GOOGLE_ID) &&
  Boolean(process.env.AUTH_GOOGLE_SECRET);

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: googleConfigured
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID!,
          clientSecret: process.env.AUTH_GOOGLE_SECRET!,
        }),
      ]
    : [],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized: ({ auth: session, request: { nextUrl } }) => {
      if (nextUrl.pathname.startsWith("/dashboard")) {
        return !!session?.user;
      }
      return true;
    },
  },
});
