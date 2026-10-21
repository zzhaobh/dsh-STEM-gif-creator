import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
let createOperations;
try { ({ createOperations } = await import('../operations.js')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
let validator;
try { ({ validateStoryboard: validator } = await import('../schema.js')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
validator ??= v => { assert.deepEqual(Object.keys(v).sort(), ['scenes', 'source', 'title']); return structuredClone(v); };
const fixture = () => ({ title: 'Conditional transfer', source: 'Only below 30 °C, transfer 2 kg. Do not exceed 2 kg.', scenes: [{
 id: 's1', layout: 'cause', title: 'Condition', summary: 'Only below 30 °C, transfer 2 kg. Do not exceed 2 kg.', durationSeconds: 5,
 evidence: ['Only below 30 °C, transfer 2 kg.', 'Do not exceed 2 kg.'], nodes: [{ id: 'a', label: 'Below 30 °C', detail: 'Only below 30 °C' },
 { id: 'b', label: 'Transfer 2 kg', detail: 'Do not exceed 2 kg.' }], edges: [{ from: 'a', to: 'b', label: 'only if' }] }] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const session = '../../arbitrary/session';
const scope = cwd => path.join(cwd, '.gif-creator', createHash('sha256').update(session).digest('hex'));
async function setup(t, options = {}) {
 assert.equal(typeof createOperations, 'function', 'missing operations module');
 const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gif-operations-owned-'))); const canonical = cwd;
 t.after(async () => { assert.equal(await fs.realpath(cwd), canonical); assert.equal(path.dirname(canonical), await fs.realpath(os.tmpdir()));
 assert.ok(path.basename(canonical).startsWith('gif-operations-owned-')); assert.ok((await fs.lstat(cwd)).isDirectory()); await fs.rm(cwd, { recursive: true, force: true }); });
 const op = createOperations({ validateStoryboard: validator, ...options }); const run = (r, s) => op.run(session, cwd, r, s);
 return { cwd, op, run, project: () => run({ action: 'create', storyboard: fixture() }) };
}
async function outputs({ outputDir, storyboard, theme, signal }) {
 assert.ok(['light', 'dark'].includes(theme)); assert.equal(storyboard.scenes[0].layout, 'cause'); assert.ok(!signal?.aborted);
 for (const [name, bytes] of [['animation.gif', 'GIF89a'], ['overview.png', 'PNG overview'], ['scene-1.png', 'PNG scene']]) await fs.writeFile(path.join(outputDir, name), bytes);
 const metrics = { width: 1280, height: 720, frameCount: 10, durationSeconds: 5 }; await fs.writeFile(path.join(outputDir, 'metrics.json'), JSON.stringify(metrics)); return metrics;
}
test('create/get preserve storyboard and session isolation', async t => {
 const { cwd, op, run, project } = await setup(t); const p = await project(); assert.match(p.id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
 assert.equal(p.revision, 1); assert.equal(p.sessionId, session); assert.equal(p.version, 1); assert.deepEqual({ title: p.title, source: p.source, scenes: p.scenes }, fixture());
 assert.deepEqual(await run({ action: 'get', id: p.id }), p); await assert.rejects(op.run('other', cwd, { action: 'get', id: p.id }), /not found/i);
 assert.deepEqual(await op.run('other', cwd, { action: 'list' }), []); assert.deepEqual(JSON.parse(await fs.readFile(path.join(scope(cwd), p.id, 'project.json'), 'utf8')), p);
});
test('strict requests reject traversal, unknown fields and invalid revisions', async t => {
 const { run, project } = await setup(t); const p = await project();
 for (const id of ['../x', p.id + '/..', '{' + p.id + '}', 'abc', p.id.toUpperCase(), p.id + '\n']) await assert.rejects(run({ action: 'get', id }), { code: 'INVALID_ID' });
 for (const r of [{ action: 'get', id: p.id, path: '/etc/passwd' }, { action: 'create', storyboard: fixture(), outputDir: '/tmp' }, { action: 'list', limit: 101 },
 { action: 'list', unknown: true }, { action: 'create', storyboard: { ...fixture(), injected: true } }]) await assert.rejects(run(r));
 for (const expectedRevision of [undefined, 0, -1, 1.5, '1', NaN]) for (const action of ['update', 'render', 'media'])
 await assert.rejects(run({ action, id: p.id, expectedRevision, ...(action === 'update' ? { storyboard: fixture() } : action === 'media' ? { kind: 'animation' } : {}) }), /revision/i);
});
test('CAS serializes two simultaneous edits across instances', async t => {
 const { cwd, run, project } = await setup(t); const p = await project(); const other = createOperations({ validateStoryboard: validator });
 const r = { action: 'update', id: p.id, expectedRevision: 1, storyboard: fixture() }; const results = await Promise.allSettled([run(r), other.run(session, cwd, r)]);
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.match(results.find(r => r.status === 'rejected').reason.message, /revision|conflict/i);
 assert.equal((await run({ action: 'get', id: p.id })).revision, 2); assert.deepEqual(await fs.readdir(path.join(scope(cwd), p.id)), ['project.json']);
});
test('list returns <=100 summaries without storyboard or artifact paths', async t => {
 const { run, project } = await setup(t); for (let i = 0; i < 100; i++) await project();
  for (let i = 0; i < 3; i++) await assert.rejects(project(), { code: 'STORAGE_QUOTA' });
  const list = await run({ action: 'list' }); assert.equal(list.length, 100);
 for (const p of list) { assert.equal(p.revision, 1); assert.ok(!('source' in p)); assert.ok(!('scenes' in p)); assert.ok(!('artifacts' in p)); }
});
for (const layer of ['root', 'session', 'project']) test(`reject ${layer} symlink escapes`, async t => {
 const { cwd, run } = await setup(t); const outside = path.join(cwd, 'outside'); await fs.mkdir(outside); let r = { action: 'create', storyboard: fixture() };
 if (layer === 'root') await fs.symlink(outside, path.join(cwd, '.gif-creator'));
 if (layer === 'session') { await fs.mkdir(path.join(cwd, '.gif-creator')); await fs.symlink(outside, scope(cwd)); }
 if (layer === 'project') { await fs.mkdir(scope(cwd), { recursive: true }); const id = randomUUID(); await fs.symlink(outside, path.join(scope(cwd), id)); r = { action: 'get', id }; }
 await assert.rejects(run(r), /symlink|safe|scope|directory/i); assert.deepEqual(await fs.readdir(outside), []);
});
test('render/media revision contract and update invalidation', async t => {
 const { run, project } = await setup(t, { render: outputs }); const p = await project(); const r = await run({ action: 'render', id: p.id, expectedRevision: 1 });
 assert.equal(r.revision, 1); assert.equal(r.artifacts.revision, 1); assert.match(path.basename(r.artifacts.directory), /^render-1-[0-9a-f-]{36}$/); assert.equal(r.artifacts.metrics.width, 1280);
 for (const [kind, index, name, mime] of [['animation', undefined, 'animation.gif', 'image/gif'], ['overview', undefined, 'overview.png', 'image/png'], ['scene', 0, 'scene-1.png', 'image/png']]) {
 const m = await run({ action: 'media', id: p.id, expectedRevision: 1, kind, ...(index === undefined ? {} : { sceneIndex: index }) });
 assert.deepEqual(Object.keys(m).sort(), ['base64', 'mime', 'name']); assert.equal(m.name, name); assert.equal(m.mime, mime); assert.ok(Buffer.from(m.base64, 'base64').length); }
 assert.ok(!(await run({ action: 'update', id: p.id, expectedRevision: 1, storyboard: fixture() })).artifacts);
 await assert.rejects(run({ action: 'media', id: p.id, expectedRevision: 1, kind: 'animation' }), /revision|conflict/i);
 await assert.rejects(run({ action: 'media', id: p.id, expectedRevision: 2, kind: 'animation' }), /render|artifact/i);
});
test('concurrent render rejected and editing prevents stale publication', async t => {
 const entered = deferred(), release = deferred(); const render = async args => { entered.resolve(); await release.promise; return outputs(args); };
 const { cwd, run, project } = await setup(t, { render }); const p = await project(); const pending = run({ action: 'render', id: p.id, expectedRevision: 1 }); await entered.promise;
 await assert.rejects(createOperations({ render, validateStoryboard: validator }).run(session, cwd, { action: 'render', id: p.id, expectedRevision: 1 }), /render.*progress|concurrent|busy/i);
 await run({ action: 'update', id: p.id, expectedRevision: 1, storyboard: fixture() }); release.resolve(); await assert.rejects(pending, /revision|stale|conflict/i); assert.ok(!(await run({ action: 'get', id: p.id })).artifacts);
});
test('abort before writes and during render never publishes', async t => {
 const entered = deferred(), release = deferred(); const { cwd, run, project } = await setup(t, { render: async () => { entered.resolve(); await release.promise; return {}; } });
 const c = new AbortController(); c.abort(); await assert.rejects(run({ action: 'create', storyboard: fixture() }, c.signal), /abort/i); assert.deepEqual(await fs.readdir(cwd), []); const p = await project();
 await assert.rejects(run({ action: 'update', id: p.id, expectedRevision: 1, storyboard: fixture() }, c.signal), /abort/i);
 const active = new AbortController(); const pending = run({ action: 'render', id: p.id, expectedRevision: 1 }, active.signal); await entered.promise; active.abort(); release.resolve(); await assert.rejects(pending, /abort/i); assert.deepEqual(await run({ action: 'get', id: p.id }), p);
});
test('render failure/missing outputs/malformed metrics do not mutate project', async t => {
 for (const render of [async () => { throw new Error('renderer failed'); }, async () => ({}), async args => { await outputs(args); await fs.writeFile(path.join(args.outputDir, 'metrics.json'), 'not JSON'); return {}; }]) {
 const { cwd, run, project } = await setup(t, { render }); const p = await project(); await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 })); assert.deepEqual(await run({ action: 'get', id: p.id }), p);
  assert.deepEqual(await fs.readdir(path.join(scope(cwd), p.id)), ['project.json']); }
});
test('media cap, nonallowlist, file/directory symlinks', async t => {
 const { cwd, run, project } = await setup(t, { render: outputs }); const p = await project(); const r = await run({ action: 'render', id: p.id, expectedRevision: 1 }); const req = { action: 'media', id: p.id, expectedRevision: 1, kind: 'animation' };
 for (const extra of [{ kind: 'metrics' }, { kind: '../project.json' }, { path: '/etc/passwd' }, { kind: 'scene', sceneIndex: -1 }, { kind: 'scene', sceneIndex: 1 }, { sceneIndex: 0 }]) await assert.rejects(run({ ...req, ...extra }));
 const file = path.join(r.artifacts.directory, 'animation.gif'); const h = await fs.open(file, 'w'); await h.truncate(16 * 1024 * 1024 + 1); await h.close(); await assert.rejects(run(req), /size|large|limit/i);
 assert.equal(path.dirname(file), r.artifacts.directory); await fs.unlink(file); await fs.symlink(path.join(scope(cwd), p.id, 'project.json'), file); await assert.rejects(run(req), /symlink|safe|regular/i);
 const moved = r.artifacts.directory + '-owned'; assert.equal(path.dirname(moved), path.join(scope(cwd), p.id)); await fs.rename(r.artifacts.directory, moved); await fs.symlink(moved, r.artifacts.directory); await assert.rejects(run(req), /symlink|safe|directory/i);
});
test('stored artifact directory cannot redirect media outside scope', async t => {
 const { cwd, run, project } = await setup(t, { render: outputs }); const p = await project(); const r = await run({ action: 'render', id: p.id, expectedRevision: 1 }); r.artifacts.directory = cwd;
 await fs.writeFile(path.join(scope(cwd), p.id, 'project.json'), JSON.stringify(r)); await assert.rejects(run({ action: 'media', id: p.id, expectedRevision: 1, kind: 'animation' }), /scope|artifact|directory/i);
});
test('injectable IO atomic rename and abort before rename', async t => {
 let renames = 0, abort = false; const c = new AbortController(); const io = { ...fs, rename: async (...a) => { renames++; return fs.rename(...a); }, open: async (...a) => { const h = await fs.open(...a); if (abort && path.basename(a[0]).endsWith('.tmp')) c.abort(); return h; } };
 const { cwd, run, project } = await setup(t, { io }); const p = await project(); assert.equal(renames, 1); abort = true;
 await assert.rejects(run({ action: 'update', id: p.id, expectedRevision: 1, storyboard: fixture() }, c.signal), /abort/i); assert.deepEqual(await run({ action: 'get', id: p.id }), p); assert.deepEqual(await fs.readdir(path.join(scope(cwd), p.id)), ['project.json']);
});
test('project file size/symlink/identity checks', async t => {
 const { cwd, run, project } = await setup(t); const p = await project(); const file = path.join(scope(cwd), p.id, 'project.json');
 for (const change of [{ sessionId: 'other' }, { id: randomUUID() }]) { await fs.writeFile(file, JSON.stringify({ ...p, ...change })); await assert.rejects(run({ action: 'get', id: p.id }), /scope|identity|session|id/i); }
 const h = await fs.open(file, 'w'); await h.truncate(2 * 1024 * 1024); await h.close(); await assert.rejects(run({ action: 'get', id: p.id }), /size|large|limit/i);
 assert.equal(path.basename(file), 'project.json'); await fs.unlink(file); await fs.symlink(path.join(cwd, 'outside.json'), file); await assert.rejects(run({ action: 'get', id: p.id }), /symlink|safe|regular/i);
});
test('request object/theme validation and absent list makes no writes', async t => {
 const { cwd, run, project } = await setup(t, { render: outputs }); assert.deepEqual(await run({ action: 'list' }), []); assert.deepEqual(await fs.readdir(cwd), []);
 for (const v of [null, [], 'list', new Date(), Object.assign(Object.create({}), { action: 'list' })]) await assert.rejects(run(v), /request|object|JSON/i);
 const p = await project(); await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1, theme: 'custom' }), /theme/i);
});
test('rerender twice retains only the current generation including bounded Matplotlib cache', async t => {
  const render = async args => { await outputs(args); await fs.mkdir(path.join(args.outputDir, '.mpl-cache')); await fs.writeFile(path.join(args.outputDir, '.mpl-cache', 'fontlist-v390.json'), '{}'); };
  const { cwd, run, project } = await setup(t, { render }); const p = await project();
  for (let i = 0; i < 3; i++) {
    const r = await run({ action: 'render', id: p.id, expectedRevision: 1 });
    assert.deepEqual((await fs.readdir(path.join(scope(cwd), p.id))).sort(), ['project.json', path.basename(r.artifacts.directory)].sort());
  }
  await run({ action: 'update', id: p.id, expectedRevision: 1, storyboard: fixture() });
  assert.deepEqual(await fs.readdir(path.join(scope(cwd), p.id)), ['project.json']);
});
test('failed, aborted and stale renders clean unpublished directories only after callback settles', async t => {
  for (const mode of ['failure', 'abort', 'stale']) {
    const entered = deferred(), release = deferred(); let outputDir;
    const render = async args => { outputDir = args.outputDir; await outputs(args); entered.resolve(); await release.promise; await fs.writeFile(path.join(outputDir, 'scene-1.png'), 'last write'); if (mode === 'failure') throw new Error('renderer failed'); };
    const { cwd, run, project } = await setup(t, { render }); const p = await project(); const c = new AbortController();
    const pending = run({ action: 'render', id: p.id, expectedRevision: 1 }, c.signal); await entered.promise;
    if (mode === 'abort') c.abort();
    if (mode === 'stale') await run({ action: 'update', id: p.id, expectedRevision: 1, storyboard: fixture() });
    assert.ok((await fs.stat(outputDir)).isDirectory(), 'active renderer directory must survive');
    release.resolve(); await assert.rejects(pending, mode === 'failure' ? /renderer failed/ : { code: mode === 'abort' ? 'ABORT_ERR' : 'REVISION_CONFLICT' });
    assert.deepEqual(await fs.readdir(path.join(scope(cwd), p.id)), ['project.json']);
    assert.ok(!(await run({ action: 'get', id: p.id })).artifacts);
  }
});
test('unsafe extra files refuse all cleanup and block further generation admission', async t => {
  let outputDir; const render = async args => { outputDir = args.outputDir; await outputs(args); await fs.writeFile(path.join(outputDir, 'user-notes.txt'), 'keep'); throw new Error('renderer failed'); };
  const { cwd, run, project } = await setup(t, { render }); const p = await project();
  await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), e => e.code === 'STORAGE_QUOTA' && /inspect|remove|clean/i.test(e.message));
  assert.equal(await fs.readFile(path.join(outputDir, 'user-notes.txt'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(outputDir, 'animation.gif'), 'utf8'), 'GIF89a');
  await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), { code: 'STORAGE_QUOTA' });
  assert.equal((await fs.readdir(path.join(scope(cwd), p.id))).length, 2);
});
test('cleanup refuses symlink files, cache and generation directories without touching their targets', async t => {
  for (const layer of ['file', 'cache', 'generation']) {
    let outputDir; const { cwd, run, project } = await setup(t, { render: async args => {
      outputDir = args.outputDir; await outputs(args); const outside = path.join(cwd, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep'), 'safe');
      if (layer === 'file') { const file = path.join(outputDir, 'animation.gif'); assert.equal(path.dirname(file), outputDir); await fs.unlink(file); await fs.symlink(path.join(outside, 'keep'), file); }
      if (layer === 'cache') await fs.symlink(outside, path.join(outputDir, '.mpl-cache'));
      if (layer === 'generation') { const moved = outputDir + '-owned'; assert.equal(path.dirname(moved), path.join(scope(cwd), p.id)); await fs.rename(outputDir, moved); await fs.symlink(outside, outputDir); }
      throw new Error('failed');
    } }); const p = await project();
    await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), /quota|safe|symlink/i);
    assert.equal(await fs.readFile(path.join(cwd, 'outside', 'keep'), 'utf8'), 'safe');
    await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), { code: 'STORAGE_QUOTA' });
  }
});
test('existing generations count toward project quota, including after restarting facade', async t => {
  const { cwd, run, project } = await setup(t, { render: outputs }); const p = await project(); const dir = path.join(scope(cwd), p.id);
  for (let i = 0; i < 2; i++) await fs.mkdir(path.join(dir, `render-1-${randomUUID()}`));
  const op = createOperations({ validateStoryboard: validator, render: outputs });
  await assert.rejects(op.run(session, cwd, { action: 'render', id: p.id, expectedRevision: 1 }), { code: 'STORAGE_QUOTA' });
  assert.equal((await fs.readdir(dir)).length, 3);
});
test('session quota admission serializes concurrent creates across facades', async t => {
  const { cwd, run, project } = await setup(t); for (let i = 0; i < 99; i++) await project();
  const other = createOperations({ validateStoryboard: validator });
  const results = await Promise.allSettled([project(), other.run(session, cwd, { action: 'create', storyboard: fixture() })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'STORAGE_QUOTA');
  assert.equal((await fs.readdir(scope(cwd))).length, 100);
});
test('extra renderer output cannot be published and quota prevents accumulating it', async t => {
  const { cwd, run, project } = await setup(t, { render: async args => { await outputs(args); await fs.writeFile(path.join(args.outputDir, 'untrusted.bin'), 'keep'); } }); const p = await project();
  await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), { code: 'STORAGE_QUOTA' });
  assert.deepEqual(await run({ action: 'get', id: p.id }), p);
  await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), { code: 'STORAGE_QUOTA' });
  assert.equal((await fs.readdir(path.join(scope(cwd), p.id))).length, 2);
});
test('atomic render publication failure cleans only the unpublished replacement', async t => {
  let rejectPublish = false; const io = { ...fs, rename: async (...args) => { if (rejectPublish) throw new Error('publish failed'); return fs.rename(...args); } };
  const { cwd, run, project } = await setup(t, { io, render: outputs }); const p = await project(); const current = await run({ action: 'render', id: p.id, expectedRevision: 1 });
  rejectPublish = true; await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), /publish failed/);
  assert.deepEqual(await run({ action: 'get', id: p.id }), current);
  assert.deepEqual((await fs.readdir(path.join(scope(cwd), p.id))).sort(), ['project.json', path.basename(current.artifacts.directory)].sort());
});
test('media snapshot finishes before replacement publication deletes its old generation', async t => {
  const reading = deferred(), release = deferred(); let block = false;
  const io = { ...fs, open: async (...args) => { const h = await fs.open(...args); if (block && path.basename(args[0]) === 'animation.gif') return { stat: () => h.stat(), close: () => h.close(), read: async (...r) => { reading.resolve(); await release.promise; return h.read(...r); } }; return h; } };
  const { run, project } = await setup(t, { io, render: outputs }); const p = await project(); const current = await run({ action: 'render', id: p.id, expectedRevision: 1 });
  block = true; const media = run({ action: 'media', id: p.id, expectedRevision: 1, kind: 'animation' }); await reading.promise;
  const replacement = run({ action: 'render', id: p.id, expectedRevision: 1 });
  assert.equal(await fs.readFile(path.join(current.artifacts.directory, 'animation.gif'), 'utf8'), 'GIF89a');
  release.resolve(); assert.equal(Buffer.from((await media).base64, 'base64').toString(), 'GIF89a'); await replacement;
  assert.equal(await fs.lstat(current.artifacts.directory).catch(e => e.code), 'ENOENT');
});
test('cleanup failure after atomic publication never deletes the new current generation', async t => {
  let blockCleanup = false; const io = { ...fs, rmdir: async (...args) => { if (blockCleanup) throw new Error('cleanup unavailable'); return fs.rmdir(...args); } };
  const { cwd, run, project } = await setup(t, { io, render: outputs }); const p = await project(); const old = await run({ action: 'render', id: p.id, expectedRevision: 1 });
  blockCleanup = true; await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), { code: 'STORAGE_QUOTA' });
  const current = await run({ action: 'get', id: p.id }); assert.notEqual(current.artifacts.directory, old.artifacts.directory);
  assert.equal(Buffer.from((await run({ action: 'media', id: p.id, expectedRevision: 1, kind: 'animation' })).base64, 'base64').toString(), 'GIF89a');
  await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), { code: 'STORAGE_QUOTA' });
  assert.equal((await fs.readdir(path.join(scope(cwd), p.id))).length, 3);
});
test('excess existing temporary files block creation instead of bypassing file-count quota', async t => {
  const { cwd, run, project } = await setup(t); const p = await project();
  for (let i = 0; i < 5; i++) await fs.writeFile(path.join(scope(cwd), p.id, `${randomUUID()}.tmp`), 'keep');
  await assert.rejects(project(), { code: 'STORAGE_QUOTA' });
  assert.equal((await fs.readdir(scope(cwd))).length, 1);
});
test('custom fsPromises adapter requires nonrecursive rmdir for generation cleanup', async t => {
  const { run, project } = await setup(t, { render: outputs, io: { ...fs, rmdir: undefined } }); const p = await project();
  await assert.rejects(run({ action: 'render', id: p.id, expectedRevision: 1 }), e => e.code === 'IO_ADAPTER' && /rmdir/.test(e.message));
});
test('dynamic default schema import integrates when available', async t => {
 if (!(await fs.stat(new URL('../schema.js', import.meta.url)).catch(() => null))) { t.skip('independent schema unavailable'); return; }
 const { cwd } = await setup(t); const op = createOperations(); assert.equal((await op.run(session, cwd, { action: 'create', storyboard: fixture() })).revision, 1);
 await assert.rejects(op.run(session, cwd, { action: 'create', storyboard: { ...fixture(), unknown: true } }));
});
