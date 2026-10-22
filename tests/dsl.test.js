import test from 'node:test';
import assert from 'node:assert/strict';
import {compileDsl,planDsl,prepareCreation} from '../dsl.js';
const draft=(language,code)=>({language,code,title:'机制示意',summary:'声明结构，核对原文。',durationSeconds:8});
test('three graph DSL subsets retain exact nodes relationships and source',()=>{
 for(const [language,code] of [['mermaid','flowchart LR\nA["输入"]\nB["输出"]\nA --> |转换| B'],['plantuml','@startuml\nrectangle "输入" as A\nrectangle "输出" as B\nA --> B : 转换\n@enduml'],['d2','A: "输入"\nB: "输出"\nA -> B : "转换"']]){
  const result=compileDsl(draft(language,code));assert.equal(result.storyboard.source,code);assert.equal(result.storyboard.scenes[0].nodes[0].label,'输入');assert.equal(result.storyboard.scenes[0].edges[0].label,'转换');assert.equal(result.capabilities.externalEvaluation,false);
 }
});
const spec=()=>({$schema:'https://vega.github.io/schema/vega/v5.json',data:[{name:'table',values:[{category:'A',value:2},{category:'B',value:3}]}],scales:[{name:'x',type:'band',domain:{data:'table',field:'category'},range:'width'},{name:'y',type:'linear',domain:{data:'table',field:'value'},range:'height',zero:true}],axes:[{scale:'x',orient:'bottom',title:'类别'},{scale:'y',orient:'left',title:'数量（合成示例）'}],marks:[{type:'rect',from:{data:'table'},encode:{update:{x:{scale:'x',field:'category'},y:{scale:'y',field:'value'},y2:{scale:'y',value:0},width:{scale:'x',band:1}}}}]});
test('Vega v5 inline bar preserves exact data and zero baseline',()=>{const r=compileDsl(draft('vega',JSON.stringify(spec())));assert.deepEqual(r.storyboard.scenes[0].chart.series[0].values,[2,3]);assert.equal(r.storyboard.scenes[0].chart.baseline,0);});
test('reject unknown statements and dangerous DSL imports rather than flatten',()=>{
 for(const [lang,code] of [['mermaid','flowchart LR\nsubgraph a'],['plantuml','@startuml\n!include secret\n@enduml'],['d2','A: "ok"\nimport: secret']])assert.throws(()=>compileDsl(draft(lang,code)),/unsupported/);
 const s=spec();s.data[0].url='file:///secret';assert.throws(()=>compileDsl(draft('vega',JSON.stringify(s))),/fields/);
 const e=spec();e.marks[0].encode.update.x.signal='evil';assert.throws(()=>compileDsl(draft('vega',JSON.stringify(e))),/fields/);
});
test('reject malformed, coercion, numeric/size bounds and unsupported shapes',()=>{
 assert.throws(()=>compileDsl(draft('mermaid','flowchart LR\nA[x]\nB[y]\nA --> C')),/endpoint|node|existing|reference/i);
 assert.throws(()=>compileDsl(draft('mermaid','x'.repeat(32769))),/32 KiB/);
 const s=spec();s.data[0].values[0].value='2';assert.throws(()=>compileDsl(draft('vega',JSON.stringify(s))),/numeric/);
 const s2=spec();s2.data[0].values[0].value=-1;assert.throws(()=>compileDsl(draft('vega',JSON.stringify(s2))),/baseline|nonnegative/i);
 let invoked=false;const d=draft('d2','A: "a"\nB: "b"');Object.defineProperty(d,'code',{get(){invoked=true;return '';},enumerable:true});assert.throws(()=>compileDsl(d),/accessors/);assert.equal(invoked,false);
});
test('plan is honest about receiving Agent authorship and unsupported hybrid engine',()=>{const p=planDsl('统计指标');assert.equal(p.recommendedLanguages[0],'vega');assert.equal(p.author,'receiving_agent');assert.ok(p.limitations.some(x=>x.includes('hybrid')));assert.throws(()=>prepareCreation({action:'plan',brief:'ok',unknown:true}),/fields/);});
test('Vega rejects field paths/non-string fields and line band semantics',()=>{
 for(const field of [null,42,'value.amount','value[0]']){const s=spec();s.scales[1].domain.field=field;s.marks[0].encode.update.y.field=field;assert.throws(()=>compileDsl(draft('vega',JSON.stringify(s))),/flat string/);}
 const s=spec();s.marks[0].type='line';delete s.marks[0].encode.update.y2;delete s.marks[0].encode.update.width;assert.throws(()=>compileDsl(draft('vega',JSON.stringify(s))),/point scale/);s.scales[0].type='point';assert.equal(compileDsl(draft('vega',JSON.stringify(s))).storyboard.scenes[0].chart.type,'line');
});
test('creation entry rejects getter without invocation',()=>{let count=0;const request={brief:'x'};Object.defineProperty(request,'action',{enumerable:true,get(){count++;return 'plan';}});assert.throws(()=>prepareCreation(request),/data property/);assert.equal(count,0);});
test('plan includes native Manim authoring contract without arbitrary Python execution',()=>{const p=planDsl('解释 VLA 同步');assert.equal(p.motionPlan.guide,'docs/manim-authoring.md');assert.ok(p.motionPlan.requiredFields.includes('verificationInvariants'));assert.deepEqual(p.motionPlan.defaultDeliverables,['GIF','static overview','decoded metrics']);assert.match(p.motionPlan.backendPolicy,/Do not execute generated Python/);assert.match(p.motionPlan.scope,/not yet/);});
test('plan includes relation-first design policy with encoding and design system',()=>{const p=planDsl('解释缓存命中与回源');assert.equal(p.relationshipPlan.relationDimensions.length,7);assert.equal(p.relationshipPlan.visualEncodingSystem.channels.length,8);assert.ok(p.relationshipPlan.designSystem.roles.includes('pointer'));assert.match(p.relationshipPlan.representationPolicy,/independently of DSL/);assert.match(p.relationshipPlan.capabilityTiers.designAudit,/lint only/);});
test('plan turns customization into bounded multiple-choice intake',()=>{const p=planDsl('解释 Spark shuffle 的 reduceByKey');const q=p.intake.questions;assert.equal(q.length,4);assert.deepEqual(q.map(x=>x.id),['domain','representation','format','evidence']);for(const x of q){assert.ok(x.options.length>=2&&x.options.length<=6,x.id);assert.ok(x.options[0].label.includes('推荐'),x.id);assert.equal(x.multiSelect,false);}assert.equal(p.intake.defaults.domain,'分布式系统');assert.match(p.intake.defaults.representation,/^机制动画/);assert.match(p.intake.rules[0],/最多问三个/);assert.match(p.intake.rules[2],/ask_user_question/);const numeric=planDsl('画统计指标曲线');assert.match(numeric.intake.defaults.representation,/^数据图表/);assert.equal(numeric.intake.defaults.domain,'统计学习');const conceptual=planDsl('解释缓存回源流程');assert.match(conceptual.intake.defaults.representation,/^关系图/);assert.equal(conceptual.intake.defaults.domain,'系统设计');});
export {spec};
