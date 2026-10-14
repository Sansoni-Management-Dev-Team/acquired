import "server-only";
import { and, eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { requireDb } from "@/db/client";
import * as schema from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/transactional-email";

const authentication = betterAuth({
  baseURL: process.env.APP_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(requireDb(), { provider: "pg", schema }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_GMAIL_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => sendPasswordResetEmail({ to: user.email, name: user.name, url }),
  },
  plugins: [organization({ allowUserToCreateOrganization: true, requireEmailVerificationOnInvitation: true })],
});

// Better Auth authenticates the session. Acquire additionally authorizes its
// active workspace against current membership, including other stale sessions.
export const auth = {
  ...authentication,
  api: {
    ...authentication.api,
    async getSession(input: { headers: Headers }) {
      const result = await authentication.api.getSession(input);
      const organizationId = result?.session.activeOrganizationId;
      if (!result || !organizationId) return result;
      try {
        const [membership] = await requireDb().select({ id: schema.member.id }).from(schema.member)
          .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, result.user.id))).limit(1);
        return membership ? result : null;
      } catch { return null; }
    },
  },
};
