import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '..');
const repoRoot = resolve(clientRoot, '..');
const pkg = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
const template = await readFile(resolve(clientRoot, 'sw.template.js'), 'utf8');
const output = template.replaceAll('__HOMECHAT_VERSION__', String(pkg.version));
await writeFile(resolve(clientRoot, 'public', 'sw.js'), output, 'utf8');
console.log(`Generated service worker cache homechat-v${pkg.version}`);
