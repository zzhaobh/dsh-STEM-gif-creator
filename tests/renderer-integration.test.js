import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createOperations } from '../operations.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const python=process.env.GIF_CREATOR_TEST_PYTHON;
for(const fixture of [
  {file:'explanation.json',engine:'matplotlib'},
  {file:'charts.json',engine:'matplotlib'},
  {file:'charts.json',engine:'celluloid'},
  {file:'spark.json',engine:'manim'},
]) test(`real Python ${fixture.file}/${fixture.engine} publishes and roundtrips all media through operations`,{skip:!(fixture.engine==='manim'?process.env.GIF_CREATOR_MANIM_PYTHON:python),timeout:180000},async()=>{
  const cwd=path.join(root,'verification','integration',randomUUID());
  await fs.mkdir(cwd,{recursive:true});
  const storyboard=JSON.parse(await fs.readFile(path.join(root,'examples',fixture.file),'utf8'));
  const ops=createOperations({render:async({storyboard,outputDir,theme,signal})=>{
    const child=spawn(fixture.engine==='manim'?process.env.GIF_CREATOR_MANIM_PYTHON:python,['-I',path.join(root,'renderer',fixture.engine==='manim'?'manim_backend.py':'render.py')],{cwd:outputDir,signal,stdio:['pipe','pipe','pipe'],env:{...process.env,MPLBACKEND:'Agg',MPLCONFIGDIR:path.join(outputDir,'.mpl-cache')}});
    let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>65536)child.kill();});child.stdout.resume();
    const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`renderer ${code}: ${stderr}`)));});
    child.stdin.end(JSON.stringify({storyboard,outputDir,theme,...(fixture.engine==='manim'?{}:{animationEngine:fixture.engine})}));await done;
  }});
  const project=await ops.run('verification-real-python',cwd,{action:'create',storyboard});
  const rendered=await ops.run('verification-real-python',cwd,{action:'render',id:project.id,expectedRevision:project.revision,theme:'light'});
  assert.equal(rendered.artifacts.revision,project.revision);
  assert.equal(rendered.artifacts.metrics.width,1280);assert.equal(rendered.artifacts.metrics.height,720);
  assert.equal(rendered.artifacts.metrics.durationMs,storyboard.scenes.reduce((n,s)=>n+s.durationSeconds*1000,0));
  for(const kind of ['animation','overview','scene']){
    const media=await ops.run('verification-real-python',cwd,{action:'media',id:project.id,expectedRevision:project.revision,kind,...(kind==='scene'?{sceneIndex:0}:{})});
    const bytes=Buffer.from(media.base64,'base64');assert.ok(bytes.length>1000 && bytes.length<=16*1024*1024);
    if(kind==='animation')assert.equal(bytes.subarray(0,6).toString(),'GIF89a');else assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  }
  console.log(`Verified actual output directory: ${rendered.artifacts.directory}`);
});
