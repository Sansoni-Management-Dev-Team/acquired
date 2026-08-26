import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { requireDb } from "@/db/client";
import * as schema from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/transactional-email";

export const auth = betterAuth({
  baseURL: process.env.APP_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(requireDb(), { provider: "pg", schema }),
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
