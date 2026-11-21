import {defineConfig, loadEnv} from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import {languages as spellingLanguages} from './src/components/tiny-editor/spelling/languages.js'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'
import {viteStaticCopy} from 'vite-plugin-static-copy';
import {createRequire} from 'node:module';
const pdfPackage = createRequire(import.meta.url)('pdfjs-dist/package.json');
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
    const env = loadEnv(mode, process.cwd(), 'VITE')
    return {
        worker: { format:'es' },
        server: {
            host: true,
            port: 3001,
            hmr: true,
        },
        base: env.VITE_STATIC_URL || '/',
        plugins: [vue(),
            viteStaticCopy({
                targets: ['wasm', 'cmaps', 'standard_fonts', 'iccs', 'LICENSE'].map(name => ({
                    src: path.resolve(__dirname, 'node_modules/pdfjs-dist', name),
                    dest: 'pdf/' + pdfPackage.version,
                })).concat({ src: path.resolve(__dirname, 'node_modules/emojibase-data/LICENSE'), dest: 'licenses/emojibase-data' }).concat(
                    {src:path.resolve(__dirname,'node_modules/@farscrl/hunspell-wasm/LICENSE'), dest:'licenses/hunspell-wasm'},
                    spellingLanguages.flatMap(([id]) => ['index.aff','index.dic','readme.md','package.json',
                        ...(id === 'et' ? [] : ['license'])].map(file => ({
                        src:path.resolve(__dirname, 'node_modules/dictionary-' + id, file), dest:'spelling/' + id,
                    }))),
                ),
            }),
            VitePWA({
                injectRegister: 'script-defer',
                manifest: {
                    name: env.VITE_PWA_NAME,
                    short_name: env.VITE_PWA_NAME,
                    background_color: '#FFFEF8',
                    theme_color: '#103C33',
                    icons: [
                        {
                            src: 'mail-pwa.png',
                            sizes: '192x192',
                            type: 'image/png',
                        }
                        {src:'brand/mail-512.png',sizes:'512x512',type:'image/png'},
                    ],
                },
                workbox: {
                    disableDevLogs: true,
                    globPatterns: [],
                    runtimeCaching: [],
                    navigateFallback: null,
                    cleanupOutdatedCaches: true,
                }
            }),
            AutoImport({
                resolvers: [ElementPlusResolver()],
            }),
            Components({
                resolvers: [ElementPlusResolver()],
            })
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'src')
            }
        },
        build: {
            target: 'es2022',
            outDir: env.VITE_OUT_DIR || 'dist',
            emptyOutDir: true,
            assetsInclude: ['**/*.json']
        }
    }
})
