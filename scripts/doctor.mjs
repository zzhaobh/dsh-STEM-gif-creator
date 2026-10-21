import {spawnSync} from 'node:child_process';
import {runtimeHome,resolveRendererPython} from '../runtime.js';
const result={platform:process.platform,architecture:process.arch,home:runtimeHome(),engines:{},prerequisites:{}};
for(const command of ['uv','python3','pkg-config','ffmpeg']){const r=spawnSync(command,[command==='ffmpeg'?'-version':'--version'],{shell:false,encoding:'utf8'});result.prerequisites[command]=!r.error&&r.status===0;}
for(const engine of ['charts','manim']){try{const python=await resolveRendererPython(engine);const code=engine==='manim'?'import manim,av,PIL,matplotlib; print(manim.__version__)':'import matplotlib,PIL,numpy,celluloid; print(matplotlib.__version__)';const r=spawnSync(python,['-I','-c',code],{shell:false,encoding:'utf8',timeout:30000});result.engines[engine]={python,importsPassed:!r.error&&r.status===0,version:r.stdout?.trim(),error:r.status!==0?r.stderr?.slice(-1000):undefined};}catch(error){result.engines[engine]={importsPassed:false,error:error.message};}}
console.log(JSON.stringify(result,null,2));
if(Object.values(result.engines).some(e=>!e.importsPassed))process.exitCode=1;
