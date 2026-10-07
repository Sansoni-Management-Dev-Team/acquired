import React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
vi.mock("./client", () => ({ requireDb: vi.fn() }));
import { FirmableClient } from "@/adapters/firmable-client";
import { contactCompleteness } from "@/domain/contact-completeness";
import { CompanyContactsTable } from "@/components/company-contacts-table";
import { upsertFirmableContact } from "./firmable-contacts";
import * as schema from "./schema";

describe.skipIf(process.env.RUN_FIRMABLE_DB_INTEGRATION !== "true")("RC-13/14 PostgreSQL contact completeness", () => {
  let client: Client;
  let database: NodePgDatabase<typeof schema>;
  let organizationId: string, targetId: string;
  beforeAll(async () => {
    const url = process.env.FIRMABLE_INTEGRATION_DATABASE_URL;
    if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw Error("Explicit local PostgreSQL URL required");
    client = new Client({ connectionString: url });
    await client.connect(); await client.query("BEGIN");
    database = drizzle({ client, schema });
    organizationId = `contact-completeness-${crypto.randomUUID()}`;
    await database.insert(schema.organization).values({ id: organizationId, name: "Synthetic coverage", slug: organizationId });
    await database.insert(schema.firmablePeople).values([{ id: "synthetic-person" }, { id: "manual-person" }]).onConflictDoNothing();
    const [target] = await database.insert(schema.targets).values({ organizationId, companyName: "Synthetic non-fire company", firmographics: {} }).returning({ id: schema.targets.id });
    targetId = target.id;
  });
  afterAll(async () => {
    if (!client) return;
    await client.query("ROLLBACK");
    if (organizationId) expect((await client.query("SELECT count(*)::int AS n FROM organization WHERE id=$1", [organizationId])).rows[0].n).toBe(0);
    await client.end();
  });
  it("RC-13-integration / RC-14-integration: provider → persisted JSON → completeness → rendered contact table", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => { void _input; return Response.json({ id: "synthetic-person", full_name: "Synthetic Owner", emails: { work: [], personal: [] }, phones: [{ value: "123" }] }); });
    const provider = new FirmableClient({ apiKey: "fixture", fetch: fetcher, fictionalise: false });
    const person = await provider.enrichPerson({ id: "synthetic-person" }, { includePhones: false });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("includePhones=false");
    const saved = await upsertFirmableContact({ database, organizationId, targetId, companyId: "synthetic-company", person, candidate: { id: person.id, emailAvailable: true, phoneAvailable: true } });
    const [row] = await database.select().from(schema.contacts).where(eq(schema.contacts.id, saved.id));
    const personal = row.personalData as Record<string, unknown>;
    const completeness = contactCompleteness(personal);
    expect(completeness.email).toMatchObject({ saved: false, status: "unavailable" });
    expect(completeness.phone).toMatchObject({ saved: false, potentiallyAvailable: true, status: "not_requested" });
    const html = renderToStaticMarkup(<CompanyContactsTable contacts={[{ id: row.id, displayName: row.displayName, completeness, fictionalised: row.fictionalised, doNotContact: false }]} />);
    expect(html).toContain("Not supplied by the source");
    expect(html).toContain("Manual lookup required");
    expect(personal.phone).toBeUndefined();
  });
  it("RC-13-generalization: automatic refresh retains a previously saved manual phone", async () => {
    const person = { id: "manual-person", name: "Manual Owner", phone: "123", email: "owner@example.test", emailAvailable: true, phoneAvailable: true, fictionalised: false, doNotContact: false };
    const saved = await upsertFirmableContact({ database, organizationId, targetId, companyId: "synthetic-company", person });
    await upsertFirmableContact({ database, organizationId, targetId, companyId: "synthetic-company", person: { ...person, phone: undefined, phoneAvailable: false, phoneLookupStatus: "not_requested" } });
    const [row] = await database.select().from(schema.contacts).where(eq(schema.contacts.id, saved.id));
    expect(contactCompleteness(row.personalData as Record<string, unknown>).phone).toMatchObject({ saved: true, status: "reported" });
  });
});
