import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createOperations } from './operations.js';
import { storyboardSchema } from './schema.js';
import { dslParameters, prepareCreation } from './dsl.js';
import { resolveRendererPython, environmentHelp } from './runtime.js';
import { auditDesign, designParameters } from './authoring.js';
import { registerSkill } from './skill.js';

export const name = 'gif-creator';
export const inject = ['tools','skills','workingDirectory','subprocess','fs','sandboxPolicy'];
const directory = path.dirname(fileURLToPath(import.meta.url));

// DSH wire declarations support structural JSON, not the complete JSON Schema vocabulary.
export function toWireSchema(schema) {
  const result = {};
  for (const key of ['type','required','additionalProperties','enum','const','description','title']) if (key in schema) result[key]=schema[key];
  if(schema.properties) result.properties=Object.fromEntries(Object.entries(schema.properties).map(([k,v])=>[k,toWireSchema(v)]));
  if(schema.items) result.items=toWireSchema(schema.items);
  const limits=Object.entries(schema).filter(([k])=>['minLength','maxLength','pattern','minItems','maxItems','minimum','maximum'].includes(k)).map(([k,v])=>`${k}: ${v}`).join('; ');
  if(limits) result.description=[result.description,limits].filter(Boolean).join(' ');
  return result;
}
export const toolParameters = {type:'object',additionalProperties:false,required:['action'],properties:{
  action:{type:'string',enum:['environment','plan','audit','compile','create','list','get','update','render','media']},
  id:{type:'string',description:'Project UUID returned by create/list.'},
  expectedRevision:{type:'integer',description:'Required for update/render/media; use exact current revision, never guess.'},
  brief:{type:'string',description:'For plan: reader question and source-grounded concept, <=8 KiB.'},draft:dslParameters,
  design:designParameters,storyboard:toWireSchema(storyboardSchema),theme:{type:'string',enum:['light','dark']},
  kind:{type:'string',enum:['animation','overview','scene']},sceneIndex:{type:'integer',description:'Zero-based index, required only for scene media.'}
}};

export function createManagedRenderer(ctx, config={}) {
  return async ({storyboard,outputDir,theme,signal}) => {
    signal?.throwIfAborted();
    const animationEngine=config.animationEngine ?? 'matplotlib';
    if(!['matplotlib','celluloid'].includes(animationEngine)) throw new Error('animationEngine must be matplotlib or celluloid.');
    const timeout = AbortSignal.timeout(180000);
    const combined = signal ? AbortSignal.any([signal,timeout]) : timeout;
    const technical=storyboard?.scenes?.some(scene=>scene.layout==='technical');
    const executable=await resolveRendererPython(technical?'manim':'charts',config);
    const python = await ctx.subprocess.resolveExecutable(executable,undefined,combined);
    const script = path.join(directory,'renderer',technical?'manim_backend.py':'render.py');
    const payload=technical ? {storyboard,outputDir,theme} : {storyboard,outputDir,theme,animationEngine};
    const handle=ctx.subprocess.spawn({argv:[python,'-I',script],cwd:outputDir,
      stdio:{stdin:{data:JSON.stringify(payload)},stdout:{maxBytes:65536},stderr:{maxBytes:65536}},
      graceMs:1500,signal:combined,env:{MPLBACKEND:'Agg',MPLCONFIGDIR:path.join(outputDir,'.mpl-cache'),PYTHONPATH:undefined,PYTHONHOME:undefined}});
    try {
      const result=await handle.done;
      combined.throwIfAborted();
      const stderr=handle.collected.stderr?.readFrom(0);
      const stdout=handle.collected.stdout?.readFrom(0);
      if(stdout?.lossy || stderr?.lossy) throw new Error('Renderer output exceeded 64 KiB; split the storyboard.');
      if(result.exitCode!==0) throw new Error(`Renderer failed (exit ${result.exitCode ?? result.signal}): ${stderr?.text?.slice(-4000) ?? ''}`);
    } finally {
      handle.terminate();
      if(!await handle.waitForExit()) throw new Error('Renderer process cleanup could not be verified.');
    }
  };
}

export function apply(ctx, config={}, dependencies={}) {
  const lifetime=new AbortController();
  const pending=new Set();
  registerSkill(ctx);
  ctx.effect(()=>async()=>{lifetime.abort(new Error('GIF Creator plugin disposed.'));await Promise.allSettled([...pending]);});
  const operations=dependencies.operations ?? createOperations({render:createManagedRenderer(ctx,config)});
  function run(agent,request,signal) {
    if(lifetime.signal.aborted) return Promise.reject(new Error('GIF Creator plugin disposed.'));
    const combined=signal ? AbortSignal.any([signal,lifetime.signal]) : lifetime.signal;
    const task=runOwned(agent,request,combined);
    pending.add(task);
    task.then(()=>pending.delete(task),()=>pending.delete(task));
    return task;
  }
  async function runOwned(agent,request,signal) {
    if(!agent?.session?.id) throw new Error('GIF Creator requires an explicit receiving agent session.');
    signal?.throwIfAborted();
    if(!request || Object.getPrototypeOf(request)!==Object.prototype) throw new Error('Request must be a plain JSON object.');
    const actionDescriptor=Object.getOwnPropertyDescriptor(request,'action');
    if(!actionDescriptor || !Object.hasOwn(actionDescriptor,'value') || !actionDescriptor.enumerable) throw new Error('Action must be an own JSON data property.');
    if(actionDescriptor.value==='environment') {
      if(Reflect.ownKeys(request).length!==1) throw new Error('environment accepts action only.');
      return environmentHelp();
    }
    if(actionDescriptor.value==='audit') {
      const descriptors=Object.getOwnPropertyDescriptors(request);
      if(Reflect.ownKeys(descriptors).length!==2||!descriptors.design?.enumerable||!Object.hasOwn(descriptors.design,'value')) throw new Error('audit accepts action and design data only.');
      return auditDesign(descriptors.design.value);
    }
    if(['plan','compile'].includes(actionDescriptor?.value)) return prepareCreation(request);
    const cwd=await ctx.workingDirectory.ensure(agent,signal);
    const policy=ctx.sandboxPolicy.resolve({session:agent.session});
    if(policy.mode==='read-only' && ['create','update','render'].includes(request?.action)) throw new Error('Session is read-only; GIF project writes and rendering are denied.');
    if(policy.mode==='workspace-write' && ['create','update','render'].includes(request?.action)) {
      const root=await realpath(policy.workspaceRoot);
      const target=await realpath(cwd);
      const relative=path.relative(root,target);
      if(relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('GIF project is outside the session workspace-write boundary.');
    }
    if(ctx.fs.processPathFromHostPath(cwd)!==cwd) throw new Error('GIF Creator currently requires a shared local filesystem provider.');
    return operations.run(agent.session.id,cwd,request,signal);
  }
  ctx.tools.register({name:'gif_creator',description:'Show the insight with GIF: source-grounded STEM explainers. environment returns portable Python setup guidance; read scripts and request user authorization before downloads/native dependency changes. Never alter DSH bundled Python. Create/edit/render source-grounded technical-blog GIFs. plan {brief} returns bounded multiple-choice intake questions (domain, representation, duration/theme, evidence) plus a multidimensional relation-first design guide: topology/time/ownership/dependency/quantity/state/feedback before choosing DSL, layout and motion. audit {design} is read-only static lint for ghost sources, unjustified copies, shared axes and clip redundancy; it does not render the design. The receiving Agent authors the design, not an internal model. compile {draft:{language,code,title,summary,durationSeconds}} accepts safe subsets: Mermaid flowchart with separately declared labeled nodes and arrows; PlantUML rectangle/arrow; D2 flat labeled nodes/arrows; Vega v5 inline line/bar with x/y scales and axes (no URLs/signals/transforms). Unsupported syntax fails; compile returns a reviewable storyboard without writing. Use unified symbols: labeled record blocks for data, fixed containers for partitions, tensor grids, operators and muted routes; motion must explain changes, not decorate. For narrative design prefer one coherent system canvas, one focal relation group and synchronized tracks rather than one GIF per arrow; choose rich layout, displacement, shape/size/value encoding only with explicit meaning and evidence. General multi-view motion is design-only until implemented. One project exports one GIF; separate scenes are segments, not separate GIF files. Generic DSL graphs currently render progressive diagrams; do not claim inferred entity movement or general hybrid composition. technical currently supports only spark_reduce_by_key with partitions, finalHoldSeconds and sketch, nodes=[]/edges=[], one5–10s scene; routing is illustrative, counts derived. sketch currently has no visual effect. First create a reviewable storyboard; preserve all numbers, units, negations and conditions. Evidence must quote exact source text; matching excerpts are not proof of semantic correctness. Layouts: flow/cause need explicit edges; compare has exactly two nodes and no edges; hierarchy must be a DAG. chart uses nodes=[]/edges=[] plus chart {type:line|bar,xLabel,yLabel,yUnit,baseline,categories,series:[{id,label,values}]}; 2–12 categories,1–3 series, finite values matching categories. Bars require baseline0/nonnegative values; lines require values>=baseline. Preserve exact units/data, never infer missing measurements; fixed axes across animation. One idea per scene; diagrams2–6 nodes,3–30 seconds,1–12 scenes,<=128 KiB JSON. Never claim human approval or invent relationships. list/get return current UUID/revision; update/render/media require that revision. Files remain in the receiving session workspace. There is no Web UI: inspect rendered GIF/PNG files directly in the session workspace.',parameters:toolParameters,
    output:{schema:{oneOf:[{type:'object',additionalProperties:true},{type:'array',items:{type:'object',additionalProperties:true}}]},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:(args,exec)=>run(exec.agent,args,exec.signal)});
}
export default {name,inject,apply};
