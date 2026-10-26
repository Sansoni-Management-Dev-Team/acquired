import {readdirSync,readFileSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const testFile=/\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
const classifications=new Map();

/** Inspect syntax only: discovering tests never imports or executes them. */
export function testRunner(source,fileName='test.mjs'){
 const ast=ts.createSourceFile(fileName,source,ts.ScriptTarget.Latest,true),runners=new Set();
 const dependency=value=>{if(value==='node:test')runners.add('node');else if(value==='vitest')runners.add('vitest');};
 const visit=node=>{
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))dependency(node.moduleSpecifier.text);
  if(ts.isCallExpression(node)&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0])&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require'))dependency(node.arguments[0].text);
  ts.forEachChild(node,visit);
 };
 visit(ast);
 if(runners.size>1)throw Error('Test mixes node:test and Vitest: '+fileName);
 return runners.has('node')?'node':'vitest';
}

/** One inventory shared by Vitest exclusions and the Node runner. Normal
 * test/spec filenames are automatic; separately invoked .selftest files retain
 * their explicit workflow (some depend on private verification artifacts).
 * Hidden/dependency directories and symlinks are never traversed. */
export function discoverNodeTestFiles(root=repositoryRoot){
 const base=resolve(root),found=[];
 const walk=directory=>{
  for(const entry of readdirSync(directory,{withFileTypes:true})){
   if(entry.name.startsWith('.')||entry.name==='node_modules')continue;
   const file=join(directory,entry.name);
   if(entry.isDirectory())walk(file);
   else if(entry.isFile()&&testFile.test(entry.name)){
    // Re-read bytes on every inventory so additions, edits and removals remain
    // visible, while unchanged files do not need another complete AST walk.
    const source=readFileSync(file,'utf8'),cached=classifications.get(file);
    const runner=cached?.source===source?cached.runner:testRunner(source,file);
    classifications.set(file,{source,runner});
    if(runner==='node')found.push(relative(base,file).split(sep).join('/'));
   }
  }
 };
 walk(base);return found.sort();
}
