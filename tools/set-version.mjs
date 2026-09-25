import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = String(process.argv[2] || '').trim().replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: npm run version:set -- 0.15.3');
  process.exit(1);
}

async function updateJson(relativePath) {
  const file = resolve(root, relativePath);
  const data = JSON.parse(await readFile(file, 'utf8'));
  data.version = version;
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

await updateJson('package.json');
await updateJson('client/package.json');
await updateJson('desktop/package.json');

{
  const file = resolve(root, 'desktop/src-tauri/tauri.conf.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  data.version = version;
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

{
  const file = resolve(root, 'desktop/src-tauri/Cargo.toml');
  const input = await readFile(file, 'utf8');
  const output = input.replace(/(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m, `$1"${version}"`);
  await writeFile(file, output, 'utf8');
}

{
  const file = resolve(root, 'README.md');
  const input = await readFile(file, 'utf8');
  const output = input.replace(/\*\*Current version:\*\* `[^`]+`/, `**Current version:** \`${version}\``);
  await writeFile(file, output, 'utf8');
}

const { spawnSync } = await import('node:child_process');
const sw = spawnSync(process.execPath, [resolve(root, 'client/scripts/generate-sw.mjs')], { stdio: 'inherit' });
if (sw.status !== 0) process.exit(sw.status ?? 1);

console.log(`HomeChat version set to ${version}`);
