import * as nodeIO from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_LIMIT = 16 * 1024 * 1024;
const PROJECT_LIMIT = 1024 * 1024;
const METRICS_LIMIT = 256 * 1024;
const MAX_PROJECTS = 100;
const MAX_GENERATIONS = 2; // Current published generation plus one in-flight/replacement.
const MAX_SESSION_GENERATIONS = MAX_PROJECTS * MAX_GENERATIONS;
const GENERATION = /^render-[1-9][0-9]*-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const GENERATED_FILES = ['animation.gif', 'overview.png', 'metrics.json', ...Array.from({ length: 12 }, (_, i) => `scene-${i + 1}.png`)];
const CACHE_FILES = ['fontlist-v330.json', 'fontlist-v390.json'];
const activeGenerations = new Set();
// One Host process may create multiple operation facades; they share coordination.
const mutations = new Map();
const rendering = new Set();

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function abort(signal) {
  if (signal?.aborted) fail('ABORT_ERR', 'Operation aborted');
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('INVALID_REQUEST', `${label} must be a plain JSON object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) {
      fail('INVALID_REQUEST', `${label} must contain JSON data fields only`);
    }
  }
}
function fields(value, allowed, required, label) {
  object(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('INVALID_REQUEST', `Unknown ${label} field: ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('INVALID_REQUEST', `Missing ${label} field: ${key}`);
  }
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_REVISION', 'expectedRevision must be an integer revision >= 1');
}
function checkRevision(project, expected) {
  if (project.revision !== expected) fail('REVISION_CONFLICT', 'Project revision conflict; reload before retrying');
}
function checkId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) fail('INVALID_ID', 'Project id must be an exact lowercase UUID');
}
function request(value) {
  object(value, 'request');
  const specs = {
    create: [['action', 'storyboard'], ['action', 'storyboard']],
    list: [['action'], ['action']],
    get: [['action', 'id'], ['action', 'id']],
    update: [['action', 'id', 'expectedRevision', 'storyboard'], ['action', 'id', 'expectedRevision', 'storyboard']],
    render: [['action', 'id', 'expectedRevision', 'theme'], ['action', 'id', 'expectedRevision']],
    media: [['action', 'id', 'expectedRevision', 'kind', 'sceneIndex'], ['action', 'id', 'expectedRevision', 'kind']],
  };
  if (typeof value.action !== 'string' || !Object.hasOwn(specs, value.action)) fail('INVALID_REQUEST', 'Unknown request action');
  fields(value, ...specs[value.action], 'request');
  if (Object.hasOwn(value, 'id')) checkId(value.id);
  if (['update', 'render', 'media'].includes(value.action)) revision(value.expectedRevision);
  if (['create', 'update'].includes(value.action)) fields(value.storyboard, ['title', 'source', 'scenes'], ['title', 'source', 'scenes'], 'storyboard');
  if (value.action === 'render' && Object.hasOwn(value, 'theme') && !['light', 'dark'].includes(value.theme)) fail('INVALID_REQUEST', 'theme must be light or dark');
  if (value.action === 'media') {
    if (!['animation', 'overview', 'scene'].includes(value.kind)) fail('INVALID_REQUEST', 'Unknown media kind');
    if (value.kind === 'scene') {
      if (!Number.isSafeInteger(value.sceneIndex) || value.sceneIndex < 0) fail('INVALID_REQUEST', 'sceneIndex must be a nonnegative integer');
    } else if (Object.hasOwn(value, 'sceneIndex')) fail('INVALID_REQUEST', 'sceneIndex is allowed only for scene media');
  }
  // Detach before the first await, so caller edits cannot change validated selectors.
  return structuredClone(value);
}
async function serialized(key, work) {
  const previous = mutations.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  mutations.set(key, gate);
  await previous;
  try { return await work(); }
  finally { release(); if (mutations.get(key) === gate) mutations.delete(key); }
}
function parseJSON(buffer, label) {
  try { return JSON.parse(buffer.toString('utf8')); }
  catch { fail('INVALID_DATA', `${label} must be valid JSON`); }
}

/**
 * Shared tool/command operation. Host must authorize sessionId and supply its cwd.
 * IO is a complete fs/promises-compatible adapter (including no-follow open flags
 * and FileHandle stat/read/writeFile/sync/close; nonrecursive rmdir is required),
 * not an authority-bearing service. render({storyboard, outputDir, theme, signal})
 * writes fixed output filenames; its promise MUST settle only after all writers
 * have exited (Host finally waits for waitForExit), even on failure/cancellation.
 * No renderer-returned path is ever consumed. Cleanup ignores cancellation and
 * only unlinks allowlisted regular files, then uses rmdir, never recursive rm.
 * Limits: 100 projects/session, 2 generations/project, 200 generations/session;
 * inventories include preexisting directories, not just process-local counters.
 * OS-level hostile ancestor swaps between verification and IO remain a limitation:
 * these fsPromises checks are not descriptor-relative openat/unlinkat protection.
 */
export function createOperations({ io = nodeIO, render, validateStoryboard } = {}) {
  let validator = validateStoryboard;
  async function storyboard(value) {
    if (!validator) ({ validateStoryboard: validator } = await import('./schema.js'));
    if (typeof validator !== 'function') fail('INVALID_DATA', 'Storyboard validator unavailable');
    return validator(value);
  }
  async function directory(target, create, signal) {
    let stat;
    try { stat = await io.lstat(target); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      abort(signal);
      try { await io.mkdir(target, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      stat = await io.lstat(target);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_PATH', 'Unsafe scope directory or symlink');
    if (await io.realpath(target) !== target) fail('UNSAFE_PATH', 'Scope directory is not canonically contained');
    return stat;
  }
  async function context(sessionId, cwd, create, signal) {
    if (typeof sessionId !== 'string') fail('INVALID_REQUEST', 'sessionId must be a string');
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) fail('INVALID_REQUEST', 'cwd must be an absolute directory');
    const base = await io.realpath(cwd);
    await directory(base, false, signal);
    const root = path.join(base, '.gif-creator');
    const sessionRoot = path.join(root, createHash('sha256').update(sessionId, 'utf8').digest('hex'));
    await directory(root, create, signal);
    await directory(sessionRoot, create, signal);
    return { base, root, sessionRoot, sessionId, signal };
  }
  async function guard(ctx, projectDir, artifactDir) {
    abort(ctx.signal);
    // Recheck every controlled ancestor before each file operation, not just once.
    for (const dir of [ctx.base, ctx.root, ctx.sessionRoot, projectDir, artifactDir].filter(Boolean)) {
      await directory(dir, false, ctx.signal);
    }
    if (projectDir && path.dirname(projectDir) !== ctx.sessionRoot) fail('UNSAFE_PATH', 'Project directory escapes session scope');
    if (artifactDir && path.dirname(artifactDir) !== projectDir) fail('UNSAFE_PATH', 'Artifact directory escapes project scope');
    abort(ctx.signal);
  }
  async function fileStat(ctx, projectDir, artifactDir, filename, limit) {
    await guard(ctx, projectDir, artifactDir);
    const file = path.join(artifactDir ?? projectDir, filename);
    const stat = await io.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) fail('UNSAFE_PATH', 'Unsafe file: symlink or non-regular file');
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > limit) fail('SIZE_LIMIT', `${filename} exceeds file size limit`);
    if (await io.realpath(file) !== file) fail('UNSAFE_PATH', 'Unsafe file containment');
    return { file, stat };
  }
  async function readBounded(ctx, projectDir, artifactDir, filename, limit) {
    const { file, stat } = await fileStat(ctx, projectDir, artifactDir, filename, limit);
    await guard(ctx, projectDir, artifactDir);
    const handle = await io.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) fail('UNSAFE_PATH', 'Unsafe file changed during open');
      if (opened.size > limit) fail('SIZE_LIMIT', `${filename} exceeds file size limit`);
      // Never use unbounded readFile: size can grow after stat. Read at most limit+1.
      const buffer = Buffer.alloc(Math.min(opened.size + 1, limit + 1));
      let length = 0;
      while (length < buffer.length) {
        abort(ctx.signal);
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > opened.size || length > limit) fail('SIZE_LIMIT', `${filename} size changed during read`);
      await guard(ctx, projectDir, artifactDir);
      return buffer.subarray(0, length);
    } finally { await handle.close(); }
  }
  function artifactDirectory(project, projectDir) {
    const artifact = project.artifacts;
    fields(artifact, ['revision', 'directory', 'metrics'], ['revision', 'directory', 'metrics'], 'artifacts');
    if (artifact.revision !== project.revision) fail('REVISION_CONFLICT', 'Stale artifact revision');
    if (typeof artifact.directory !== 'string' || path.dirname(artifact.directory) !== projectDir ||
        !new RegExp(`^render-${project.revision}-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$`).test(path.basename(artifact.directory)) ||
        path.resolve(artifact.directory) !== artifact.directory) fail('UNSAFE_PATH', 'Artifact directory escapes generated scope');
    object(artifact.metrics, 'metrics');
    return artifact.directory;
  }
  async function get(ctx, id) {
    const dir = path.join(ctx.sessionRoot, id);
    const project = parseJSON(await readBounded(ctx, dir, undefined, 'project.json', PROJECT_LIMIT), 'project.json');
    fields(project, ['version', 'id', 'sessionId', 'revision', 'title', 'source', 'scenes', 'createdAt', 'updatedAt', 'artifacts'],
      ['version', 'id', 'sessionId', 'revision', 'title', 'source', 'scenes', 'createdAt', 'updatedAt'], 'project');
    if (project.version !== 1 || project.id !== id || project.sessionId !== ctx.sessionId) fail('INVALID_DATA', 'Stored project identity does not match session scope');
    revision(project.revision);
    if (typeof project.createdAt !== 'string' || typeof project.updatedAt !== 'string') fail('INVALID_DATA', 'Invalid project timestamps');
    await storyboard({ title: project.title, source: project.source, scenes: project.scenes });
    if (project.artifacts) artifactDirectory(project, dir);
    return project;
  }
  async function atomicWrite(ctx, dir, project) {
    const data = JSON.stringify(project);
    if (Buffer.byteLength(data) > PROJECT_LIMIT) fail('SIZE_LIMIT', 'Project exceeds file size limit');
    const tmp = path.join(dir, `${randomUUID()}.tmp`);
    const destination = path.join(dir, 'project.json');
    await guard(ctx, dir);
    const existing = await io.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) fail('UNSAFE_PATH', 'Unsafe project.json file');
    let handle;
    let created = false;
    try {
      abort(ctx.signal);
      handle = await io.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      abort(ctx.signal);
      await handle.writeFile(data, 'utf8');
      await handle.sync();
      await handle.close(); handle = undefined;
      await guard(ctx, dir);
      abort(ctx.signal);
      await io.rename(tmp, destination);
      created = false;
    } finally {
      if (handle) await handle.close();
      if (created) {
        // Cleanup ignores cancellation but still verifies resolved scope, never follows links.
        await guard({ ...ctx, signal: undefined }, dir);
        if (path.dirname(tmp) !== dir || !UUID.test(path.basename(tmp, '.tmp'))) fail('UNSAFE_PATH', 'Unsafe temporary file cleanup');
        await io.unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }
  }
  function quota() {
    fail('STORAGE_QUOTA', 'GIF storage quota or unsafe retained files: reload the project (metadata may already be published), then inspect and manually remove unneeded projects or unpublished retained render directories in this session workspace before retrying; do not remove current published artifacts or an active render.');
  }
  async function inventory(ctx, projectDir, outputDir) {
    const cleanCtx = { ...ctx, signal: undefined };
    if (!path.isAbsolute(outputDir) || path.resolve(outputDir) !== outputDir ||
        path.dirname(outputDir) !== projectDir || !GENERATION.test(path.basename(outputDir))) quota();
    await guard(cleanCtx, projectDir, outputDir);
    const entries = await io.readdir(outputDir, { withFileTypes: true });
    if (entries.length > GENERATED_FILES.length + 1) quota();
    const files = []; let cache;
    for (const entry of entries) {
      if (GENERATED_FILES.includes(entry.name)) {
        const checked = await fileStat(cleanCtx, projectDir, outputDir, entry.name, entry.name === 'metrics.json' ? METRICS_LIMIT : MEDIA_LIMIT);
        files.push(checked.file);
      } else if (entry.name === '.mpl-cache') {
        cache = path.join(outputDir, '.mpl-cache');
        await directory(cache, false);
        const cached = await io.readdir(cache, { withFileTypes: true });
        if (cached.length > CACHE_FILES.length) quota();
        for (const item of cached) {
          if (!CACHE_FILES.includes(item.name)) quota();
          // Cache is the sole allowed nested directory; validate it explicitly.
          await guard(cleanCtx, projectDir, outputDir);
          await directory(cache, false);
          const file = path.join(cache, item.name); const stat = await io.lstat(file);
          if (stat.isSymbolicLink() || !stat.isFile() || await io.realpath(file) !== file || stat.size > METRICS_LIMIT) quota();
          files.push(file);
        }
      } else quota();
    }
    return { files, cache };
  }
  async function cleanup(ctx, projectDir, outputDir) {
    const cleanCtx = { ...ctx, signal: undefined };
    try {
      // Complete preflight before any deletion: unknown content is never partially cleaned.
      const { files, cache } = await inventory(cleanCtx, projectDir, outputDir);
      for (const file of files) {
        await guard(cleanCtx, projectDir, outputDir);
        const parent = path.dirname(file);
        if (parent !== outputDir && parent !== cache) quota();
        if (parent === cache) await directory(cache, false);
        const stat = await io.lstat(file);
        if (stat.isSymbolicLink() || !stat.isFile() || await io.realpath(file) !== file) quota();
        await io.unlink(file);
      }
      if (cache) { await guard(cleanCtx, projectDir, outputDir); await directory(cache, false); await io.rmdir(cache); }
      await guard(cleanCtx, projectDir, outputDir); await io.rmdir(outputDir);
    } catch { quota(); } // Preserve unsafe retained data; admission will continue to refuse it.
  }
  async function admission(ctx, targetDir) {
    await guard(ctx);
    const projects = await io.readdir(ctx.sessionRoot, { withFileTypes: true });
    // Count all entries: unrecognized retained data must not bypass the aggregate cap.
    if (projects.length > MAX_PROJECTS || (!targetDir && projects.length >= MAX_PROJECTS)) quota();
    let total = 0, targetCount = 0;
    for (const entry of projects) {
      if (!UUID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) quota();
      const projectDir = path.join(ctx.sessionRoot, entry.name);
      await guard(ctx, projectDir);
      const entries = await io.readdir(projectDir, { withFileTypes: true });
      // One metadata file, at most one atomic temporary, and two generations.
      if (entries.length > MAX_GENERATIONS + 2) quota();
      let count = 0, temporaries = 0;
      for (const child of entries) {
        if (child.name === 'project.json') continue;
        if (UUID.test(path.basename(child.name, '.tmp')) && child.name.endsWith('.tmp')) {
          if (++temporaries > 1 || !child.isFile() || child.isSymbolicLink()) quota();
          continue;
        }
        if (!GENERATION.test(child.name)) quota();
        const outputDir = path.join(projectDir, child.name); count++; total++;
        // Active writers may temporarily have incomplete output/cache; count but don't inspect.
        if (!activeGenerations.has(outputDir)) {
          try { await inventory(ctx, projectDir, outputDir); } catch { quota(); }
        }
      }
      if (count > MAX_GENERATIONS) quota();
      if (projectDir === targetDir) targetCount = count;
    }
    if (total > MAX_SESSION_GENERATIONS || (targetDir && (targetCount >= MAX_GENERATIONS || total >= MAX_SESSION_GENERATIONS))) quota();
  }
  async function run(sessionId, cwd, input, signal) {
    abort(signal);
    const req = request(input);
    const value = ['create', 'update'].includes(req.action) ? await storyboard(req.storyboard) : undefined;
    abort(signal);
    try {
      let ctx;
      try { ctx = await context(sessionId, cwd, req.action === 'create', signal); }
      catch (error) {
        if (error.code === 'ENOENT' && req.action === 'list') return [];
        throw error;
      }
      abort(signal);
      if (req.action === 'create') {
        const id = randomUUID(); const dir = path.join(ctx.sessionRoot, id);
        return await serialized(ctx.sessionRoot, () => serialized(dir, async () => {
          await admission(ctx);
          await guard(ctx);
          abort(signal); await io.mkdir(dir, { mode: 0o700 });
          const now = new Date().toISOString();
          const project = { version: 1, id, sessionId, revision: 1, ...value, createdAt: now, updatedAt: now };
          await atomicWrite(ctx, dir, project); return project;
        }));
      }
      if (req.action === 'list') {
        await guard(ctx);
        const entries = await io.readdir(ctx.sessionRoot, { withFileTypes: true });
        const summaries = [];
        for (const entry of entries) {
          if (!UUID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
          const p = await get(ctx, entry.name);
          summaries.push({ id: p.id, title: p.title, revision: p.revision, createdAt: p.createdAt, updatedAt: p.updatedAt });
          if (summaries.length === 100) break;
        }
        return summaries;
      }
      const dir = path.join(ctx.sessionRoot, req.id);
      if (req.action === 'get') return await get(ctx, req.id);
      if (req.action === 'update') return await serialized(dir, async () => {
        const p = await get(ctx, req.id); checkRevision(p, req.expectedRevision);
        if (p.revision === Number.MAX_SAFE_INTEGER) fail('INVALID_REVISION', 'Project revision exhausted');
        const { artifacts: discarded, ...previous } = p;
        const updated = { ...previous, ...value, revision: p.revision + 1, updatedAt: new Date().toISOString() };
        await atomicWrite(ctx, dir, updated);
        if (discarded) await cleanup(ctx, dir, artifactDirectory(p, dir));
        return updated;
      });
      if (req.action === 'media') return await serialized(dir, async () => {
        const p = await get(ctx, req.id); checkRevision(p, req.expectedRevision);
        if (!p.artifacts) fail('NO_ARTIFACTS', 'Project has no current rendered artifacts');
        const outputDir = artifactDirectory(p, dir);
        if (req.kind === 'scene' && req.sceneIndex >= p.scenes.length) fail('INVALID_REQUEST', 'sceneIndex is outside storyboard scenes');
        const name = req.kind === 'animation' ? 'animation.gif' : req.kind === 'overview' ? 'overview.png' : `scene-${req.sceneIndex + 1}.png`;
        const bytes = await readBounded(ctx, dir, outputDir, name, MEDIA_LIMIT);
        return { base64: bytes.toString('base64'), mime: req.kind === 'animation' ? 'image/gif' : 'image/png', name };
      });
      // Reserve render before any await. Mutations remain available while renderer runs.
      if (rendering.has(dir)) fail('RENDER_BUSY', 'A render is already in progress for this project');
      if (typeof render !== 'function') fail('RENDER_UNAVAILABLE', 'Renderer unavailable');
      if (typeof io.rmdir !== 'function') fail('IO_ADAPTER', 'fsPromises IO adapter must implement nonrecursive rmdir for render cleanup');
      rendering.add(dir);
      let outputDir, published = false;
      try {
        const p = await serialized(dir, async () => { const p = await get(ctx, req.id); checkRevision(p, req.expectedRevision); return p; });
        await serialized(ctx.sessionRoot, async () => {
          await admission(ctx, dir);
          const candidate = path.join(dir, `render-${p.revision}-${randomUUID()}`);
          await guard(ctx, dir); abort(signal); await io.mkdir(candidate, { mode: 0o700 });
          outputDir = candidate; activeGenerations.add(outputDir);
        });
        await guard(ctx, dir, outputDir);
        await render({ storyboard: { title: p.title, source: p.source, scenes: p.scenes }, outputDir, theme: req.theme ?? 'light', signal });
        abort(signal);
        // Bound the entire settled generation, including cache, before publishing it.
        try { await inventory(ctx, dir, outputDir); } catch { quota(); }
        // Ignore renderer-reported paths and read only fixed filenames in our own directory.
        const metrics = parseJSON(await readBounded(ctx, dir, outputDir, 'metrics.json', METRICS_LIMIT), 'metrics.json');
        object(metrics, 'metrics');
        for (const name of ['animation.gif', 'overview.png', ...p.scenes.map((_, i) => `scene-${i + 1}.png`)]) {
          await fileStat(ctx, dir, outputDir, name, MEDIA_LIMIT);
        }
        return await serialized(dir, async () => {
          const current = await get(ctx, req.id); checkRevision(current, req.expectedRevision);
          await guard(ctx, dir, outputDir);
          const updated = { ...current, artifacts: { revision: current.revision, directory: outputDir, metrics } };
          await atomicWrite(ctx, dir, updated);
          published = true; // Never delete new metadata's directory, even if old cleanup fails.
          if (current.artifacts) await cleanup(ctx, dir, artifactDirectory(current, dir));
          return updated;
        });
      } finally {
        try {
          // Awaited render callback has now quiesced; cancellation cannot skip cleanup.
          if (outputDir && !published) await serialized(dir, () => cleanup(ctx, dir, outputDir));
        } finally { if (outputDir) activeGenerations.delete(outputDir); rendering.delete(dir); }
      }
    } catch (error) {
      if (error.code === 'ENOENT') fail('NOT_FOUND', 'Project or required renderer output not found');
      if (['ELOOP', 'ENOTDIR'].includes(error.code)) fail('UNSAFE_PATH', 'Unsafe scope directory or symlink');
      // Raw IO errors can contain absolute filesystem paths. Preserve code, not paths.
      if (error.syscall || error.path) fail(error.code ?? 'IO_ERROR', 'Project file IO failed');
      throw error;
    }
  }
  return { run };
}
