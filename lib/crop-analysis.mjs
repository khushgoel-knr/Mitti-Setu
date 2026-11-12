// Provider credentials remain server-side. Keep existing Kindwise setups working.
import {analyseWithGemini} from './gemini-crop-analysis.mjs';
export async function analyseCrop(image,{key=process.env.PLANT_ID_API_KEY,geminiKey=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL,fetcher=fetch,language='en'}={}){
 if(geminiKey)return analyseWithGemini(image,{key:geminiKey,model,fetcher,language});
 if(!key)throw Object.assign(new Error('Photo analysis is not connected yet. The site owner needs to configure the crop-photo diagnosis provider. Guided crop care is available under Other options.'),{status:503});
 if(typeof image!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>2800000)throw Object.assign(new Error('Choose a valid crop photo smaller than 2 MB after optimisation.'),{status:400});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
 try{
 const response=await fetcher('https://api.plant.id/v3/health_assessment?details=description,treatment,cause,local_name&language='+(language==='hi'?'hi':'en'),{method:'POST',headers:{'Content-Type':'application/json','Api-Key':key},body:JSON.stringify({images:[image],similar_images:false}),signal:controller.signal});
 if(!response.ok)throw Object.assign(new Error(response.status===429?'The analysis service is busy or has no credits. Please try later.':'The analysis service could not complete the request. Check the configured service and try again.'),{status:502});
 const data=await response.json(),result=data.result;
 if(!result||typeof result.is_plant?.binary!=='boolean'||typeof result.is_healthy?.binary!=='boolean')throw Object.assign(new Error('The analysis service returned an incomplete report. Try a clearer photo.'),{status:502});
 if(!result.is_plant.binary)return {plant:false,name:'No plant detected',description:'Choose a clear photo of an affected leaf, stem or fruit.',suggestions:[],source:'Kindwise plant.health'};
 const suggestions=(result.disease?.suggestions||[]).slice(0,3).map(s=>({name:String(s.details?.local_name||s.name||'Unidentified concern'),probability:Number.isFinite(s.probability)?Math.max(0,Math.min(1,s.probability)):null,cause:String(s.details?.cause||''),description:typeof s.details?.description==='string'?s.details.description:String(s.details?.description?.value||''),prevention:Array.isArray(s.details?.treatment?.prevention)?s.details.treatment.prevention.map(String):[],organic:Array.isArray(s.details?.treatment?.biological)?s.details.treatment.biological.map(String):[],chemical:Array.isArray(s.details?.treatment?.chemical)?s.details.treatment.chemical.map(String):[]}));
 if(!result.is_healthy.binary&&!suggestions.length)throw Object.assign(new Error('No reliable disease suggestion was returned. Try another photo or consult a local expert.'),{status:502});
 return {plant:true,healthy:result.is_healthy.binary,name:result.is_healthy.binary?'No visible disease suggested':suggestions[0].name,confidence:result.is_healthy.binary?result.is_healthy.probability:suggestions[0].probability,suggestions:result.is_healthy.binary?[]:suggestions,source:'Kindwise plant.health',created:Date.now()};
 }catch(e){if(e.name==='AbortError')throw Object.assign(new Error('Analysis timed out. Please try again.'),{status:504});throw e}finally{clearTimeout(timer)}
}
