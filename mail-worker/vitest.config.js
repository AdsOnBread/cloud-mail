import { fileURLToPath } from 'node:url';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	resolve: { alias: { '@': fileURLToPath(new URL('../mail-vue/src', import.meta.url)) } },
	test: {
		poolOptions: {
			workers: {
				miniflare: {
					compatibilityDate: '2025-03-10',
					compatibilityFlags: ['nodejs_compat'],
					d1Databases: ['db'],
					kvNamespaces: ['kv'],
					r2Buckets: ['r2'],
					bindings: {
						domain: ['example.com'],
						admin: 'admin@example.com',
						jwt_secret: 'test-only-initialization-secret'
					}
				}
			}
		}
	}
});
