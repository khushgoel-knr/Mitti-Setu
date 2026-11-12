const invalid=message=>Object.assign(new Error(message),{status:400});
export const indiaToday=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
function date(value,label){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>indiaToday())throw invalid(`Enter a valid ${label} on or before today.`);
 const parsed=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw invalid(`Enter a valid ${label}.`);
 return value;
}
export function cropMetadata(data){
 if(!Number.isInteger(data.quality)||data.quality<0||data.quality>100)throw invalid('Choose a whole-number quality score from 0 to 100.');
 const cultivated=date(data.cultivatedDate,'cultivated date'),harvested=date(data.harvestedDate,'harvested date');
 if(harvested<cultivated)throw invalid('Harvested date must be on or after the cultivated date.');
 return {quality:data.quality,quality_source:'farmer',cultivated_date:cultivated,harvested_date:harvested};
}
// Legacy scores are explicitly illustrative price-position estimates, not inspections.
// Never overwrite a farmer's own declaration or manufacture missing crop dates.
export async function estimateLegacyQuality(db){
 await db.prepare(`WITH ranked AS (
  SELECT id,CASE WHEN COUNT(*) OVER(PARTITION BY kind,category)=1 THEN 75
   ELSE CAST(ROUND(60+30*PERCENT_RANK() OVER(PARTITION BY kind,category ORDER BY price)) AS INTEGER) END AS score
  FROM crops WHERE archived=0
 ) UPDATE crops SET quality=(SELECT score FROM ranked WHERE ranked.id=crops.id),quality_source='price_estimate'
 WHERE quality IS NULL AND id IN(SELECT id FROM ranked)`).run();
}
