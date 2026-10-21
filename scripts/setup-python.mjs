import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {mkdir,lstat,realpath,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {runtimeHome} from '../runtime.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function parseOptions(args){let engine='charts',dryRun=false;for(let i=0;i<args.length;i++){if(args[i]==='--engine'){engine=args[++i];if(!['charts','manim','all'].includes(engine))throw new Error('engine must be charts|manim|all');}else if(args[i]==='--dry-run')dryRun=true;else throw new Error(`Unknown option ${args[i]}`);}return {engine,dryRun};}
export function environmentPython(home,engine,platform=process.platform){return path.join(home,engine,platform==='win32'?'Scripts':'bin',platform==='win32'?'python.exe':'python');}
function run(argv,options={}){const r=spawnSync(argv[0],argv.slice(1),{shell:false,encoding:'utf8',...options});if(r.error||r.status!==0)throw new Error(`${argv[0]} failed: ${r.error?.message||r.stderr||r.status}`);return r.stdout?.trim();}
function found(command){const r=spawnSync(command,['--version'],{shell:false,encoding:'utf8'});return !r.error&&r.status===0;}
export function installPlan({engine='charts',home=runtimeHome(),uv=true,python='python3',platform=process.platform}={}){
 return (engine==='all'?['charts','manim']:[engine]).map(name=>{const dir=path.join(home,name),executable=environmentPython(home,name,platform),requirements=path.join(root,'renderer',name==='manim'?'requirements-manim.txt':'requirements.txt');return {engine:name,envRoot:dir,python:executable,commands:uv? [['uv','venv','--python','3.12',dir],['uv','pip','install','--python',executable,'-r',requirements]]:[[python,'-m','venv',dir],[executable,'-m','pip','install','-r',requirements]]};});
}
async function safeDirectory(dir){await mkdir(dir,{recursive:true});if((await lstat(dir)).isSymbolicLink()||await realpath(dir)!==path.resolve(dir))throw new Error(`Refusing redirected environment directory ${dir}`);}
export async function acquireSetupLock(home){const file=path.join(home,'setup.lock');let handle;try{handle=await open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('Environment setup is busy (or a stale setup.lock needs manual inspection).');throw e;}return async()=>{await handle.close();await unlink(file);};}
async function verifyVenv(item){
 const cfg=await lstat(path.join(item.envRoot,'pyvenv.cfg'));if(!cfg.isFile()||cfg.isSymbolicLink())throw new Error('Not an isolated venv');
 const bin=path.dirname(item.python);if(await realpath(bin)!==bin)throw new Error('Redirected venv bin directory');
 const code='import sys,json; print(json.dumps({"prefix":sys.prefix,"base":sys.base_prefix,"executable":sys.executable}))';
 const r=JSON.parse(run([item.python,'-I','-c',code]));
 if(path.resolve(r.prefix)!==item.envRoot||r.prefix===r.base||r.base.split(String.fromCharCode(92)).join('/').includes('/.dsh/dsh-runtimes/')||r.base.includes('app.asar'))throw new Error('Refusing global, redirected or DSH bundled Python');
}
export async function setup(args=process.argv.slice(2)){
 const options=parseOptions(args),home=runtimeHome(),uv=found('uv');
 const plan=installPlan({engine:options.engine,home,uv});
 if(options.dryRun){console.log(JSON.stringify({dryRun:true,home,plan,nativePrerequisites:'Manim requires Cairo/Pango/pkg-config and an installed CJK font. OS package-manager changes require separate permission.'},null,2));return;}
 if(!uv){const code='import sys,json; print(json.dumps(list(sys.version_info[:2])))';const r=spawnSync('python3',['-c',code],{encoding:'utf8',shell:false});if(r.error||r.status!==0||!['[3, 11]','[3, 12]'].includes(r.stdout.trim()))throw new Error('Install uv or provide an ordinary Python 3.11/3.12; never use DSH bundled Python.');}
 if(plan.some(p=>p.engine==='manim')&&process.platform!=='win32'){for(const dependency of ['cairo','pangocairo'])run(['pkg-config','--exists',dependency]);}
 await safeDirectory(home);const release=await acquireSetupLock(home);try{let manifest={version:1,envRoot:await realpath(home),engines:{}};
 try{const file=path.join(home,'runtime.json');const stat=await lstat(file);if(stat.isSymbolicLink()||stat.size>16384)throw new Error('unsafe existing manifest');const previous=JSON.parse(await readFile(file,'utf8'));if(previous.version!==1||previous.envRoot!==manifest.envRoot)throw new Error('manifest identity mismatch');if(!previous.engines||Object.getPrototypeOf(previous.engines)!==Object.prototype||Object.keys(previous.engines).some(k=>!['charts','manim'].includes(k)))throw new Error('invalid engine manifest');manifest=previous;}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const item of plan){let exists=false;try{const stat=await lstat(item.envRoot);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(item.envRoot)!==item.envRoot)throw new Error('unsafe existing environment');exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const [i,command] of item.commands.entries()){if(i===0&&exists)continue;if(i===1)await verifyVenv(item);run(command,{stdio:'inherit'});}
  const imports=item.engine==='manim'?'import manim,av,PIL,matplotlib':'import matplotlib,PIL,numpy,celluloid';run([item.python,'-I','-c',imports]);
  manifest.engines[item.engine]={envRoot:item.envRoot,python:item.python};
 }
 const temporary=path.join(home,`runtime-${process.pid}.tmp`);await writeFile(temporary,JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});await rename(temporary,path.join(home,'runtime.json'));console.log('Python imports verified. Run doctor and a real render before claiming readiness.');
 } finally {await release();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))setup().catch(e=>{console.error(e.message);process.exitCode=1;});
