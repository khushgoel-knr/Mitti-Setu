import {indiaToday} from './crop-metadata.mjs';
const fail=message=>Object.assign(new Error(message),{status:400});
const field=(v,label,max=100)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw fail('Enter a valid '+label+'.');return v.trim()};
function number(v,label,min,max){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw fail('Enter a valid '+label+'.');return v}
function choice(v,values,label){if(!values.includes(v))throw fail('Choose a valid '+label+'.');return v}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'1900-01-01'||v>indiaToday())throw fail('Use a valid date on or before today.');const parsed=new Date(v+'T00:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==v)throw fail('Use a real calendar date.');return v}
export const irrigationMethods=['drip','sprinkler','flood','furrow','rainfed','manual'];
export const cropStages=['unknown','germination','vegetative','flowering','fruiting','maturity','harvested'];
export const cropHealth=['unknown','healthy','stress','pests','disease'];
export function farmRecord(d){return {farmName:field(d.farmName,'farm name',70),crop:field(d.crop,'crop',70),place:field(d.place,'location'),sowingDate:date(d.sowingDate),area:number(d.area,'farm size',0.001,100000),areaUnit:choice(d.areaUnit,['acre','hectare'],'area unit'),irrigation:choice(d.irrigation,irrigationMethods,'irrigation method'),soilType:typeof d.soilType==='string'?d.soilType.trim().slice(0,100):'',latitude:number(d.latitude,'confirmed latitude',6,38),longitude:number(d.longitude,'confirmed longitude',68,98)}}
export function observationRecord(d,farm){const observedDate=date(d.observedDate);if(observedDate<farm.sowingDate)throw fail('The check-in cannot be before the sowing date.');return {observedDate,moisture:d.moisture===null||d.moisture===undefined?null:number(d.moisture,'soil moisture percentage',0,100),health:choice(d.health,cropHealth,'crop health'),stage:choice(d.stage,cropStages,'crop stage'),irrigated:d.irrigated===true,irrigationMm:d.irrigated===true&&d.irrigationMm!==null&&d.irrigationMm!==undefined?number(d.irrigationMm,'irrigation amount',0,1000):null,notes:typeof d.notes==='string'?d.notes.trim().slice(0,1000):''}}
export function daysSinceSowing(dateString,today=indiaToday()){return Math.max(0,Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(dateString+'T00:00:00Z'))/86400000))}
const weatherCache=new Map(),placeCache=new Map();
async function remoteJSON(url,fetcher){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetcher(url,{signal:controller.signal});if(!r.ok)throw Error();return await r.json()}catch{throw Object.assign(new Error('Weather service is temporarily unavailable. Your saved farm and check-ins are still available.'),{status:502})}finally{clearTimeout(timer)}}
export async function findFarmLocations(query,{fetcher=fetch}={}){
 const q=field(query,'village or town',100);if(q.length<2)throw fail('Enter at least two letters of your village or town.');
 const key=q.toLowerCase();if(placeCache.has(key)&&Date.now()-placeCache.get(key).created<3600000)return placeCache.get(key).places;
 const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name:q,count:'8',language:'en',format:'json',countryCode:'IN'}).toString();
 const data=await remoteJSON(url,fetcher),places=(data.results||[]).filter(p=>p.country_code==='IN').map(p=>({id:p.id,label:[p.name,p.admin2,p.admin1].filter(Boolean).join(', '),latitude:p.latitude,longitude:p.longitude}));
 if(placeCache.size>=100)placeCache.delete(placeCache.keys().next().value);placeCache.set(key,{created:Date.now(),places});return places;
}
export async function farmWeather(farm,{fetcher=fetch}={}){
 const key=farm.latitude.toFixed(3)+','+farm.longitude.toFixed(3),cached=weatherCache.get(key);if(cached&&Date.now()-cached.fetchedAt<900000)return cached;
 const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:String(farm.latitude),longitude:String(farm.longitude),current:'temperature_2m,relative_humidity_2m,precipitation',hourly:'soil_moisture_0_to_1cm',daily:'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',forecast_days:'7',timezone:'Asia/Kolkata'}).toString();
 try{
  const data=await remoteJSON(url,fetcher);if(!data.current||!data.daily||!Array.isArray(data.daily.time))throw Error();
  const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:null,index=Math.max(0,(data.hourly?.time||[]).findLastIndex(t=>t<=data.current.time));
  const result={source:'Open-Meteo',fetchedAt:Date.now(),weatherTime:data.current.time,timezone:'Asia/Kolkata',temperature:numeric(data.current.temperature_2m),humidity:numeric(data.current.relative_humidity_2m),precipitation:numeric(data.current.precipitation),surfaceMoisture:numeric(data.hourly?.soil_moisture_0_to_1cm?.[index]),days:data.daily.time.slice(0,7).map((date,i)=>({date,min:numeric(data.daily.temperature_2m_min?.[i]),max:numeric(data.daily.temperature_2m_max?.[i]),rain:numeric(data.daily.precipitation_sum?.[i]),rainChance:numeric(data.daily.precipitation_probability_max?.[i])})),stale:false};
  if(weatherCache.size>=100)weatherCache.delete(weatherCache.keys().next().value);weatherCache.set(key,result);return result;
 }catch{if(cached&&Date.now()-cached.fetchedAt<21600000)return {...cached,stale:true};throw Object.assign(new Error('Local weather could not be loaded. Your farm profile and check-ins are safe; try again shortly.'),{status:502})}
}
