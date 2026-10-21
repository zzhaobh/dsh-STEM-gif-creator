import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveRendererPython} from '../runtime.js';

async function fixture(run){
 const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'stem-runtime-')));
 const previous=process.env.DSH_STEM_GIF_HOME;process.env.DSH_STEM_GIF_HOME=home;
 const root=path.join(home,'charts'),bin=path.join(root,process.platform==='win32'?'Scripts':'bin');
 await fs.mkdir(bin,{recursive:true});
 const python=path.join(bin,process.platform==='win32'?'python.exe':'python');
 const manifest={version:1,envRoot:home,engines:{charts:{envRoot:root,python}}};
 const file=path.join(home,'runtime.json');await fs.writeFile(file,JSON.stringify(manifest));
 try{await run({home,root,bin,python,manifest,file});}finally{if(previous===undefined)delete process.env.DSH_STEM_GIF_HOME;else process.env.DSH_STEM_GIF_HOME=previous;await fs.unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(bin);await fs.rmdir(root);await fs.rmdir(home);}
}
test('runtime discovers only manifest-bound engine interpreter',async()=>fixture(async({python})=>{assert.equal(await resolveRendererPython('charts'),python);await assert.rejects(()=>resolveRendererPython('manim'),/engine not configured/);}));
test('runtime rejects malformed manifest and mismatching engine paths',async()=>fixture(async({file,manifest})=>{for(const value of [{...manifest,version:2},{...manifest,envRoot:'/wrong'},{...manifest,engines:{charts:{envRoot:manifest.engines.charts.envRoot,python:'/outside/python'}}}]){await fs.writeFile(file,JSON.stringify(value));await assert.rejects(()=>resolveRendererPython('charts'),/not configured/);}}));
test('runtime rejects redirected interpreter directory',{skip:process.platform==='win32'},async()=>fixture(async({bin,home})=>{const external=path.join(home,'outside');await fs.mkdir(external);await fs.rmdir(bin);await fs.symlink(external,bin);try{await assert.rejects(()=>resolveRendererPython('charts'),/redirected/);}finally{await fs.unlink(bin);await fs.mkdir(bin);await fs.rmdir(external);}}));
