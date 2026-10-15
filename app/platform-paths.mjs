/** Platform layouts only. No filesystem access or machine-specific paths. */
import path from 'node:path';

function paths(platform) { return platform === 'win32' ? path.win32 : path.posix; }
function supported(platform) {
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
}

export function electronExecutable(root, platform = process.platform) {
  supported(platform);
  return paths(platform).join(root, 'node_modules', 'electron', 'dist',
    ...(platform === 'darwin' ? ['Electron.app', 'Contents', 'MacOS', 'Electron'] : [platform === 'win32' ? 'electron.exe' : 'electron']));
}

export function releaseLayout(release, platform = process.platform) {
  supported(platform);
  const p = paths(platform), bundle = platform === 'darwin' ? p.join(release, '原搭.app') : null;
  const resources = bundle ? p.join(bundle, 'Contents', 'Resources') : p.join(release, 'resources');
  return {
    release, bundle, resources, app: p.join(resources, 'app'),
    executable: bundle ? p.join(bundle, 'Contents', 'MacOS', 'Electron') : p.join(release, platform === 'win32' ? '原搭.exe' : 'yuanda'),
    runtime: p.join(release, 'data'), projects: p.join(release, 'projects'), exports: p.join(release, 'exports')
  };
}

/** Keep portable user data beside the .app, never inside the signed application bundle. */
export function portableBase(executable, platform = process.platform) {
  supported(platform);
  const p = paths(platform);
  if (platform !== 'darwin') return p.dirname(executable);
  const binaryDirectory = p.dirname(executable), contents = p.dirname(binaryDirectory), bundle = p.dirname(contents);
  if (p.basename(binaryDirectory) !== 'MacOS' || p.basename(contents) !== 'Contents' || !bundle.endsWith('.app')) {
    throw new Error('Packaged macOS executable is not inside an .app/Contents/MacOS bundle');
  }
  return p.dirname(bundle);
}
