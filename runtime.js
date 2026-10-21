import path from 'node:path';
import os from 'node:os';
import { readFile, lstat, realpath } from 'node:fs/promises';

export function runtimeHome(env=process.env, platform=process.platform) {
  if(env.DSH_STEM_GIF_HOME) return path.resolve(env.DSH_STEM_GIF_HOME);
  const base=platform==='win32' ? env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local') : platform==='darwin' ? path.join(os.homedir(),'Library','Caches') : env.XDG_CACHE_HOME || path.join(os.homedir(),'.cache');
  return path.join(base,'dsh-stem-gif-creator');
}
export async function resolveRendererPython(engine, config={}) {
  const explicit=engine==='manim'?config.manimPython:config.python;
  if(explicit) return explicit;
  const home=runtimeHome();
  try {
    const file=path.join(home,'runtime.json');
    const stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384) throw new Error('unsafe runtime manifest');
    const manifest=JSON.parse(await readFile(file,'utf8'));
    if(manifest.version!==1||manifest.envRoot!==await realpath(home)) throw new Error('runtime cache identity mismatch');
    const entry=manifest.engines?.[engine];
    if(!entry || typeof entry.python!=='string'||typeof entry.envRoot!=='string') throw new Error('engine not configured');
    const root=path.join(manifest.envRoot,engine);
    if(entry.envRoot!==root||entry.python!==path.join(root,process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python')) throw new Error('engine path mismatch');
    if(await realpath(root)!==root) throw new Error('runtime environment must not be redirected');
    return entry.python;
  } catch(error) {
    throw new Error(`Python renderer ${engine} is not configured (${error.message}). Run node scripts/doctor.mjs, then authorize node scripts/setup-python.mjs --engine ${engine}; or configure ${engine==='manim'?'manimPython':'python'} explicitly. Never modify DSH bundled Python.`);
  }
}
export function environmentHelp() {
  return {status:'guidance',home:runtimeHome(),steps:[
    'Read the shipped INSTALL_FOR_AI.md, docs/environment.md and scripts before executing them.',
    'Run node scripts/doctor.mjs for a read-only environment diagnosis.',
    'Run node scripts/setup-python.mjs --engine all --dry-run and explain downloads, native prerequisites and cache paths.',
    'Ask the user for permission to download Python packages and create isolated environments. OS package-manager changes require separate permission.',
    'After permission, run node scripts/setup-python.mjs --engine charts|manim|all, then run doctor and a real render.',
  ],constraints:['No automatic postinstall or OS package-manager commands.','No DSH bundled Python, signing modifications, credentials or arbitrary code.','Installation alone does not prove rendering or GUI activation.']};
}
