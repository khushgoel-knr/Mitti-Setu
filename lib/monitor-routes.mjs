import {randomUUID} from 'node:crypto';
import {farmRecord,observationRecord,findFarmLocations,farmWeather,daysSinceSowing} from './crop-monitor.mjs';
import {marketAssistant} from './market-assistant.mjs';
export async function handleMonitor({req,pathname,env,get,all,run,body,requireUser,send,fail,rateLimit}){
 const method=req.method,ip=(process.env.VERCEL?req.headers.get('x-forwarded-for')?.split(',')[0]?.trim():null)||'visitor';
 if(pathname==='/api/monitor/demo'&&method==='GET'){
  rateLimit('monitor-demo:'+ip);return send(200,{weather:await farmWeather({latitude:16.3067,longitude:80.4365})});
 }
 const u=await requireUser(req,'farmer');
 if(pathname==='/api/monitor/locations'&&method==='POST'){rateLimit('monitor-locations:'+u.id);return send(200,{places:await findFarmLocations((await body(req)).query)})}
 if(pathname==='/api/monitor/draft'&&method==='POST'){rateLimit('monitor-draft:'+u.id,120);return send(200,await marketAssistant('monitorDraft',await body(req),{key:env.GEMINI_API_KEY,model:env.GEMINI_MODEL}))}
 const unpack=row=>({...JSON.parse(row.record),id:row.id,revision:row.revision,created:row.created,updated:row.updated});
 if(pathname==='/api/monitor/farms'&&method==='GET')return send(200,{farms:(await all('SELECT * FROM monitor_farms WHERE user_id=? AND archived=0 ORDER BY updated DESC',u.id)).map(unpack)});
 if(pathname==='/api/monitor/farms'&&method==='POST'){
  const record=farmRecord(await body(req)),id=randomUUID(),now=Date.now();
  const count=await get('SELECT COUNT(*) AS n FROM monitor_farms WHERE user_id=? AND archived=0',u.id);if(count.n>=50)fail(400,'Archive an old farm profile before adding another.');
  await run('INSERT INTO monitor_farms(id,user_id,record,created,updated) VALUES(?,?,?,?,?)',id,u.id,JSON.stringify(record),now,now);return send(201,{id});
 }
 const match=pathname.match(/^\/api\/monitor\/farms\/([a-zA-Z0-9-]+)(?:\/(weather|checkins|guidance|archive))?$/);if(!match)fail(404,'Monitoring page not found.');
 const row=await get('SELECT * FROM monitor_farms WHERE id=? AND user_id=? AND archived=0',match[1],u.id);if(!row)fail(404,'Farm profile not found.');const farm=unpack(row),action=match[2];
 if(!action&&method==='GET'){
  const [observations,guidance]=await Promise.all([all('SELECT * FROM monitor_observations WHERE farm_id=? ORDER BY created DESC,id DESC LIMIT 50',row.id),get('SELECT * FROM monitor_guidance WHERE farm_id=? AND language=? ORDER BY created DESC LIMIT 1',row.id,['hi','te'].includes(new URL(req.url).searchParams.get('language'))?new URL(req.url).searchParams.get('language'):'en')]);
  return send(200,{farm,observations:observations.map(r=>({...JSON.parse(r.record),id:r.id,created:r.created})),guidance:guidance?{...JSON.parse(guidance.record),created:guidance.created}:null});
 }
 if(!action&&method==='PATCH'){
  const d=await body(req);if(d.revision!==row.revision)fail(409,'This farm profile changed. Refresh and try again.');const record=farmRecord(d);
  if((record.crop!==farm.crop||record.sowingDate!==farm.sowingDate)&&await get('SELECT id FROM monitor_observations WHERE farm_id=? LIMIT 1',row.id))fail(409,'Create a new profile for a different crop or sowing cycle to keep your check-in history accurate.');
  const result=await run('UPDATE monitor_farms SET record=?,revision=revision+1,updated=? WHERE id=? AND user_id=? AND revision=?',JSON.stringify(record),Date.now(),row.id,u.id,d.revision);if(result.meta.changes!==1)fail(409,'This farm profile changed. Refresh and try again.');return send(200,{ok:true});
 }
 if(action==='archive'&&method==='POST'){const d=await body(req);if(d.revision!==row.revision)fail(409,'Refresh this farm profile before archiving.');const result=await run('UPDATE monitor_farms SET archived=1,revision=revision+1,updated=? WHERE id=? AND user_id=? AND revision=?',Date.now(),row.id,u.id,d.revision);if(result.meta.changes!==1)fail(409,'This farm changed. Refresh and try again.');return send(200,{ok:true})}
 if(action==='weather'&&method==='GET')return send(200,{weather:await farmWeather(farm)});
 if(action==='checkins'&&method==='POST'){
  const record=observationRecord(await body(req),farm),id=randomUUID();rateLimit('monitor-checkin:'+u.id);await run('INSERT INTO monitor_observations VALUES(?,?,?,?)',id,row.id,JSON.stringify(record),Date.now());return send(201,{id});
 }
 if(action==='guidance'&&method==='POST'){
  rateLimit('monitor-guidance:'+u.id);const d=await body(req),language=['hi','te'].includes(d.language)?d.language:'en';
  let weather=null;try{weather=await farmWeather(farm)}catch{}
  const observations=(await all('SELECT * FROM monitor_observations WHERE farm_id=? ORDER BY created DESC LIMIT 5',row.id)).map(r=>({...JSON.parse(r.record),created:r.created}));
  const facts={farm:{crop:farm.crop,sowingDate:farm.sowingDate,area:farm.area,areaUnit:farm.areaUnit,irrigation:farm.irrigation,soilType:farm.soilType,place:farm.place},daysSinceSowing:daysSinceSowing(farm.sowingDate),farmerObservations:observations,weatherModel:weather};
  const result=await marketAssistant('monitorGuide',{text:JSON.stringify(facts),language},{key:env.GEMINI_API_KEY,model:env.GEMINI_MODEL});
  const record={...result,farmRevision:row.revision,weatherAt:weather?.fetchedAt||null,observationAt:observations[0]?.created||null},created=Date.now();
  await run('INSERT INTO monitor_guidance VALUES(?,?,?,?,?)',randomUUID(),row.id,language,JSON.stringify(record),created);return send(200,{guidance:{...record,created}});
 }
 fail(405,'This monitoring action is not supported.');
}
