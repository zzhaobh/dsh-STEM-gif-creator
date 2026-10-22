import test from 'node:test';
import assert from 'node:assert/strict';
const mod = await import('../index.js').catch(()=>({}));

test('Host exposes supported wire schema without relaxing authoritative validator', async () => {
  assert.equal(typeof mod.toolParameters, 'object');
  const allowed = new Set(['type','properties','required','additionalProperties','items','enum','const','oneOf','description','title','default']);
  function visit(s) { for (const key of Object.keys(s)) assert.ok(allowed.has(key), `unsupported ${key}`); if(s.properties) Object.values(s.properties).forEach(visit); if(s.items) visit(s.items); if(s.oneOf) s.oneOf.forEach(visit); }
  visit(mod.toolParameters);
  // Optional integration against the real DSH schema validator is separate from this portable structural test.
  assert.doesNotThrow(()=>JSON.stringify(mod.toolParameters));
});
test('Host binds the tool to the exact receiving agent through the bundled skill entry',async()=>{
  assert.equal(typeof mod.apply,'function');
  let tool,provider; const calls=[];
  const ctx={tools:{register(x){tool=x;}},skills:{registerProvider(create){provider=create({signal:new AbortController().signal});}},workingDirectory:{ensure:async()=>'/tmp'},fs:{processPathFromHostPath:x=>x},sandboxPolicy:{resolve:()=>({mode:'read-only',workspaceRoot:'/tmp'})},subprocess:{}};
  ctx.effect=fn=>fn();
  mod.apply(ctx,{},{operations:{run:async(...args)=>{calls.push(args);return []}}});
  assert.equal(tool.name,'gif_creator'); assert.equal(provider.name,'gif-creator');
  const candidates=await provider.list(); assert.equal(candidates.length,1); assert.equal(candidates[0].name,'stem-gif-creator');
  const skill=await provider.get(candidates[0]); assert.match(skill.content,/gif_creator \{action:"plan"/); assert.match(skill.content,/entry is this skill/);
  let getterCalls=0;const inherited=Object.create({get action(){getterCalls++;return 'create';}});
  await assert.rejects(()=>tool.execute(inherited,{agent:{session:{id:'s'}}}),/plain JSON/);assert.equal(getterCalls,0);
  const plan=await tool.execute({action:'plan',brief:'统计学习'},{agent:{session:{id:'s'}}});assert.equal(plan.author,'receiving_agent');assert.equal(calls.length,0);
  await assert.rejects(()=>tool.execute({action:'create'},{agent:{session:{id:'s'}},signal:new AbortController().signal}),/read-only/);
  await assert.rejects(()=>tool.execute({action:'list'},{signal:new AbortController().signal}),/session/);
  assert.deepEqual(await tool.execute({action:'list'},{agent:{session:{id:'s'}},signal:new AbortController().signal}),[]);
  assert.equal(calls[0][0],'s');
  ctx.sandboxPolicy.resolve=()=>({mode:'workspace-write',workspaceRoot:process.cwd()});
  await assert.rejects(()=>tool.execute({action:'create'},{agent:{session:{id:'s'}},signal:new AbortController().signal}),/workspace-write boundary/);
});
test('Managed renderer uses bounded batch stdin, no shell and checks exit',async()=>{
  assert.equal(typeof mod.createManagedRenderer,'function');
  let spec;const handle={done:Promise.resolve({exitCode:0,signal:null}),collected:{stdout:{readFrom:()=>({text:'{}',lossy:false})},stderr:{readFrom:()=>({text:'',lossy:false})}},waitForExit:async()=>true,terminate(){}};
  const ctx={subprocess:{resolveExecutable:async x=>x,spawn:x=>{spec=x;return handle;}}};
  await mod.createManagedRenderer(ctx,{python:'/python'})({storyboard:{title:'中文',source:'x',scenes:[]},outputDir:'/tmp/out',theme:'light',signal:new AbortController().signal});
  assert.equal(spec.argv[0],'/python');assert.equal(spec.argv.length,3);assert.equal(spec.argv[1],'-I');
  assert.equal(JSON.parse(spec.stdio.stdin.data).outputDir,'/tmp/out');assert.equal(spec.stdio.stdout.maxBytes,65536);assert.equal(spec.stdio.stderr.maxBytes,65536);
  assert.equal(JSON.parse(spec.stdio.stdin.data).animationEngine,'matplotlib');
  await mod.createManagedRenderer(ctx,{python:'/python',animationEngine:'celluloid'})({storyboard:{},outputDir:'/tmp/out',theme:'light'});
  assert.equal(JSON.parse(spec.stdio.stdin.data).animationEngine,'celluloid');
  await assert.rejects(()=>mod.createManagedRenderer(ctx,{animationEngine:'user-code'})({storyboard:{},outputDir:'/tmp/out',theme:'light'}),/animationEngine/);
  await mod.createManagedRenderer(ctx,{python:'/python',manimPython:'/manim-python'})({storyboard:{scenes:[{layout:'technical'}]},outputDir:'/tmp/out',theme:'light'});
  assert.equal(spec.argv[0],'/manim-python');assert.ok(spec.argv[2].endsWith('/manim_backend.py'));
  assert.equal(Object.hasOwn(JSON.parse(spec.stdio.stdin.data),'animationEngine'),false);
  handle.done=Promise.resolve({exitCode:1,signal:null});await assert.rejects(()=>mod.createManagedRenderer(ctx,{python:'/python'})({storyboard:{},outputDir:'/tmp/out',theme:'light',signal:new AbortController().signal}),/Renderer failed/);
});
