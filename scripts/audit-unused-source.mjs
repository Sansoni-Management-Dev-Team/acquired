import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const declarationFile = /\.d\.[cm]?ts$/;
const testFile = /\.(?:test|spec|selftest)\.(?:[cm]?[jt]s|[jt]sx)$/;
const frameworkEntry = /^src\/app\/(?:.*\/)?(?:page|layout|route|loading|error|global-error|not-found|global-not-found|forbidden|unauthorized|default|template|sitemap|robots|manifest|icon|apple-icon|opengraph-image|twitter-image)\.[jt]sx?$/;
const frameworkHook = /^(?:src\/)?(?:instrumentation(?:-client)?|middleware|proxy)\.[jt]s$/;
const normalise = path => path.split(sep).join('/');

/** Syntax-only inventory. Never imports project modules, runs scripts, or reads private directories. */
export function auditUnusedSource({ root = repositoryRoot, config } = {}) {
  config ??= JSON.parse(readFileSync(join(repositoryRoot, 'scripts/unused-source-entries.json'), 'utf8'));
  const files = new Map();
  function walk(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage', 'vendor'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && sourceFile.test(entry.name) && !declarationFile.test(entry.name)) {
        files.set(normalise(relative(root, path)), path);
      }
    }
  }
  for (const directory of config.roots) walk(resolve(root, directory));

  const graph = new Map();
  const dynamicReferences = [];
  const compilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    paths: { '@/*': [resolve(root, 'src/*')] },
  };
  const resolutionCache = ts.createModuleResolutionCache(root, path => path, compilerOptions);
  for (const [name, path] of files) {
    const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const dependencies = new Set();
    function dependency(node, argument) {
      if (!argument || !(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
        dynamicReferences.push({ path: name, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
        return;
      }
      const specifier = argument.text;
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return;
      // TypeScript may resolve explicit JS paths to sibling declarations. Keep
      // the actual implementation edge instead of losing it at the .d.mts file.
      const literalTarget = specifier.startsWith('@/')
        ? resolve(root, 'src', specifier.slice(2))
        : resolve(dirname(path), specifier);
      const literalName = normalise(relative(root, literalTarget));
      const resolved = ts.resolveModuleName(specifier, path, compilerOptions, ts.sys, resolutionCache).resolvedModule;
      const target = files.has(literalName) ? literalName
        : resolved ? normalise(relative(root, resolved.resolvedFileName)) : undefined;
      if (target && files.has(target)) dependencies.add(target);
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        dependency(node, node.moduleSpecifier);
      } else if (ts.isCallExpression(node) && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        ts.isIdentifier(node.expression) && node.expression.text === 'require'
      )) {
        dependency(node, node.arguments[0]);
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' &&
        node.arguments?.[1]?.getText(ast) === 'import.meta.url') {
        dependency(node, node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    graph.set(name, dependencies);
  }

  const retained = new Set(config.entries.map(entry => entry.path));
  const entries = [...files.keys()].filter(name => !testFile.test(name) && (
    frameworkEntry.test(name) || frameworkHook.test(name) ||
    name.startsWith('scripts/') || name.startsWith('testing/') || retained.has(name)
  ));
  function reachable(roots) {
    const found = new Set();
    function visit(name) {
      if (found.has(name)) return;
      found.add(name);
      for (const dependency of graph.get(name) ?? []) visit(dependency);
    }
    roots.forEach(visit);
    return found;
  }
  const entryReachable = reachable(entries);
  const testReachable = reachable([...files.keys()].filter(name => testFile.test(name)));
  const testOnly = [];
  const candidates = [];
  for (const name of [...files.keys()].sort()) {
    if (testFile.test(name) || entryReachable.has(name)) continue;
    (testReachable.has(name) ? testOnly : candidates).push(name);
  }
  return {
    candidates,
    testOnly,
    missingEntries: [...retained].filter(name => !files.has(name)).sort(),
    dynamicReferences,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(auditUnusedSource(), null, 2));
}
