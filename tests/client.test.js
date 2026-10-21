import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { validateStoryboard } from '../schema.js';
function load() {
  let registration; const filename = new URL('../client.js', import.meta.url);
  assert.ok(fs.existsSync(filename), 'native client module must exist');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { window: { __ModuleLoader__: { load(value) { registration = value; } } }, AbortController, Blob, Uint8Array, atob, TextEncoder });
  assert.equal(registration.id, 'dsh-stem-gif-creator');
  return registration.factory(name => { assert.equal(name, 'react'); return {}; });
}
const success = value => ({ ok: true, value: { commandId: 'command', result: { kind: 'success', text: JSON.stringify(value) } } });
const project = { id: 'be54c6c1-038a-4565-82da-06585129b7fd', revision: 3, title: 'T', source: 'S', scenes: [] };
test('registers only owned main page and matching sidebar contribution', () => {
  const mod = load(); const entries = []; const owners = []; const dictionaries = [];
  assert.deepEqual(Array.from(mod.inject), ['slots', 'locale', 'sessions']);
  mod.apply({ effect(fn) { return fn(); }, locale: { register(...args) { dictionaries.push(args); return () => {}; }, bind() { return key => key; } }, sessions: {}, slots: { inject(name, callback) { owners.push(name); callback(); }, register(options, component) { entries.push({ options, component }); } } });
  assert.deepEqual(owners, ['main', 'sidebar.panellist']); assert.equal(entries[0].options.key, 'gif-creator'); assert.equal(entries[1].options.id, 'gif-creator'); assert.equal(typeof entries[0].component, 'function'); assert.equal(typeof entries[1].options.label, 'function'); assert.ok(dictionaries.length > 0);
});
test('unwraps exact RemoteResult CommandExecution payload including list arrays', () => {
  const h = load().helpers; assert.equal(h.unwrap(success(project)).revision, 3); assert.equal(h.unwrap(success([project]))[0].id, project.id);
});
test('remote and command errors never masquerade as projects', () => {
  const h = load().helpers;
  assert.throws(() => h.unwrap({ ok: false, error: { code: 'DENIED', message: 'No access' } }), /No access/);
  assert.throws(() => h.unwrap({ ok: true, value: { result: { kind: 'error', text: 'Revision conflict' } } }), /Revision conflict/);
  for (const value of [{ ok: true }, { ok: true, value: { result: { kind: 'success', text: 'not json' } } }]) assert.throws(() => h.unwrap(value));
});
test('update render and media carry CAS revision and zero-based scene index', () => {
  const h = load().helpers; assert.equal(h.request('update', project, { storyboard: { title: 'Edit', source: 'S', scenes: [] } }).expectedRevision, 3);
  const media = h.request('media', project, { kind: 'scene', sceneIndex: 0 }); assert.equal(media.sceneIndex, 0); assert.equal(media.expectedRevision, 3);
  assert.equal(h.request('render', project, { theme: 'dark' }).expectedRevision, 3); assert.throws(() => h.request('render', null)); assert.throws(() => h.request('get', { ...project, id: '../unsafe' }));
});
test('editor emits only storyboard fields and detects unsaved changes', () => {
  const h = load().helpers; const text = h.editorText(project); assert.deepEqual(Object.keys(JSON.parse(text)), ['title', 'scenes']); assert.equal(h.isDirty(project, text, 'S'), false); assert.equal(h.isDirty(project, text, 'Changed'), true); assert.equal(h.isDirty(project, '{', 'S'), true); assert.equal(h.parseEditor(text, 'Source').source, 'Source');
});
test('example passes actual storyboard validator with source numbers and conditions', () => {
  const example = JSON.parse(JSON.stringify(load().helpers.example())); assert.doesNotThrow(() => validateStoryboard(example)); assert.match(example.source, /20/); assert.match(example.source, /not/);
});
test('operation uses explicit session, acquired binding, scoped command and signal', async () => {
  const h = load().helpers; let observed;
  const sessions = { async using(id, options, callback) { observed = { id, options }; return callback({ binding: { ctx: { remote: { commands: { async execute(line, attachments, signal) { observed.line = line; observed.attachments = attachments; observed.signal = signal; return success([]); } } } } } }); } };
  const controller = new AbortController(); const result = await h.execute(sessions, 'session-exact', { action: 'list' }, controller.signal);
  assert.equal(result.length, 0); assert.equal(observed.id, 'session-exact'); assert.equal(observed.options.source, 'controllerOperation'); assert.equal(observed.line, '/gif-creator {"action":"list"}'); assert.equal(observed.attachments.length, 0); assert.equal(observed.signal, controller.signal);
  await assert.rejects(h.execute(sessions, '', { action: 'list' }, controller.signal));
});
test('changing selection aborts pending work and suppresses stale completion', async () => {
  const runner = load().helpers.operationScope(); let finish; let received;
  const pending = runner.run(signal => { received = signal; return new Promise(resolve => { finish = resolve; }); }); runner.reset(); assert.equal(received.aborted, true); finish('old'); assert.equal((await pending).current, false); assert.equal((await runner.run(async () => 'new')).value, 'new');
});
test('cancel suppresses settlement even when transport ignores abort', async () => {
  const runner = load().helpers.operationScope(); let finish; const pending = runner.run(() => new Promise(resolve => { finish = resolve; })); runner.cancel(); finish('cancelled'); assert.equal((await pending).current, false);
});
test('media decoder enforces MIME, basename, base64 and 16 MiB bound', () => {
  const h = load().helpers; assert.equal(h.mediaBlob({ base64: 'R0lG', mime: 'image/gif', name: 'animation.gif' }).size, 3);
  for (const media of [{ base64: '!', mime: 'image/png', name: 'scene-1.png' }, { base64: '', mime: 'text/html', name: 'x.html' }, { base64: '', mime: 'image/png', name: '../x.png' }, { base64: 'AAAA'.repeat(5592406), mime: 'image/png', name: 'overview.png' }]) assert.throws(() => h.mediaBlob(media));
});
test('large valid media decodes without regular-expression stack exhaustion', () => {
  const h = load().helpers;
  assert.equal(h.mediaBlob({ base64: Buffer.alloc(16 * 1024 * 1024).toString('base64'), mime: 'image/png', name: 'overview.png' }).size, 16 * 1024 * 1024);
});
test('object URL ownership revokes replaced and all unmounted blobs', () => {
  const h = load().helpers; const revoked = []; let n = 0; const urls = h.blobURLs({ createObjectURL() { return `blob:${++n}`; }, revokeObjectURL(url) { revoked.push(url); } }); urls.set('scene', new Blob()); urls.set('scene', new Blob()); urls.set('gif', new Blob()); urls.clear(); assert.deepEqual(revoked, ['blob:1', 'blob:2', 'blob:3']);
});

test('current artifacts require revision equality', () => {
  const h = load().helpers; assert.equal(h.hasMedia({ ...project, artifacts: { revision: 2 } }), false); assert.equal(h.hasMedia({ ...project, artifacts: { revision: 3 } }), true);
});

test('chart example includes an explicit source dataset, units, and valid zero-baseline bars', () => {
  const example = JSON.parse(JSON.stringify(load().helpers.example()));
  assert.ok(example.scenes.some(scene => scene.layout === 'chart'));
  const chart = example.scenes.find(scene => scene.layout === 'chart').chart;
  assert.deepEqual(Array.from(chart.categories), ['第一周', '第二周', '第三周', '第四周']);
  assert.equal(chart.yUnit, '人次');
  assert.equal(chart.baseline, 0);
  assert.deepEqual(chart.series[0].values, [120, 150, 135, 180]);
  assert.ok(example.source.includes('第一周 120 人次'));
  assert.doesNotThrow(() => validateStoryboard(example));
});

test('chart exemplar validates and English/Chinese layout dictionaries stay in sync', () => {
  const exemplar = JSON.parse(fs.readFileSync(new URL('../examples/charts.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validateStoryboard(exemplar));
  const registered = new Map();
  load().apply({ effect(fn) { return fn(); }, locale: { register(ns, language, dictionary) { registered.set(language, dictionary); return () => {}; }, bind() { return key => key; } }, sessions: {}, slots: { inject(name, callback) { callback(); }, register() {} } });
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(fs.readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'));
    for (const key of ['chartType', 'xLabel', 'yLabel', 'unit', 'dimensionless', 'baseline', 'layoutFlow', 'layoutCause', 'layoutCompare', 'layoutHierarchy', 'layoutChart', 'chartLine', 'chartBar']) {
      assert.equal(registered.get(language)[key], locale.ui[key]);
    }
  }
});

test('technical details show inputs and derived expectations without claiming Spark execution', () => {
  const h = load().helpers;
  const example = JSON.parse(fs.readFileSync(new URL('../examples/spark.json', import.meta.url), 'utf8'));
  const translations = { technicalTemplate: 'Template', technicalInputs: 'Input partitions', technicalExpected: 'Derived expected counts (not Spark result)', technicalFinalHold: 'Final hold', technicalSketch: 'Sketch', seconds: 'seconds', yes: 'yes', no: 'no' };
  const details = h.technicalDetails(example.scenes[0], key => translations[key]);
  assert.match(details, /spark_reduce_by_key/);
  assert.match(details, /P0: \[spark, data, spark\]/);
  assert.match(details, /Derived expected counts \(not Spark result\): spark: 2, data: 2, ai: 1/);
  assert.match(details, /Final hold: 2 seconds/);
  assert.match(details, /Sketch: no/);
  const zh = JSON.parse(fs.readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8')).ui;
  assert.match(h.technicalDetails(example.scenes[0], key => zh[key]), /推导的预期计数（非 Spark 实际结果）/);
  assert.deepEqual(JSON.parse(JSON.stringify(h.parseEditor(h.editorText(example), example.source))), example);
  assert.equal(h.technicalDetails({ layout: 'flow' }), '');
});

test('chart scene summary exposes labels, unit, baseline, categories, and all series values', () => {
  const h = load().helpers;
  const scene = { layout: 'chart', chart: { type: 'bar', xLabel: 'Month', yLabel: 'Sales', yUnit: 'USD', baseline: 0, categories: ['Jan', 'Feb'], series: [{ id: 'sales', label: 'Sales', values: [3, 5] }] } };
  assert.match(h.chartDetails(scene), /Month/);
  assert.match(h.chartDetails(scene), /Sales/);
  assert.match(h.chartDetails(scene), /USD/);
  assert.match(h.chartDetails(scene), /baseline: 0/i);
  assert.match(h.chartDetails(scene), /Jan 3/);
  assert.match(h.chartDetails(scene), /Feb 5/);
  const zh = key => ({ chartType: '图表类型', xLabel: '横轴', yLabel: '纵轴', unit: '单位', dimensionless: '无量纲', baseline: '基线', chartBar: '柱状图', chartLine: '折线图' })[key];
  assert.match(h.chartDetails(scene, zh), /图表类型: 柱状图/);
  assert.match(h.chartDetails(scene, zh), /横轴: Month/);
  assert.match(h.chartDetails(scene, zh), /基线: 0/);
});
