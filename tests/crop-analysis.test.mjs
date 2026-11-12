import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyseCrop} from '../lib/crop-analysis.mjs';
import {analyseWithGemini,normalizeGeminiReport} from '../lib/gemini-crop-analysis.mjs';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const report={assessment:'likely_issue',crop:'Tomato',name:'Possible leaf damage',summary:'Visible spots need closer inspection.',observations:['Brown spots on a leaf'],conditions:[{name:'Possible leaf spot',cause:'Several infectious and non-infectious causes are possible.',description:'Compare the pattern on nearby leaves.',prevention:['Avoid splashing affected leaves.'],organic:['Use clean tools.'],chemical:['Ask an agricultural adviser to confirm the cause before selecting a locally authorized product.']}],nextSteps:['Photograph both sides of the leaf.'],expertHelp:'Seek local advice if symptoms spread.'};
test('Gemini receives the photo server-side and returns a bounded report without fabricated scores',async()=>{
 const secret='fake-test-secret';let request;
 const result=await analyseCrop(image,{geminiKey:secret,key:'unused-kindwise-key',language:'te',fetcher:async(url,init)=>{request={url,init};return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report)}]}}]})}});
 assert.match(request.url,/gemini-3\.5-flash-lite:generateContent$/);
 assert.ok(!request.url.includes(secret));assert.equal(request.init.headers['x-goog-api-key'],secret);
 const body=JSON.parse(request.init.body);assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/png');assert.match(body.systemInstruction.parts[0].text,/Telugu/);
 assert.equal(result.source,'Google Gemini');assert.equal(result.confidence,null);assert.equal(result.suggestions[0].probability,null);assert.equal(result.nextSteps.length,1);assert.ok(!JSON.stringify(result).includes(secret));
});
test('unclear, non-plant and healthy reports do not invent disease suggestions',()=>{
 for(const assessment of ['unclear','not_plant','no_visible_issue']){const result=normalizeGeminiReport({...report,assessment,conditions:[]});assert.equal(result.suggestions.length,0);assert.equal(result.plant,assessment!=='not_plant');assert.equal(result.healthy,assessment==='no_visible_issue')}
 assert.throws(()=>normalizeGeminiReport({...report,conditions:[]}),/reliably/);
 assert.throws(()=>normalizeGeminiReport({...report,observations:'invalid'}),/incomplete/);
});
test('provider failures are safe, actionable and do not reveal credentials or provider payloads',async()=>{
 for(const status of [401,403,404,429,500])await assert.rejects(analyseWithGemini(image,{key:'fake-test-secret',fetcher:async()=>Response.json({error:{message:'fake-test-secret private provider detail'}},{status})}),e=>e.status===(status===429?429:502)&&!e.message.includes('fake-test-secret'));
 await assert.rejects(analyseWithGemini(image,{key:'fake-test-secret',fetcher:async()=>{throw Object.assign(new Error('private URL'),{name:'AbortError'})}}),e=>e.status===504);
 await assert.rejects(analyseWithGemini('not-an-image',{key:'fake-test-secret',fetcher:()=>{throw Error('must not call provider')}}),e=>e.status===400);
 await assert.rejects(analyseWithGemini(image,{key:'fake-test-secret',fetcher:async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]})}),/complete crop report/);
 await assert.rejects(analyseWithGemini(image,{key:'fake-test-secret',fetcher:async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'not json'}]}}]})}),/could not be read/);
});
