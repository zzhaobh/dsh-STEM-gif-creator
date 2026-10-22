import { validateStoryboard } from './schema.js';
import { relationshipPolicy } from './authoring.js';

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
function intakePlan(brief) {
  const numeric=/统计|分布|曲线|指标|数据点|statistic|chart|metric/i.test(brief);
  const spark=/spark|shuffle|reducebykey|reduce_by_key|集群|分布式/i.test(brief);
  const graph=/流程|关系|架构|因果|拓扑|状态机|flow|architecture|graph|pipeline/i.test(brief);
  const rec=(label,description)=>({label:`${label}（推荐）`,description});
  const representation=spark
    ? {base:'机制动画 · Spark 模板',...rec('机制动画 · Spark 模板','当前唯一内置实体运动模板，仅 reduceByKey')}
    : numeric ? {base:'数据图表',...rec('数据图表','固定坐标轴、真实数据与单位（Vega/Matplotlib）')}
    : {base:'关系图 · 静态推进',...rec('关系图 · 静态推进','Mermaid/PlantUML/D2 安全子集，固定布局+逐步强调')};
  const alternatives=[
    {label:'数据图表',description:'固定坐标轴、真实数据与单位（Vega/Matplotlib）'},
    {label:'关系图 · 静态推进',description:'Mermaid/PlantUML/D2 安全子集，固定布局+逐步强调'},
    {label:'机制动画 · Spark 模板',description:'当前唯一内置实体运动模板，仅 reduceByKey'},
    {label:'先出静态总览图',description:'再决定是否动画'},
  ].filter(option=>option.label!==representation.base);
  const domain=numeric?'统计学习':spark?'分布式系统':graph?'系统设计':'深度学习';
  return {
    note:'Ask at most three bounded questions before authoring; skip anything the user already answered and proceed with these recommended defaults when the user accepts them.',
    questions:[
      {id:'domain',header:'领域',question:'这个 GIF 属于哪个主题？',multiSelect:false,options:[{label:`${domain}（按 brief 推荐）`,description:'来自当前 brief 的关键词推断，可改选'},{label:'深度学习',description:'张量、注意力、训练机制'},{label:'统计学习',description:'抽样、估计、不确定性'},{label:'分布式系统',description:'shuffle、复制、故障'},{label:'系统设计',description:'缓存、队列、请求路径'},{label:'其他（请补充一句）',description:'自由主题，仍按关系优先流程设计'}]},
      {id:'representation',header:'表现形式',question:'先做哪种输出？',multiSelect:false,options:[representation,...alternatives]},
      {id:'format',header:'时长与配色',question:'GIF 时长和配色选哪个？',multiSelect:false,options:[{label:'8 秒 · 浅色（推荐）',description:'5–10s 叙事，末停 1–2s'},{label:'5 秒 · 浅色',description:'更短的单一关系'},{label:'10 秒 · 浅色',description:'两段式，但仅一个关系'},{label:'8 秒 · 深色',description:'深色画布，同长度'}]},
      {id:'evidence',header:'证据来源',question:'内容依据从哪来？',multiSelect:false,options:[{label:'用户提供的原文或数据（推荐）',description:'引用精确片段与数值，不补造数字'},{label:'公开资料（需标注来源）',description:'给出链接与引用，区分测量/计算/示意'},{label:'纯合成示意',description:'明确标注 synthetic，不伪装真实结果'}]},
    ],
    defaults:{domain,representation:representation.base,format:'8 秒 · 浅色',evidence:'用户提供的原文或数据'},
    rules:['最多问三个问题，只保留与本次 brief 相关的问题；每个问题 2–6 个选项，推荐项放第一。','已由用户明确的内容不要重复问；用户说“用推荐”时直接采用 defaults。','优先用 DSH 的选择题工具（ask_user_question），多选仅在确实需要多个值时开启；没有该工具时在对话中给编号选项。','只有用户选择“其他/自填”时才请求一句补充，不要改成开放式长问卷。'],
  };
}
export function planDsl(brief) {
  if(typeof brief!=='string'||!brief.trim()||Buffer.byteLength(brief)>8192) throw new TypeError('brief: nonblank text <=8 KiB required');
  const numeric=/统计|分布|曲线|指标|数据点|statistic|chart|metric/i.test(brief);
  return {status:'planned',author:'receiving_agent',recommendedLanguages:numeric?['vega','mermaid']:['d2','mermaid','plantuml'],
    intake:intakePlan(brief),
    relationshipPlan:relationshipPolicy,
    checklist:['Define the whole system and its relations before choosing frames or splitting GIFs.','Define the reader question, input, one key change and outcome.','Draft one or two DSL candidates; compare information coverage, not decoration.','Keep containers/axes fixed; use labeled entities for movement, paths only as background.','Use one persistent relational canvas with synchronized tracks; one focus group may span many views. Split only for independent questions or verified legibility limits.','Preserve source data, units, conditions and uncertainty; disclose synthetic examples.','STEM: state tensor dimensions, coordinate scales and units; distinguish measurement, calculation and illustration.','Check conservation, dimensional compatibility and statistical meaning; correlation is not causation, acknowledgements are not commits.','Compile a supported subset; review warnings before create/render.'],
    motionPlan:{guide:'docs/manim-authoring.md',visualThesis:'Write one source-grounded sentence stating the relation that motion will reveal.',sceneContract:'A 5–10 second GIF explains one coherent system question using its related entities together. Prefer one persistent relational layout; split only after relation coverage and legibility review, never one GIF per entity or arrow.',requiredFields:['readerQuestion','sourceEvidence','stableAnchors','entityIdentities','eventTimeline','whatChanges','whatRemainsFixed','finalConclusion','verificationInvariants'],process:['Inspect evidence and choose a supported representation.','Sketch the smallest native scene with readable labels and one focal event.','Render and inspect active-event and final frames before polishing.','Verify decoded duration, final 1–2 second hold, entity conservation and declared meanings.'],defaultDeliverables:['GIF','static overview','decoded metrics'],backendPolicy:'Use a validated built-in technical template for concrete Manim entity motion. Do not execute generated Python or raw Manim code through the tool.',scope:'Spark template is integrated; VLA prototype is not yet a supported tool template. MP4/social-video assembly is not the default.'},
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
