import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async p => JSON.parse(await readFile(resolve(root,p),'utf8'));
const source = String((await readJson('package.json')).version);
const values = new Map([
  ['package.json', source],
  ['client/package.json', String((await readJson('client/package.json')).version)],
  ['desktop/package.json', String((await readJson('desktop/package.json')).version)],
  ['desktop/src-tauri/tauri.conf.json', String((await readJson('desktop/src-tauri/tauri.conf.json')).version)],
]);

const cargo = await readFile(resolve(root,'desktop/src-tauri/Cargo.toml'),'utf8');
values.set('desktop/src-tauri/Cargo.toml', cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || 'missing');
const readme = await readFile(resolve(root,'README.md'),'utf8');
values.set('README.md', readme.match(/\*\*Current version:\*\* `([^`]+)`/)?.[1] || 'missing');
const sw = await readFile(resolve(root,'client/public/sw.js'),'utf8');
values.set('client/public/sw.js', sw.includes(`homechat-v${source}`) ? source : 'mismatch');

let ok = true;
for (const [file,value] of values) {
  if (value !== source) {
    console.error(`${file}: ${value} (expected ${source})`);
    ok = false;
  } else {
    console.log(`${file}: ${value}`);
  }
}
if (!ok) process.exit(1);
console.log(`Version check passed: ${source}`);
