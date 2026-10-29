import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Emitted during Vite's build so canonical inventories/offline hashes include it.
export function analyticsPlugin(site, expectedSourceHash) {
  const source = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8');
  const plugin = readFileSync(new URL('./vite-analytics.mjs', import.meta.url), 'utf8');
  const actualHash = createHash('sha256').update(source).update(plugin).digest('hex');
  // Bind the shared sources to each app's inventoried vite.config.js input.
  if (actualHash !== expectedSourceHash) throw new Error(`Update ${site} analytics source pin to ${actualHash}`);
  return {
    name: 'openmapstack-posthog',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'analytics.js', source });
    },
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [{ tag: 'script', attrs: {
          defer: true, src: './analytics.js', 'data-site': site,
          'data-release': process.env.GITHUB_SHA || 'local-build',
        }, injectTo: 'head' }];
      },
    },
  };
}
