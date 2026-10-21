import { validateStoryboard } from './schema.js';

export const dslParameters = { type:'object', additionalProperties:false,
  required:['language','code','title','summary','durationSeconds'], properties:{
    language:{type:'string',enum:['mermaid','plantuml','d2','vega']},
    code:{type:'string',description:'Exact DSL text, <=32 KiB. Only the documented safe subset is accepted; no includes, URLs, expressions or scripts.'},
    title:{type:'string'},summary:{type:'string'},durationSeconds:{type:'integer'},
  } };
const ID='[A-Za-z][A-Za-z0-9_-]{0,39}';
function exact(value, keys, at) {
  if (!value || Object.getPrototypeOf(value)!==Object.prototype) throw new TypeError(`${at}: expected plain object`);
  const properties=Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(properties).length!==keys.length || keys.some(k=>!Object.hasOwn(properties,k))) throw new TypeError(`${at}: unexpected or missing fields`);
  for(const [k,d] of Object.entries(properties)) if(!d.enumerable || !Object.hasOwn(d,'value')) throw new TypeError(`${at}.${k}: accessors forbidden`);
}
function allowed(value, keys, at) {
  if (!value || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).some(k=>!keys.includes(k))) throw new TypeError(`${at}: unsupported properties`);
}
export function planDsl(brief) {
  if(typeof brief!=='string'||!brief.trim()||Buffer.byteLength(brief)>8192) throw new TypeError('brief: nonblank text <=8 KiB required');
  const numeric=/统计|分布|曲线|指标|数据点|statistic|chart|metric/i.test(brief);
  return {status:'planned',author:'receiving_agent',recommendedLanguages:numeric?['vega','mermaid']:['d2','mermaid','plantuml'],
    checklist:['Define the reader question, input, one key change and outcome.','Draft one or two DSL candidates; compare information coverage, not decoration.','Keep containers/axes fixed; use labeled entities for movement, paths only as background.','At most two main views in a 5–10 second story; synchronize by explicit event and identity.','Preserve source data, units, conditions and uncertainty; disclose synthetic examples.','STEM: state tensor dimensions, coordinate scales and units; distinguish measurement, calculation and illustration.','Check conservation, dimensional compatibility and statistical meaning; correlation is not causation, acknowledgements are not commits.','Compile a supported subset; review warnings before create/render.'],
    limitations:['This is an authoring guide, not an internal LLM call.','Generic DSL graphs currently render as progressive diagrams, not inferred data-flow motion.','General hybrid views and full DSL grammars are not implemented.']};
}
function graph(language, code) {
  const nodes=[],edges=[];
  const lines=code.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(language==='mermaid') {if(!/^flowchart (LR|TD|TB)$/.test(lines.shift()??'')) throw new TypeError('mermaid: require flowchart LR/TD/TB');}
  if(language==='plantuml') {if(lines.shift()!=='@startuml'||lines.pop()!=='@enduml') throw new TypeError('plantuml: require exact @startuml/@enduml envelope');}
  const nodePatterns={mermaid:new RegExp(`^(${ID})\\[(?:"([^"\\n]+)"|([^\\]"\\n]+))\\]$`),plantuml:new RegExp(`^rectangle "([^"\\n]+)" as (${ID})$`),d2:new RegExp(`^(${ID}): "([^"\\n]+)"$`)};
  const edgePatterns={mermaid:new RegExp(`^(${ID}) --> (?:(?:\\|([^|\\n]+)\\|) ?)?(${ID})$`),plantuml:new RegExp(`^(${ID}) --> (${ID})(?: : ([^\\n]+))?$`),d2:new RegExp(`^(${ID}) -> (${ID})(?: : "([^"\\n]+)")?$`)};
  for(const [i,line] of lines.entries()) {
    const n=line.match(nodePatterns[language]);
    if(n) {nodes.push({id:language==='plantuml'?n[2]:n[1],label:language==='plantuml'?n[1]:n[2]??n[3],detail:''});continue;}
    const e=line.match(edgePatterns[language]);
    if(e) {edges.push({from:e[1],to:language==='mermaid'?e[3]:e[2],label:language==='mermaid'?e[2]??'':e[3]??''});continue;}
    throw new TypeError(`${language}: unsupported statement ${i+1}: ${line.slice(0,100)}`);
  }
  return {layout:edges.length?'flow':'hierarchy',nodes,edges};
}
function vega(code) {
  let spec;try{spec=JSON.parse(code);}catch{throw new TypeError('vega: invalid JSON');}
  allowed(spec,['$schema','data','scales','axes','marks'],'vega');
  if(spec.$schema!=='https://vega.github.io/schema/vega/v5.json') throw new TypeError('vega: only Vega v5 (not Vega-Lite)');
  if(!Array.isArray(spec.data)||spec.data.length!==1) throw new TypeError('vega.data: one inline dataset required');
  const data=spec.data[0];exact(data,['name','values'],'vega.data');
  if(typeof data.name!=='string'||!Array.isArray(data.values)||data.values.length<2||data.values.length>12) throw new TypeError('vega.data: 2–12 inline rows required');
  if(!Array.isArray(spec.scales)||spec.scales.length!==2||!Array.isArray(spec.axes)||spec.axes.length!==2||!Array.isArray(spec.marks)||spec.marks.length!==1) throw new TypeError('vega: exactly x/y scales, axes and one mark required');
  const [x,y]=spec.scales;exact(x,['name','type','domain','range'],'x scale');exact(y,['name','type','domain','range','zero'],'y scale');
  exact(x.domain,['data','field'],'x domain');exact(y.domain,['data','field'],'y domain');
  for(const field of [x.domain.field,y.domain.field]) if(typeof field!=='string'||!field.length||/[.\[\]\\]/.test(field)) throw new TypeError('vega: only flat string field names, no field paths');
  if(x.domain.field===y.domain.field) throw new TypeError('vega: categorical and numeric fields must differ');
  if(x.name!=='x'||!['band','point'].includes(x.type)||x.range!=='width'||y.name!=='y'||y.type!=='linear'||y.range!=='height'||y.zero!==true||x.domain.data!==data.name||y.domain.data!==data.name) throw new TypeError('vega: supported scales x band/point, y linear zero=true');
  const axes={};for(const a of spec.axes){exact(a,['scale','orient','title'],'axis');if(axes[a.scale])throw new TypeError('duplicate axis');axes[a.scale]=a;}
  if(axes.x?.orient!=='bottom'||axes.y?.orient!=='left')throw new TypeError('vega: bottom x and left y axes required');
  const mark=spec.marks[0];exact(mark,['type','from','encode'],'mark');exact(mark.from,['data'],'mark.from');exact(mark.encode,['update'],'mark.encode');
  if(!['line','rect'].includes(mark.type)||mark.from.data!==data.name)throw new TypeError('vega: line/rect from inline dataset only');
  const bar=mark.type==='rect', enc=mark.encode.update;
  if(!bar && x.type!=='point') throw new TypeError('vega: line requires point scale; band alignment is not supported');
  exact(enc,bar?['x','y','y2','width']:['x','y'],'mark.update');
  exact(enc.x,['scale','field'],'mark.x');exact(enc.y,['scale','field'],'mark.y');
  if(enc.x.scale!=='x'||enc.x.field!==x.domain.field||enc.y.scale!=='y'||enc.y.field!==y.domain.field)throw new TypeError('vega: mark/domain fields must agree');
  if(bar){exact(enc.y2,['scale','value'],'mark.y2');exact(enc.width,['scale','band'],'mark.width');if(x.type!=='band'||enc.y2.scale!=='y'||enc.y2.value!==0||enc.width.scale!=='x'||enc.width.band!==1)throw new TypeError('vega: bars require band width=1 and y2=0');}
  const categories=[],values=[];
  for(const row of data.values){exact(row,[x.domain.field,y.domain.field],'data row');if(typeof row[x.domain.field]!=='string'||typeof row[y.domain.field]!=='number')throw new TypeError('vega: categorical strings and numeric values only');categories.push(row[x.domain.field]);values.push(row[y.domain.field]);}
  return {layout:'chart',nodes:[],edges:[],chart:{type:bar?'bar':'line',xLabel:axes.x.title,yLabel:axes.y.title,yUnit:'',baseline:0,categories,series:[{id:'series',label:axes.y.title,values}]}};
}
export function compileDsl(draft) {
  exact(draft,['language','code','title','summary','durationSeconds'],'draft');
  if(!['mermaid','plantuml','d2','vega'].includes(draft.language))throw new TypeError('unsupported DSL');
  if(typeof draft.code!=='string'||!draft.code.trim()||Buffer.byteLength(draft.code)>32768)throw new TypeError('code: nonblank text <=32 KiB required');
  const scene=draft.language==='vega'?vega(draft.code):graph(draft.language,draft.code);
  const storyboard=validateStoryboard({title:draft.title,source:draft.code,scenes:[{id:'dsl',title:draft.title,summary:draft.summary,durationSeconds:draft.durationSeconds,evidence:[draft.code.slice(0,4000)],...scene}]});
  return {storyboard,warnings:['DSL source is preserved; matching evidence is not proof of scientific correctness.',...(scene.layout==='chart'?['Units are not inferred; include exact units in axis titles.']:['Layout direction and source-specific styling are not preserved by the current graph renderer.','Edges are declared relationships, not inferred causal or data-transfer semantics.','Rendering currently uses progressive diagram emphasis; rich entity motion requires an explicit technical template.'])],capabilities:{language:draft.language,mode:'safe_subset',externalEvaluation:false}};
}
export function prepareCreation(request) {
  const action=Object.getOwnPropertyDescriptor(request??{},'action');
  if(!action || !Object.hasOwn(action,'value') || !['plan','compile'].includes(action.value)) throw new TypeError('request.action: plan/compile data property required');
  exact(request,action.value==='plan'?['action','brief']:['action','draft'],'request');
  return request.action==='plan'?planDsl(request.brief):compileDsl(request.draft);
}
