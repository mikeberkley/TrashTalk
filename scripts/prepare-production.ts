// Preparation deploy only: payment/generation remain behind the launch hold.
import fs from 'node:fs/promises';
import {parse} from 'jsonc-parser';
import {execFileSync} from 'node:child_process';
const config=parse(await fs.readFile('wrangler.jsonc','utf8'));
const vars=config.env.production.vars;
if(vars.LAUNCH_HOLD!=='true'||vars.PAUSE_GENERATION!=='true'||vars.PREVIEW_UNLIMITED!=='false'||config.assets.run_worker_first!==true)throw Error('Preparation requires the production launch hold on all routes.');
execFileSync('npm',['run','verify'],{stdio:'inherit'});
execFileSync('npx',['wrangler','d1','migrations','apply','trashtalk-production','--env','production','--remote'],{stdio:'inherit'});
execFileSync('npx',['wrangler','deploy','--env','production'],{stdio:'inherit'});
