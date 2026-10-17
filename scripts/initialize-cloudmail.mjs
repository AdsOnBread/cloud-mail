import { readFile } from 'node:fs/promises';
const url = new URL(process.argv[2] || '');
if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Use HTTPS for remote initialization.');
const secrets = JSON.parse(await readFile(new URL('../.cloudmail-secrets.json', import.meta.url), 'utf8'));
const response = await fetch(new URL('/api/init',url), { method:'POST',redirect:'error',headers:{
  'X-Cloudmail-App-Secret':secrets.app_access_secret,'X-Cloudmail-Init-Secret':secrets.init_secret
}});
if (!response.ok || (await response.text()) !== 'success') throw new Error(`Initialization failed (HTTP ${response.status}). Check the deployment and Access configuration.`);
console.log('Cloudmail database initialized successfully.');
