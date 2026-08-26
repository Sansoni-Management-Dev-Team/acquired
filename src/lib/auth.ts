import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { requireDb } from "@/db/client";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  baseURL: process.env.APP_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(requireDb(), { provider: "pg", schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  advanced: { database: { joins: true } },
  plugins: [organization({ allowUserToCreateOrganization: true, requireEmailVerificationOnInvitation: true })],
});
