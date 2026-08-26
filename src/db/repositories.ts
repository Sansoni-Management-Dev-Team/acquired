import { and, desc, eq } from "drizzle-orm";
import type { db as databaseType } from "./client";
import { auditEvents, signals, targets } from "./schema";

type Database = NonNullable<typeof databaseType>;

export class OrganizationRepository {
  constructor(private database: Database, private organizationId: string) {
    if (!organizationId) throw new Error("organizationId is required for every repository");
  }

  listTargets() {
    return this.database.select().from(targets).where(eq(targets.organizationId, this.organizationId)).orderBy(desc(targets.createdAt));
  }

  targetSignals(targetId: string) {
    return this.database.select().from(signals).where(and(eq(signals.organizationId, this.organizationId), eq(signals.targetId, targetId)));
  }

  appendAudit(event: { actorId: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; metadata?: Record<string, unknown> }) {
    return this.database.insert(auditEvents).values({ organizationId: this.organizationId, ...event });
  }

  listAudit(limit = 100) {
    return this.database.select().from(auditEvents).where(eq(auditEvents.organizationId, this.organizationId)).orderBy(desc(auditEvents.createdAt)).limit(Math.min(limit, 500));
  }
}
