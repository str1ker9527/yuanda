/** Shared tool entrypoints; Electron and caches stay inside this checkout. */
import { access, cp, readFile, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export { electronExecutable, releaseLayout } from '../app/platform-paths.mjs';
import { releaseLayout } from '../app/platform-paths.mjs';

export function projectEnvironment(root, temporary = path.join(root, '.local', 'tmp'), inherited = process.env) {
  return { ...inherited, TEMP: temporary, TMP: temporary, TMPDIR: temporary,
    npm_config_cache: path.join(root, '.local', 'npm-cache'),
    electron_config_cache: path.join(root, '.local', 'electron-cache'),
    ELECTRON_CACHE: path.join(root, '.local', 'electron-cache') };
}

/** Electron plists are converted to XML by plutil before this small string-only update. */
export function updatePlistStrings(source, fields) {
  if (!source.includes('<plist') || !source.includes('<dict>') || !source.includes('</dict>')) throw new Error('Expected an XML dictionary plist');
  const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  for (const [key, value] of Object.entries(fields)) {
    if (!/^CFBundle[A-Za-z]+$/.test(key)) throw new Error(`Unsupported plist key: ${key}`);
    const entry = `<key>${key}</key>\n\t<string>${xml(value)}</string>`;
    const pattern = new RegExp(`<key>${key}</key>\\s*<string>[\\s\\S]*?</string>`);
    if (pattern.test(source)) source = source.replace(pattern, () => entry);
    else { const end = source.lastIndexOf('</dict>'); source = source.slice(0,end) + `\t${entry}\n` + source.slice(end); }
  }
  return source;
}

/** npm may sit beside node (Windows), under ../lib (Unix), or be a PATH symlink (Homebrew/nvm). */
export async function resolveNpmCli({ executable = process.execPath, env = process.env } = {}) {
  const candidates = [env.npm_execpath, path.join(path.dirname(executable), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(executable), '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const directory of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    const npm = path.join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    if (process.platform === 'win32') candidates.push(path.join(directory, 'node_modules/npm/bin/npm-cli.js'));
    else candidates.push(await realpath(npm).catch(() => null));
  }
  for (const candidate of candidates.filter(Boolean)) {
    if (!candidate.endsWith('npm-cli.js')) continue;
    if (await access(candidate, constants.R_OK).then(() => true, () => false)) return candidate;
  }
  throw new Error('未找到 npm 的入口。请安装含 npm 的 Node.js，然后在项目目录重试 node scripts/setup.mjs。');
}

/** Isolated runtime copy for existing --dist UI tests; every regular file is hash checked. */
export async function copyReleaseRuntime(release, target, { platform = process.platform } = {}) {
  const layout = releaseLayout(release, platform), copied = releaseLayout(target, platform), files = [];
  // Preserve default-app script mode in the harness, matching the Windows runtime-only copy.
  // Application sources are copied and audited separately by each --dist test.
  const excludedApp = path.resolve(layout.app);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  async function copy(relative) {
    await cp(path.join(release, relative), path.join(target, relative), { recursive: true, verbatimSymlinks: true,
      filter: source => path.resolve(source) !== excludedApp });
    async function audit(name) {
      if (path.resolve(release, name) === excludedApp) return;
      const entries = await readdir(path.join(release, name), { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOTDIR') return null;
        throw error;
      });
      if (entries) { for (const entry of entries) if (!entry.isSymbolicLink()) await audit(path.posix.join(name, entry.name)); return; }
      const digest = sha(await readFile(path.join(release, name)));
      if (sha(await readFile(path.join(target, name))) !== digest) throw new Error(`Runtime copy mismatch: ${name}`);
      files.push({ path: name, sha256: digest });
    }
    await audit(relative);
  }
  if (layout.bundle) await copy(path.basename(layout.bundle));
  else {
    for (const entry of await readdir(release, { withFileTypes: true })) if (entry.isFile() || entry.name === 'locales') await copy(entry.name);
    await copy('resources/default_app.asar');
  }
  return { executable: copied.executable, originalExecutable: layout.executable, files };
}
