import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';

// Agents choose a leaf name, never an arbitrary filesystem path. Existing
// exports are preserved; the operation returns the actual allocated filename.
export async function writeAgentArtifact(directory, requestedName, extension, content) {
  if (!['yuanda','html','rp'].includes(extension)) throw new Error('不支持的文件格式');
  if (typeof requestedName !== 'string') throw new Error('文件名必须是文字');
  const name = requestedName.trim().replace(new RegExp(`\\.${extension}$`, 'i'), '');
  if (!name || name.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('请使用不含路径和特殊字符的文件名（最多100字）');
  await mkdir(directory, { recursive: true });
  for (let i = 0; i < 1000; i++) {
    const target = path.join(directory, `${name}${i ? `-${i + 1}` : ''}.${extension}`);
    let handle;
    try { handle = await open(target, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    try { await handle.writeFile(content); await handle.sync(); }
    catch (error) { await handle.close(); await unlink(target).catch(() => {}); throw error; }
    await handle.close(); return target;
  }
  throw new Error('同名文件过多，请换一个文件名');
}
