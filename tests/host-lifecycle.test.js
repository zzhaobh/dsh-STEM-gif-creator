import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';
test('plugin disposal aborts and drains owned work before it settles',async()=>{
  let tool,dispose,started;
  const begun=new Promise(r=>{started=r;});
  let stopped=false;
  const ctx={effect(fn){dispose=fn();},tools:{register(x){tool=x;}},skills:{registerProvider(){}},workingDirectory:{ensure:async()=>'/tmp'},fs:{processPathFromHostPath:x=>x},sandboxPolicy:{resolve:()=>({mode:'danger-full-access',workspaceRoot:'/tmp'})},subprocess:{}};
  apply(ctx,{}, {operations:{run:async(_s,_c,_r,signal)=>{started();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));stopped=true;signal.throwIfAborted();}}});
  const job=tool.execute({action:'render'},{agent:{session:{id:'s'}},signal:new AbortController().signal});
  await begun;
  assert.equal(typeof dispose,'function');
  await dispose(); assert.equal(stopped,true);await assert.rejects(job);
  await assert.rejects(()=>tool.execute({action:'list'},{agent:{session:{id:'s'}},signal:new AbortController().signal}),/disposed/);
});
