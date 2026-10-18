import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {discoverNodeTestFiles,repositoryRoot} from './test-runner-files.mjs';

export function nodeTestArguments({root=repositoryRoot,args=[]}={}){
 const files=discoverNodeTestFiles(root);
 if(files.length===0)throw Error('No node:test suites discovered');
 return ['--test',...args,...files];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=spawnSync(process.execPath,nodeTestArguments({args:process.argv.slice(2)}),{cwd:repositoryRoot,stdio:'inherit'});
 if(result.error)throw result.error;
 process.exitCode=result.status??1;
}
