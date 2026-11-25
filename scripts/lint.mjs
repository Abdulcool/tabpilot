// Lightweight sanity checks: valid manifest JSON, referenced files exist, no syntax errors.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
};

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
check(manifest.manifest_version === 3, 'manifest is MV3');
check(manifest.permissions.every((p) => ['tabs', 'tabGroups', 'storage'].includes(p)),
  'permissions stay minimal');

const referenced = [
  manifest.action.default_popup,
  manifest.background.service_worker,
  ...Object.values(manifest.icons),
];
for (const file of referenced) check(existsSync(file), `${file} exists`);

for (const file of ['src/popup.js', 'src/background.js', 'src/lib/core.js', 'src/lib/actions.js']) {
  try {
    execFileSync('node', ['--check', file], { stdio: 'pipe' });
    check(true, `${file} parses`);
  } catch {
    check(false, `${file} parses`);
  }
}

process.exit(failures ? 1 : 0);
