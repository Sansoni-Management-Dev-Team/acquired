export const repositoryRoot: string;
export function testRunner(source: string, fileName?: string): 'node' | 'vitest';
export function discoverNodeTestFiles(root?: string): string[];
