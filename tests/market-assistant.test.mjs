import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createClient} from '@libsql/client';
import {marketAssistant,normalizeAssistant,matchesAssistantSearch} from '../lib/market-assistant.mjs';
import {databaseAdapter,migrate} from '../lib/database.mjs';
import {handleRequest} from '../lib/cloud-backend.mjs';
const reply=data=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]});
const filters={kind:'mango',category:null,term:null,place:'Vijayawada',minPrice:null,maxPrice:70,minQty:100,minQuality:null};
const draft={transcript:'200 kg tomatoes in Guntur at 25 per kg',name:'Tomatoes',kind:'tomato',category:'vegetables',qty:200,price:25,place:'Guntur',description:null,quality:null,cultivatedDate:null,harvestedDate:null};
test('assistant sends text/audio server-side, preserves missing values and bounds extraction',async()=>{
 let sent;
 const fetcher=async(url,options)=>{sent={url,headers:options.headers,body:JSON.parse(options.body)};return reply(draft)};
 const result=await marketAssistant('draft',{audio:'data:audio/wav;base64,UklGRmRhdGE=',language:'te'},{key:'test-private-key',fetcher});
 assert.equal(result.fields.qty,200);assert.equal(result.fields.quality,null);assert.equal(result.fields.harvestedDate,null);
 assert.equal(sent.body.contents[0].parts[0].inlineData.mimeType,'audio/wav');assert.match(sent.body.systemInstruction.parts[0].text,/Telugu/);assert.equal(sent.headers['x-goog-api-key'],'test-private-key');assert.ok(!JSON.stringify(result).includes('test-private-key'));
 const invalid=normalizeAssistant('draft',{...draft,qty:'200',price:-1,quality:101,cultivatedDate:'2025-99-99',harvestedDate:'2999-01-01'});
 for(const field of ['qty','price','quality','cultivatedDate','harvestedDate'])assert.equal(invalid.fields[field],null);
 await assert.rejects(marketAssistant('draft',{audio:'data:text/plain;base64,AAAA'},{key:'test',fetcher}),e=>e.status===400);
 await assert.rejects(marketAssistant('search',{text:'Mangoes'},{fetcher}),e=>e.status===503);
});
test('smart filters match actual inventory without guessing quality, location distance or price',async()=>{
 const normalized=await marketAssistant('search',{text:'Mangoes below 70 in Vijayawada'},{key:'test',fetcher:async()=>reply(filters)});
 const crop={name:'Mango',kind:'mango',category:'fruits',place:'Vijayawada, AP',price:65,qty:150,quality:null};
 assert.equal(matchesAssistantSearch(crop,normalized),true);
 for(const change of [{price:71},{place:'Guntur'},{qty:99},{kind:'tomato'}])assert.equal(matchesAssistantSearch({...crop,...change},normalized),false);
 assert.equal(matchesAssistantSearch(crop,{...normalized,minQuality:80}),false);
 assert.equal(normalizeAssistant('search',{...filters,maxPrice:'cheap'}).maxPrice,null);
});
test('translation rejects changed numbers and handles quota, malformed and blocked responses safely',async()=>{
 const input={text:'200 kg at 25 per kg',language:'hi'};
 const result=await marketAssistant('translate',input,{key:'private-test',fetcher:async()=>reply({translation:'200 किलो, 25 प्रति किलो'})});assert.match(result.translation,/200/);
 await assert.rejects(marketAssistant('translate',input,{key:'test',fetcher:async()=>reply({translation:'250 किलो, 25 प्रति किलो'})}),e=>e.status===502&&/changed a number/.test(e.message));
 for(const [fetcher,status]of [[async()=>Response.json({error:{message:'private-test'}},{status:429}),429],[async()=>Response.json({candidates:[{finishReason:'SAFETY'}]}),502],[async()=>new Response('broken'),502],[async()=>{throw Error('private-test')},502]])await assert.rejects(marketAssistant('search',{text:'Mangoes'},{key:'private-test',fetcher}),e=>e.status===status&&!e.message.includes('private-test'));
});
test('assistant routes protect drafts, filter only live inventory, and cache description translations',async()=>{
 const client=createClient({url:':memory:'}),originalFetch=globalThis.fetch;
 try{
  await migrate(client);const DB=databaseAdapter(client),env={DB,GEMINI_API_KEY:'test-private-key',DATABASE_PREPARED:true};
  for(const [id,role]of [['farmer','farmer'],['buyer','buyer']])await client.execute({sql:'INSERT INTO users(id,name,email,role,created) VALUES(?,?,?,?,1)',args:[id,id,id+'@gmail.com',role]});
  for(const [id,token]of [['farmer','a'.repeat(64)],['buyer','b'.repeat(64)]])await client.execute({sql:'INSERT INTO sessions VALUES(?,?,?)',args:[createHash('sha256').update(token).digest('hex'),id,Date.now()+60000]});
  for(const [id,price,archived]of [['match',6500,0],['expensive',9000,0],['archived',5000,1]])await client.execute({sql:"INSERT INTO crops(id,owner_id,name,kind,category,qty,price,place,description,archived,created) VALUES(?,'farmer','Mango','mango','fruits',150,?,'Vijayawada','200 kg at 25 per kg',?,1)",args:[id,price,archived]});
  const call=async(path,data,token='')=>handleRequest(new Request('http://localhost'+path,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',cookie:'mitti_session='+token},body:JSON.stringify(data)}),env);
  let count=0;globalThis.fetch=async(url,options)=>{count++;const body=JSON.parse(options.body),prompt=body.systemInstruction.parts[0].text;return reply(prompt.includes('Extract only explicit marketplace')?filters:prompt.includes('Translate the supplied')?{translation:'200 किलो, 25 प्रति किलो'}:draft)};
  assert.equal((await call('/api/assistant/draft',{text:'Tomatoes'})).status,401);
  assert.equal((await call('/api/assistant/draft',{text:'Tomatoes'},'b'.repeat(64))).status,403);assert.equal(count,0);
  const extracted=await call('/api/assistant/draft',{text:'Tomatoes'},'a'.repeat(64));assert.equal(extracted.status,200);assert.equal((await extracted.json()).fields.price,25);
  const search=await call('/api/assistant/search',{text:'Mangoes under 70 in Vijayawada'});assert.deepEqual((await search.json()).ids,['match']);
  const translated=await call('/api/crops/match/translate',{language:'hi'});assert.equal(translated.status,200);const after=count;
  assert.equal((await call('/api/crops/match/translate',{language:'hi'})).status,200);assert.equal(count,after);
  assert.equal((await call('/api/crops/archived/translate',{language:'hi'})).status,404);
  assert.equal((await call('/api/crops/match/translate',{language:'xx'})).status,400);
  assert.equal((await client.execute('SELECT COUNT(*) AS n FROM crops')).rows[0].n,3);
 }finally{globalThis.fetch=originalFetch;client.close()}
});
