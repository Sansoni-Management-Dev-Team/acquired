export interface PendingPostgresSuite {
    readonly file: string;
    readonly cases: number;
    readonly target: '5445' | '5446' | '5445+5446';
}
export const pendingPostgresSuites: readonly PendingPostgresSuite[];
export interface PendingPostgresReport {
    checkedAt: string;
    targets: unknown[];
    suites: readonly PendingPostgresSuite[];
    sourceHashes: Record<string, string>;
    sourceStable: boolean;
    allTestsExecuted: boolean;
    testsPassed: number;
    testsSkipped: number | null;
    expectedCases: number;
    exitCode: number | null;
    signal: string | null;
    migrationsPerformed: false;
    providerWrites: 0;
    productionActivated: false;
    actualPostgresProof: boolean;
    syntheticAuthorityPorts: true;
    retainedSyntheticHistory: true;
    log: string;
}
export function runPendingPostgresVerification(options?: {
    root?: string;
    env?: Record<string, string | undefined>;
    preflight?: (root: string) => Promise<{
        verified: boolean;
        targets: unknown[];
    }>;
}): Promise<PendingPostgresReport>;
export function verifyPendingCatalog(client: {
    query(sql: string, values?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
    }>;
}, target: {
    name: string;
    user: string;
    port: number;
    identity: string;
    roles: string[];
    relations: string[];
    functions: string[];
}): Promise<unknown>;
