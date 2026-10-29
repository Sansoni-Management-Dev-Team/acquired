import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/aws-relay.mjs'],outfile:'dist/aws-relay.mjs',bundle:true,platform:'node',format:'esm',target:'node22'});
// Always bundle this service's locked dependency, even beside an app installation.
const packageAliases={zod:resolve('node_modules/zod')};
const compilerOptions={target:'node22',tsconfigRaw:{compilerOptions:{useDefineForClassFields:true}}};
await build({
  entryPoints:['src/server.mjs'], outfile:'dist/server.mjs', bundle:true, platform:'node', format:'esm', ...compilerOptions,
  external:['@dbos-inc/dbos-sdk','pg'],
  nodePaths:[resolve('node_modules')],
  alias:{...packageAliases,'cloudflare:workers':resolve('src/cloudflare-bindings.mjs')},
});
await build({entryPoints:['../../cloudflare/research/index.ts'],outfile:'dist/worker.mjs',bundle:true,platform:'node',format:'esm',...compilerOptions,nodePaths:[resolve('node_modules')],alias:{...packageAliases,'cloudflare:workers':resolve('src/cloudflare-bindings.mjs')}});
await writeFile('dist/revision',createHash('sha256').update(await readFile('dist/server.mjs')).update(await readFile('package-lock.json')).digest('hex'));

await build({entryPoints:['test/mandate-harness.mjs'],outfile:'dist/mandate-harness.mjs',bundle:true,platform:'node',format:'esm',...compilerOptions,nodePaths:[resolve('node_modules')],alias:{...packageAliases,'@':resolve('../../src')}});

await build({entryPoints:['src/tavily.mjs'],outfile:'dist/tavily.mjs',bundle:true,platform:'node',format:'esm',...compilerOptions,nodePaths:[resolve('node_modules')],alias:{...packageAliases,'@':resolve('../../src')}});

await build({entryPoints:['../../cloudflare/research/firmable/account.ts'],outfile:'dist/firmable-account.mjs',bundle:true,platform:'node',format:'esm',...compilerOptions,nodePaths:[resolve('node_modules')]});
