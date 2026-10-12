import fs from 'node:fs/promises';
import {leagues} from '../packages/contracts/src/leagues';
import {espn} from '../worker/src/providers/espn';
const rows=await Promise.all(leagues.map(async l=>{const date='2026-10-12';try{const games=await espn.listGames(l.id,date);return {league:l.id,date,count:games.length,live:games.filter(g=>g.status==='live').map(g=>g.id),ids:games.map(g=>g.id),capturedAt:new Date().toISOString()};}catch(e){return {league:l.id,error:String(e)};}}));await fs.writeFile('reports/live-availability.json',JSON.stringify(rows,null,2));console.log(rows.map(r=>({league:r.league,count:r.count,live:r.live,error:r.error})));
for(const [league,date] of [['nfl','2026-10-11'],['nba','2026-10-13'],['mlb','2026-10-11'],['nhl','2026-10-11'],['epl','2026-09-19']]){const g=(await espn.listGames(league,date))[0];if(g)await fs.writeFile(`tests/fixtures/${league}-game.json`,JSON.stringify(await espn.getGame(g.id),null,2));}
