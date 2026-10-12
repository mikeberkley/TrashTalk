import fs from 'node:fs/promises';
import {cf} from './cloudflare';
const paths=['/workers/scripts/trashtalk-production/schedules','/workers/scripts/trashtalk-preview/schedules','/queues/af3be00d643141f3a052d470cfbccf62/consumers'];
const results=await Promise.all(paths.map(async path=>{try{const result:any=await (await cf(path,{signal:AbortSignal.timeout(20000)})).json();return {path,result:result.result};}catch(e){return {path,error:'API request unavailable'};}}));
await fs.writeFile('reports/deployment-triggers-check.json',JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results,null,2));
