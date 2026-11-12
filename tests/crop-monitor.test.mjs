import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createClient} from '@libsql/client';
import {migrate,databaseAdapter} from '../lib/database.mjs';
import {handleRequest} from '../lib/cloud-backend.mjs';
import {farmRecord,observationRecord,daysSinceSowing,farmWeather} from '../lib/crop-monitor.mjs';
import {normalizeAssistant} from '../lib/market-assistant.mjs';
const farm={farmName:'North plot',crop:'Rice',place:'Tenali',sowingDate:'2026-01-01',area:2,areaUnit:'acre',irrigation:'drip',soilType:'Loam',latitude:16.245,longitude:80.64};
const weather={current:{time:'2026-11-13T10:15',temperature_2m:0,relative_humidity_2m:0,precipitation:0},hourly:{time:['2026-11-13T10:00'],soil_moisture_0_to_1cm:[0]},daily:{time:['2026-11-13'],temperature_2m_min:[0],temperature_2m_max:[20],precipitation_sum:[0],precipitation_probability_max:[0]}};
test('monitor validation preserves unknown/zero readings and rejects impossible dates, area and coordinates',()=>{
 assert.equal(daysSinceSowing('2026-01-01','2026-01-03'),2);assert.equal(farmRecord(farm).area,2);
 for(const change of [{area:0},{latitude:null},{longitude:0},{sowingDate:'2999-01-01'},{sowingDate:'2025-02-29'},{irrigation:'auto'},{areaUnit:'bigha'}])assert.throws(()=>farmRecord({...farm,...change}),e=>e.status===400);
 const observation={observedDate:'2026-01-02',moisture:null,health:'unknown',stage:'unknown',irrigated:false};
 assert.equal(observationRecord(observation,farm).moisture,null);assert.equal(observationRecord({...observation,moisture:0},farm).moisture,0);
 for(const change of [{moisture:101},{observedDate:'2025-12-31'},{observedDate:'2999-01-01'},{stage:'AI verified'}])assert.throws(()=>observationRecord({...observation,...change},farm),e=>e.status===400);
 const draft=normalizeAssistant('monitorDraft',{transcript:'My rice field',crop:'Rice',latitude:99,areaUnit:'bigha',area:'2',sowingDate:'2025-02-29'});assert.equal(draft.fields.area,null);assert.equal(draft.fields.areaUnit,null);assert.equal(draft.fields.sowingDate,null);assert.equal(draft.fields.latitude,undefined);
});
test('weather is labelled model data, preserves zeros, caches and marks fallback data stale',async()=>{
 const originalNow=Date.now;let now=originalNow();Date.now=()=>now;let calls=0;
 try{
  const first=await farmWeather({...farm,latitude:17.123,longitude:81.123},{fetcher:async url=>{calls++;assert.match(url.href,/soil_moisture_0_to_1cm/);return Response.json(weather)}});
  assert.equal(first.temperature,0);assert.equal(first.surfaceMoisture,0);assert.equal(first.days[0].rain,0);assert.equal(first.source,'Open-Meteo');assert.equal(first.stale,false);
  await farmWeather({...farm,latitude:17.123,longitude:81.123},{fetcher:()=>{throw Error()}});assert.equal(calls,1);
  now+=16*60000;const stale=await farmWeather({...farm,latitude:17.123,longitude:81.123},{fetcher:()=>{throw Error()}});assert.equal(stale.stale,true);assert.equal(stale.fetchedAt,first.fetchedAt);
 }finally{Date.now=originalNow}
});
test('farm profiles, check-ins, guidance and archives stay private, revisioned and persistent',async()=>{
 const client=createClient({url:':memory:'}),originalFetch=globalThis.fetch;
 try{
  await migrate(client);await migrate(client);const env={DB:databaseAdapter(client),DATABASE_PREPARED:true,GEMINI_API_KEY:'test-only'};
  for(const [id,role,letter]of [['farmer','farmer','a'],['other','farmer','c'],['buyer','buyer','b']]){await client.execute({sql:'INSERT INTO users(id,name,email,role,created) VALUES(?,?,?,?,1)',args:[id,id,id+'@gmail.com',role]});await client.execute({sql:'INSERT INTO sessions VALUES(?,?,?)',args:[createHash('sha256').update(letter.repeat(64)).digest('hex'),id,Date.now()+60000]})}
  let guideFacts;
  globalThis.fetch=async(url,options)=>{
   if(String(url).includes('geocoding'))return Response.json({results:[{id:1,name:'Tenali',country_code:'IN',latitude:16.245,longitude:80.64}]});
   if(String(url).includes('open-meteo'))return Response.json(weather);
   const payload=JSON.parse(options.body);guideFacts=JSON.parse(JSON.parse(payload.contents[0].parts[0].text).text);
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({summary:'Review field observations.',actions:['Check root-zone moisture.'],irrigation:'Check drainage before watering.',stageNote:'Record the stage you can see.'})}]}}]});
  };
  const call=async(path,method='GET',data,letter='a')=>handleRequest(new Request('http://localhost'+path,{method,headers:{origin:'http://localhost',cookie:'mitti_session='+(letter?letter.repeat(64):''),...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined}),env);
  assert.equal((await call('/api/monitor/farms','GET',null,'')).status,401);assert.equal((await call('/api/monitor/farms','GET',null,'b')).status,403);
  const created=await call('/api/monitor/farms','POST',farm);assert.equal(created.status,201);const {id}=await created.json(),url='/api/monitor/farms/'+id;
  assert.equal((await call(url,'GET',null,'c')).status,404);assert.equal((await call(url+'/checkins','POST',{},'c')).status,404);
  const places=await call('/api/monitor/locations','POST',{query:'Tenali'});assert.equal((await places.json()).places[0].latitude,16.245);
  const list=await call('/api/monitor/farms');assert.equal((await list.json()).farms.length,1);
  assert.equal((await call(url+'/weather')).status,200);
  assert.equal((await call(url+'/checkins','POST',{observedDate:'2026-01-02',moisture:32.5,health:'stress',stage:'vegetative',irrigated:true,irrigationMm:5,notes:'Lower leaves yellow'})).status,201);
  const detail=await (await call(url)).json();assert.equal(detail.observations[0].moisture,32.5);assert.equal(detail.farm.crop,'Rice');
  const guide=await call(url+'/guidance','POST',{language:'en'});assert.equal(guide.status,200);assert.equal(guideFacts.farmerObservations[0].health,'stress');assert.equal(guideFacts.weatherModel.source,'Open-Meteo');assert.ok(!JSON.stringify(guideFacts).includes('test-only'));
  assert.equal((await (await call(url)).json()).guidance.farmRevision,1);
  assert.equal((await call(url,'PATCH',{...farm,crop:'Mango',revision:1})).status,409);
  assert.equal((await call(url,'PATCH',{...farm,farmName:'Renamed plot',revision:1})).status,200);assert.equal((await call(url,'PATCH',{...farm,revision:1})).status,409);
  assert.equal((await call(url+'/archive','POST',{revision:2})).status,200);assert.equal((await call(url)).status,404);assert.equal((await client.execute('SELECT COUNT(*) AS n FROM monitor_observations')).rows[0].n,1);
 }finally{globalThis.fetch=originalFetch;client.close()}
});
test('voice recording continues across segments without a total cutoff, stops tracks and resumes failed analysis parts',async()=>{
 const code=await readFile(new URL('../public/voice-assistant.js',import.meta.url),'utf8');
 const timers=new Map();let timerId=0,stops=0,requests=0;
 const nodes=new Map(),node=()=>({textContent:'',isConnected:true,disabled:false,value:'',append(){},replaceChildren(){},setAttribute(){},addEventListener(){}}),fields=new Map();
 const form={...node(),id:'monitor-form',elements:{namedItem:key=>{if(!fields.has(key))fields.set(key,{value:''});return fields.get(key)}}};
 nodes.set('#monitor-form',form);nodes.set('#modal',{open:true});nodes.set('#voice-text',{...node(),value:''});nodes.set('#voice-status',node());nodes.set('#voice-playback',node());nodes.set('[data-action="assistRecord"]',node());nodes.set('[data-action="assistFill"]',node());
 class Recorder{static isTypeSupported(){return true}constructor(){this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});this.onstop?.()}}
 const context=vm.createContext({Blob,URL,MediaRecorder:Recorder,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})}},document:{createElement:()=>node()},setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),$:key=>nodes.get(key)||null,t:k=>k,lang:'en',audioAsWav:async()=> 'data:audio/wav;base64,UklGRg==',api:async()=>{requests++;if(requests===2)throw Error('Temporary quota');return {transcript:'part',fields:requests===1?{crop:'Rice',area:2}:{crop:null,area:3,irrigation:'drip'}}}});
 vm.runInContext('let voiceRecorder=null,voiceStream=null,voiceBlob=null,voiceURL="",voiceTimer=null,voiceForm=null,voiceBusy=false,voiceGeneration=0;',context);vm.runInContext(code,context);
 await vm.runInContext('toggleVoiceRecording()',context);
 for(let i=0;i<3;i++){const [id,fn]=timers.entries().next().value;timers.delete(id);fn()}
 assert.equal(vm.runInContext('voiceRecording',context),true);assert.equal(vm.runInContext('voiceClips.length',context),3);assert.equal(stops,0);
 await vm.runInContext('toggleVoiceRecording()',context);assert.equal(vm.runInContext('voiceRecording',context),false);assert.equal(stops,1);assert.equal(vm.runInContext('voiceClips.length',context),4);
 await vm.runInContext('fillVoiceDraft()',context);assert.equal(requests,2);assert.equal(vm.runInContext('voiceResults.length',context),1);assert.match(nodes.get('#voice-status').textContent,/voiceRetry/);
 await vm.runInContext('fillVoiceDraft()',context);assert.equal(requests,5);assert.equal(fields.get('crop').value,'Rice');assert.equal(fields.get('area').value,'3');assert.equal(fields.get('irrigation').value,'drip');assert.equal(vm.runInContext('voiceBusy',context),false);
 vm.runInContext('discardVoice()',context);assert.equal(vm.runInContext('voiceClips.length',context),0);
});
