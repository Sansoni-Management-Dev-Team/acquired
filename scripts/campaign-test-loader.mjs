// Node's TypeScript stripping does not resolve the application's @/ alias.
// This hook is scoped to explicitly imported local campaign test scripts.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const path = specifier.slice(2);
      return nextResolve(new URL(`../src/${path}${/\.[cm]?[jt]sx?$/.test(path) ? '' : '.ts'}`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
