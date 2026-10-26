import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type Route = { kind: 'page' | 'api'; path: string; file: string; methods: string[] };
export type CoverageEntry = { kind: 'page' | 'api'; path: string; url?: string; expectation?: 'render' | 'redirect'; heading?: string; gap?: string };
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
export function discoverRoutes(root: string): Route[] {
  const routes: Route[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!/^(page|route)\.(tsx?|jsx?)$/.test(entry.name)) continue;
      const segments = relative(root, dirname(file)).split(/[\\/]/).filter(Boolean);
      if (segments.some(s => s.startsWith('@') || /^\(\./.test(s))) throw Error(`Route needs explicit inventory support: ${file}`);
      const path = '/' + segments.filter(s => !/^\(.*\)$/.test(s)).join('/');
      const kind = entry.name.startsWith('page.') ? 'page' : 'api';
      const exported = new Set<string>();
      if (kind === 'api') {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        for (const statement of source.statements) {
          if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const e of statement.exportClause.elements) exported.add(e.name.text);
          }
          if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
          if (ts.isFunctionDeclaration(statement) && statement.name) exported.add(statement.name.text);
          if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) {
            if (ts.isIdentifier(d.name)) exported.add(d.name.text);
            else if (ts.isObjectBindingPattern(d.name)) for (const e of d.name.elements) if (ts.isIdentifier(e.name)) exported.add(e.name.text);
          }
        }
      }
      routes.push({ kind, path, file: relative(root, file).replaceAll('\\', '/'), methods: [...exported].filter(m => methods.has(m)).sort() });
    }
  }
  walk(root);
  const keys = routes.map(r => `${r.kind}:${r.path}`);
  if (new Set(keys).size !== keys.length) throw Error('Duplicate route paths require explicit inventory support');
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}
export function validateCoverage(routes: Route[], entries: CoverageEntry[]) {
  const expected = new Set(routes.map(r => `${r.kind}:${r.path}`)), seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.path}`;
    if (seen.has(key)) throw Error(`Duplicate coverage entry: ${key}`);
    if (!expected.has(key)) throw Error(`Stale coverage entry: ${key}`);
    seen.add(key);
    if (entry.kind === 'page') {
      if (!entry.url?.startsWith('/') || entry.url.startsWith('//') || /[\[\]\\]/.test(entry.url)) throw Error(`Page needs a concrete local URL: ${key}`);
      const pattern = entry.path.split('/').map(segment => {
        if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '(?:/.*)?';
        if (/^\[\.\.\..+\]$/.test(segment)) return '/.+';
        if (/^\[.+\]$/.test(segment)) return '/[^/]+';
        return segment ? '/' + segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
      }).join('') || '/';
      if (!new RegExp('^' + pattern + '$').test(new URL(entry.url, 'http://localhost').pathname)) throw Error(`URL does not match its route: ${key}`);
      if (!['render', 'redirect'].includes(entry.expectation ?? '') || !entry.heading) throw Error(`Page needs an assertion: ${key}`);
      if (entry.expectation === 'redirect' && !entry.gap) throw Error(`Redirect is not authenticated coverage; record the gap: ${key}`);
    } else if (!entry.gap) throw Error(`API inventory needs an explicit runtime coverage gap: ${key}`);
  }
  for (const key of expected) if (!seen.has(key)) throw Error(`Missing coverage entry: ${key}`);
}
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const routes = discoverRoutes(join(root, 'src/app'));
  const entries: CoverageEntry[] = JSON.parse(readFileSync(join(root, 'tests/routes/coverage.json'), 'utf8'));
  validateCoverage(routes, entries);
  const report = { generatedAt: new Date().toISOString(), note: 'Inventory and declared assertions, not test execution or line coverage.',
    pages: routes.filter(r => r.kind === 'page').length, apiHandlers: routes.filter(r => r.kind === 'api').length,
    publicRenderCases: entries.filter(e => e.expectation === 'render').length,
    signedOutRedirectCases: entries.filter(e => e.expectation === 'redirect').length,
    routes: routes.map(route => ({ ...route, coverage: entries.find(e => e.kind === route.kind && e.path === route.path) })) };
  const output = join(root, 'coverage/routes/inventory.json');
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.pages} pages: ${report.publicRenderCases} render cases, ${report.signedOutRedirectCases} signed-out redirects; ${report.apiHandlers} API handlers inventoried.\n${output}`);
}
