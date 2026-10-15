import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {writeAgentArtifact} from '../app/agent-files.mjs';
const root=path.resolve('.local/agent-file-tests');
test('Agent 导出只用文件名，拒绝路径/设备名，同名并发也不覆盖',async()=>{
  await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'run-'));
  for(const name of ['../outside','C:\\outside','bad/name','CON','nul.txt','.','..','tail.','name?'])await assert.rejects(writeAgentArtifact(dir,name,'rp',Buffer.from('x')));
  assert.deepEqual(await readdir(dir),[]);
  const [a,b]=await Promise.all([writeAgentArtifact(dir,'原型','rp',Buffer.from([1,2,3])),writeAgentArtifact(dir,'原型.rp','rp',Buffer.from([4,5,6]))]);
  assert.notEqual(a,b);assert.deepEqual(await readFile(a),Buffer.from([1,2,3]));assert.deepEqual(await readFile(b),Buffer.from([4,5,6]));
});
