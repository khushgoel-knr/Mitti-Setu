import {Buffer} from 'node:buffer';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {validEmail,normalizePhone} from './validation.mjs';
import {cropMetadata,estimateLegacyQuality} from './crop-metadata.mjs';
import {analyseCrop} from './crop-analysis.mjs';
import {marketAssistant,matchesAssistantSearch} from './market-assistant.mjs';
const translationCache=new Map();
const sha=s=>createHash('sha256').update(s).digest('hex');
async function hashPassword(password,salt,length){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:new TextEncoder().encode(salt)},key,length*8))}
const publicUser=u=>u?{id:u.id,name:u.name,email:u.email,role:u.role,language:u.language,phone:u.phone||''}:null;
function fail(status,message){throw Object.assign(new Error(message),{status})}
function textField(value,label,max=100,min=1){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail(400,`${label} must contain ${min}–${max} characters.`);return value.trim()}
function num(value,label,min,max,integer=false){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))fail(400,`Enter a valid ${label}.`);return value}
const money=(v,label,min=0)=>Math.round(num(v,label,min,10000000)*100);
const languages=new Set(['en','hi','te']),catalogue={tomato:'vegetables',rice:'grains',chilli:'vegetables',mango:'fruits',onion:'vegetables',potato:'vegetables',banana:'fruits',brinjal:'vegetables',other:null};
export async function seed(db){await db.prepare("INSERT OR IGNORE INTO users(id,name,email,role,created) VALUES(?,?,?,?,?)").bind('sample-farmer','Sample farmer','sample@invalid.local','farmer',1).run();await db.batch([["tomato","Fresh tomatoes","vegetables",300,2000,"Guntur"],["rice","Sona Masoori rice","grains",500,4800,"Tenali"],["chilli","Green chillies","vegetables",120,4200,"Mangalagiri"],["mango","Sweet mangoes","fruits",200,6500,"Vijayawada"],["onion","Red onions","vegetables",250,2800,"Kurnool"],["potato","Table potatoes","vegetables",300,2400,"Chittoor"],["banana","Ripe bananas","fruits",120,3600,"Kadapa"],["brinjal","Purple brinjals","vegetables",160,3200,"Guntur"],["tomato","Hybrid tomatoes","vegetables",500,1800,"Nellore"],["rice","Polished Sona Masoori","grains",200,5200,"Bapatla"],["mango","Banganapalli mangoes","fruits",150,7000,"Nuzvid"],["chilli","Long green chillies","vegetables",90,4500,"Prakasam"]].map(([kind,name,category,qty,price,place],i)=>db.prepare("INSERT OR IGNORE INTO crops(id,owner_id,name,kind,category,qty,price,place,description,sample,created) VALUES(?,?,?,?,?,?,?,?,?,1,?)").bind('sample-cloud-'+i,'sample-farmer',name,kind,category,qty,price,place,'Fictional sample listing. Illustrative price and availability; not available for purchase.',100-i)));await estimateLegacyQuality(db)}
const attempts=new Map();
function rateLimit(key){const now=Date.now(),e=attempts.get(key);if(!e||e.until<now){attempts.set(key,{count:1,until:now+600000});return}if(++e.count>30)fail(429,'Too many attempts. Try again in 10 minutes.');if(attempts.size>10000)for(const [k,v]of attempts)if(v.until<now)attempts.delete(k)}
let seedReady;
export async function handleRequest(req,env){
 const headers=new Headers({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Cache-Control':'no-store'});
 const send=(status,data)=>{headers.set('Content-Type','application/json; charset=utf-8');return new Response(JSON.stringify(data),{status,headers})};
 const db=env.DB;
 const bind=v=>v instanceof Uint8Array?v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength):v;
 const get=(q,...a)=>db.prepare(q).bind(...a.map(bind)).first();
 const all=async(q,...a)=>(await db.prepare(q).bind(...a.map(bind)).all()).results;
 const run=(q,...a)=>db.prepare(q).bind(...a.map(bind)).run();
 const cookieToken=req=>req.headers.get('cookie')?.match(/(?:^|;\s*)mitti_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 async function currentUser(req){const token=cookieToken(req);return token?await get('SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?',sha(token),Date.now()):null}
 async function requireUser(req,role){const u=await currentUser(req);if(!u)fail(401,'Please log in to continue.');if(role&&u.role!==role)fail(403,`This action is available to ${role}s only.`);return u}
 async function issueSession(u){const token=randomBytes(32).toString('hex');await run('DELETE FROM sessions WHERE expires<?',Date.now());await run('INSERT INTO sessions VALUES(?,?,?)',sha(token),u.id,Date.now()+7*86400000);headers.set('Set-Cookie',`mitti_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800; Secure`)}
 async function transaction(fn){const result=await fn();return result}
 async function body(req){if(!req.headers.get('content-type')?.startsWith('application/json'))fail(415,'Send JSON data.');let size=0,chunks=[];const reader=req.body?.getReader();if(!reader)fail(400,'Missing request data.');while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3000000){await reader.cancel();fail(413,'The request is too large.')}chunks.push(value)}try{const d=JSON.parse(Buffer.concat(chunks).toString());if(!d||Array.isArray(d)||typeof d!=='object')throw Error();return d}catch{fail(400,'Invalid request data.')}}
 async function saveImage(value,user){if(!value)return null;if(typeof value!=='string')fail(400,'Invalid image.');const m=value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);if(!m)fail(400,'Use a JPG, PNG or WebP image.');const bytes=Buffer.from(m[2],'base64');if(bytes.length>1.5*1024*1024||bytes.length<12)fail(400,'Choose an image smaller than 1.5 MB.');const type=m[1],valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';if(!valid)fail(400,'Image contents do not match its type.');const id=randomUUID();await run('INSERT INTO media VALUES(?,?,?,?)',id,user.id,type,bytes);return id}
 function cropData(d){const kind=d.kind;if(!Object.hasOwn(catalogue,kind))fail(400,'Choose a crop type.');const category=catalogue[kind]||d.category;if(!['vegetables','grains','fruits'].includes(category))fail(400,'Choose a category.');return {...cropMetadata(d),name:textField(d.name,'Crop name',70),kind,category,qty:num(d.qty,'quantity',0,1000000,true),price:money(d.price,'price',0.01),place:textField(d.place,'Location',100),description:textField(d.description||'','Description',500,0)}}
 async function state(req){
  const u=await currentUser(req),uid=u?.id||'';
  const [crops,offers,sellerStats]=await Promise.all([
   all(`SELECT c.*,u.name AS owner_name,demo.score AS demo_score,mine.rating AS my_rating,mine.comment AS my_review,ratings.trust_score,COALESCE(ratings.rating_count,0) AS rating_count,CASE WHEN c.sample=0 AND (?='buyer' OR c.owner_id=?) THEN u.phone ELSE '' END AS contactPhone FROM crops c JOIN users u ON u.id=c.owner_id LEFT JOIN (SELECT seller_id,ROUND(AVG(rating),2) AS trust_score,COUNT(*) AS rating_count FROM seller_ratings GROUP BY seller_id) ratings ON ratings.seller_id=c.owner_id LEFT JOIN seller_demo_scores demo ON demo.seller_id=c.owner_id LEFT JOIN seller_ratings mine ON mine.seller_id=c.owner_id AND mine.buyer_id=? WHERE (c.archived=0 AND c.qty>0) OR c.owner_id=? OR EXISTS(SELECT 1 FROM offers o WHERE o.crop_id=c.id AND o.buyer_id=?) ORDER BY c.sample ASC,c.created DESC`,u?.role||'',uid,uid,uid,uid),
   u?all(`SELECT o.*,u.name AS buyer,u.phone AS contactPhone,r.rating AS review_rating,r.comment AS review_comment FROM offers o JOIN users u ON u.id=o.buyer_id JOIN crops c ON c.id=o.crop_id LEFT JOIN seller_ratings r ON r.seller_id=c.owner_id AND r.buyer_id=o.buyer_id WHERE o.buyer_id=? OR c.owner_id=? ORDER BY o.created DESC`,uid,uid):[],
   u?.role==='farmer'?get('SELECT ROUND(AVG(rating),2) AS trust_score,COUNT(*) AS rating_count,(SELECT score FROM seller_demo_scores WHERE seller_id=?) AS demo_score FROM seller_ratings WHERE seller_id=?',uid,uid):null
  ]);
  return {user:u?{...publicUser(u),...(sellerStats||{})}:null,crops:crops.map(c=>({...c,owner:c.owner_name,mine:c.owner_id===uid,price:c.price/100,sample:!!c.sample,archived:!!c.archived,image:c.image_id?`/media/${c.image_id}`:null})),offers:offers.map(o=>({...o,crop:o.crop_id,price:o.price/100,transport:o.transport/100,handling:o.handling/100}))};
 }


 try{if(!['GET','HEAD'].includes(req.method)){const reader=req.body?.getReader(),parts=[];let size=0;if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3000000){await reader.cancel();fail(413,'The request is too large.')}parts.push(value)}const buffered=Buffer.concat(parts);req=new Request(req.url,{method:req.method,headers:req.headers,body:buffered});}if(!env.DATABASE_PREPARED){if(!seedReady)seedReady=seed(db).catch(e=>{seedReady=null;throw e});await seedReady;}
 const host=new URL(req.url).host;
 if(!['GET','HEAD'].includes(req.method)){if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)fail(403,'Cross-site requests are not allowed.');if(req.headers.get('sec-fetch-site')==='cross-site')fail(403,'Cross-site requests are not allowed.')}
 const pathname=decodeURIComponent(new URL(req.url,`http://${host}`).pathname);
 if(pathname==='/api/state'&&req.method==='GET')return send(200,await state(req));
 if(pathname==='/api/assistant/status'&&req.method==='GET')return send(200,{configured:!!env.GEMINI_API_KEY});
 if(pathname==='/api/assistant/draft'&&req.method==='POST'){
  const u=await requireUser(req,'farmer'),d=await body(req);rateLimit('assistant-draft:'+u.id);
  return send(200,await marketAssistant('draft',d,{key:env.GEMINI_API_KEY,model:env.GEMINI_MODEL}));
 }
 if(pathname==='/api/assistant/search'&&req.method==='POST'){
  const d=await body(req);textField(d.text,'Search',300);rateLimit('assistant-search:'+((process.env.VERCEL?req.headers.get('x-forwarded-for')?.split(',')[0]?.trim():null)||'visitor'));
  const filters=await marketAssistant('search',d,{key:env.GEMINI_API_KEY,model:env.GEMINI_MODEL});
  const crops=await all('SELECT id,name,kind,category,place,description,price/100.0 AS price,qty,quality FROM crops WHERE archived=0 AND qty>0');
  return send(200,{filters,ids:crops.filter(c=>matchesAssistantSearch(c,filters)).map(c=>c.id)});
 }
 const translateMatch=pathname.match(/^\/api\/crops\/([a-zA-Z0-9-]+)\/translate$/);
 if(translateMatch&&req.method==='POST'){
  const d=await body(req);if(!languages.has(d.language))fail(400,'Choose a supported language.');
  const c=await get('SELECT description FROM crops WHERE id=? AND archived=0 AND qty>0',translateMatch[1]);if(!c)fail(404,'Listing not found.');
  if(!c.description)return send(200,{translation:''});
  const cacheKey=sha(c.description+'|'+d.language);if(translationCache.has(cacheKey))return send(200,translationCache.get(cacheKey));
  rateLimit('assistant-translate:'+((process.env.VERCEL?req.headers.get('x-forwarded-for')?.split(',')[0]?.trim():null)||'visitor'));
  const result=await marketAssistant('translate',{text:c.description,language:d.language},{key:env.GEMINI_API_KEY,model:env.GEMINI_MODEL});
  if(translationCache.size>=200)translationCache.delete(translationCache.keys().next().value);translationCache.set(cacheKey,result);return send(200,result);
 }
 if(pathname==='/api/care/reports'&&req.method==='GET'){const u=await requireUser(req);return send(200,{reports:(await all('SELECT id,record,created FROM care_reports WHERE user_id=? ORDER BY created DESC LIMIT 50',u.id)).map(r=>({...JSON.parse(r.record),id:r.id,created:r.created}))})}
 if(pathname==='/api/care/reports'&&req.method==='POST'){const u=await requireUser(req),d=await body(req),record={crop:textField(d.crop,'Crop',70),symptom:num(d.symptom,'symptom',0,3,true),days:num(d.days,'days',1,365,true),notes:textField(d.notes||'','Notes',1000,0),urgent:d.urgent===true};const id=randomUUID(),created=Date.now();await run('INSERT INTO care_reports VALUES(?,?,?,?)',id,u.id,JSON.stringify(record),created);return send(201,{id,created})}
 if(pathname==='/api/care/status'&&req.method==='GET')return send(200,{configured:!!(env.GEMINI_API_KEY||env.PLANT_ID_API_KEY),provider:env.GEMINI_API_KEY?'Google Gemini':'Kindwise plant.health'});
 if(pathname==='/api/care/analyse'&&req.method==='POST'){rateLimit('analysis:'+((process.env.VERCEL?req.headers.get('x-forwarded-for')?.split(',')[0]?.trim():null)||'visitor'));const d=await body(req);return send(200,await analyseCrop(d.image,{language:d.language,key:env.PLANT_ID_API_KEY||'',geminiKey:env.GEMINI_API_KEY||'',model:env.GEMINI_MODEL}))}
 if(pathname==='/api/health'&&req.method==='GET')return send(200,{ok:true,database:true});
 if(pathname==='/api/register'&&req.method==='POST'){
 rateLimit(((process.env.VERCEL?req.headers.get('x-forwarded-for')?.split(',')[0]?.trim():null)||'visitor'));const d=await body(req),name=textField(d.name,'Name',60),email=textField(d.email,'Email',254).toLowerCase();if(!validEmail(email))fail(400,'Use an address ending in @gmail.com or @srmap.edu.in.');const phone=normalizePhone(d.phone);if(!phone)fail(400,'Enter a valid 10-digit Indian mobile number.');if(!['farmer','buyer'].includes(d.role))fail(400,'Choose Farmer or Buyer.');if(typeof d.password!=='string'||d.password.length<10||d.password.length>128)fail(400,'Use a password with 10–128 characters.');if(await get('SELECT id FROM users WHERE email=?',email))fail(409,'An account already uses this email.');const salt=randomBytes(16).toString('hex'),hash=await hashPassword(d.password,salt,64),id=randomUUID();try{await run('INSERT INTO users(id,name,email,password,salt,role,language,created,phone) VALUES(?,?,?,?,?,?,?,?,?)',id,name,email,hash.toString('hex'),salt,d.role,languages.has(d.language)?d.language:'en',Date.now(),phone)}catch(e){if(/UNIQUE constraint/.test(e.message))fail(409,'An account already uses this email.');throw e}const u=await get('SELECT * FROM users WHERE id=?',id);await issueSession(u);return send(201,{user:publicUser(u)});}
 if(pathname==='/api/login'&&req.method==='POST'){
 rateLimit(((process.env.VERCEL?req.headers.get('x-forwarded-for')?.split(',')[0]?.trim():null)||'visitor'));const d=await body(req),email=textField(d.email,'Email',254).toLowerCase();if(!validEmail(email))fail(400,'Use an address ending in @gmail.com or @srmap.edu.in.');if(typeof d.password!=='string'||d.password.length>128)fail(400,'Enter your password.');const u=await get('SELECT * FROM users WHERE email=?',email),actual=await hashPassword(d.password,u?.salt||'constant-missing-account-salt',64);if(!u?.password||!timingSafeEqual(actual,Buffer.from(u.password,'hex')))fail(401,'Email or password is incorrect.');const phone=normalizePhone(d.phone);if(!phone)fail(400,'Enter a valid 10-digit Indian mobile number.');await run('UPDATE users SET phone=? WHERE id=?',phone,u.id);u.phone=phone;await issueSession(u);return send(200,{user:publicUser(u)});}
 if(pathname==='/api/logout'&&req.method==='POST'){await body(req);const token=cookieToken(req);if(token)await run('DELETE FROM sessions WHERE token_hash=?',sha(token));headers.set('Set-Cookie','mitti_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure');return send(200,{ok:true})}
 if(pathname==='/api/me'&&req.method==='PATCH'){const u=await requireUser(req),d=await body(req);if(Object.hasOwn(d,'phone')){const phone=normalizePhone(d.phone);if(!phone)fail(400,'Enter a valid 10-digit Indian mobile number.');await run('UPDATE users SET phone=? WHERE id=?',phone,u.id);}else{if(!languages.has(d.language))fail(400,'Choose a supported language.');await run('UPDATE users SET language=? WHERE id=?',d.language,u.id);}return send(200,{ok:true})}
 if(pathname==='/api/crops'&&req.method==='POST'){const u=await requireUser(req,'farmer'),d=await body(req),c=cropData(d);if(!normalizePhone(u.phone))fail(400,'Add your mobile number in your dashboard before listing a crop.');if(c.qty<1)fail(400,'Add at least 1 kg.');const id=await transaction(async()=>{const id=randomUUID(),image=await saveImage(d.photo,u);await run('INSERT INTO crops(id,owner_id,name,kind,category,qty,price,place,description,image_id,created,quality,quality_source,cultivated_date,harvested_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.id,c.name,c.kind,c.category,c.qty,c.price,c.place,c.description,image,Date.now(),c.quality,c.quality_source,c.cultivated_date,c.harvested_date);return id});return send(201,{id})}

 const cm=pathname.match(/^\/api\/crops\/([a-zA-Z0-9-]+)(\/archive)?$/);
 if(cm&&['PATCH','POST'].includes(req.method)){
 const u=await requireUser(req,'farmer'),d=await body(req),c=await get('SELECT * FROM crops WHERE id=?',cm[1]);
 if(!c||c.owner_id!==u.id)fail(404,'Crop not found.');if(d.revision!==c.revision)fail(409,'This crop changed. Refresh and try again.');
 let statements;
 if(cm[2]&&req.method==='POST'){
 statements=[db.prepare('UPDATE crops SET archived=1,revision=revision+1 WHERE id=? AND revision=?').bind(c.id,d.revision),db.prepare("UPDATE offers SET status='declined' WHERE crop_id=? AND status='pending' AND EXISTS(SELECT 1 FROM crops WHERE id=? AND archived=1)").bind(c.id,c.id)];
 }else if(!cm[2]&&req.method==='PATCH'){
 if(c.archived)fail(409,'Removed crops cannot be edited. Add a new listing.');const v=cropData(d),image=d.photo?await saveImage(d.photo,u):d.removePhoto?null:c.image_id;
 statements=[db.prepare('UPDATE crops SET name=?,kind=?,category=?,qty=?,price=?,place=?,description=?,image_id=?,quality=?,quality_source=?,cultivated_date=?,harvested_date=?,revision=revision+1 WHERE id=? AND revision=?').bind(v.name,v.kind,v.category,v.qty,v.price,v.place,v.description,image,v.quality,v.quality_source,v.cultivated_date,v.harvested_date,c.id,d.revision),db.prepare("UPDATE offers SET status='declined' WHERE crop_id=? AND status='pending' AND qty>(SELECT qty FROM crops WHERE id=?)").bind(c.id,c.id)];
 }else fail(405,'Method not allowed.');
 const results=await db.batch(statements);if(results[0].meta.changes!==1)fail(409,'This crop changed. Refresh and try again.');return send(200,{ok:true});}
 async function saveSellerRating(sellerId,u,d){
  rateLimit('seller-rating:'+u.id);
  const seller=await get("SELECT id FROM users WHERE id=? AND role='farmer'",sellerId);
  if(!seller||seller.id==='sample-farmer')fail(404,'Seller not found.');
  if(seller.id===u.id)fail(403,'You cannot rate yourself.');
  const rating=num(d.rating,'rating from 0 to 5',0,5,true),comment=textField(d.comment||'','Review',500,0),now=Date.now();
  await run('INSERT INTO seller_ratings(seller_id,buyer_id,rating,comment,created,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(seller_id,buyer_id) DO UPDATE SET rating=excluded.rating,comment=excluded.comment,updated=excluded.updated',seller.id,u.id,rating,comment,now,now);
  return send(200,{ok:true});
 }
 const sellerReview=pathname.match(/^\/api\/sellers\/([a-zA-Z0-9-]+)\/rating$/);
 if(sellerReview&&req.method==='POST')return await saveSellerRating(sellerReview[1],await requireUser(req,'buyer'),await body(req));
 // Keep old accepted-offer links compatible, with the same per-seller uniqueness rule.
 const reviewMatch=pathname.match(/^\/api\/offers\/([a-zA-Z0-9-]+)\/review$/);
 if(reviewMatch&&req.method==='POST'){
  const u=await requireUser(req,'buyer'),d=await body(req);
  const offer=await get('SELECT o.*,c.owner_id,c.sample FROM offers o JOIN crops c ON c.id=o.crop_id WHERE o.id=?',reviewMatch[1]);
  if(!offer||offer.buyer_id!==u.id)fail(404,'Accepted trade not found.');
  if(offer.status!=='accepted'||offer.sample)fail(403,'Only the buyer on an accepted trade can use this review link.');
  if(d.received!==true)fail(400,'Confirm you received and checked this produce before rating.');
  return await saveSellerRating(offer.owner_id,u,d);
 }
 if(pathname==='/api/offers'&&req.method==='POST'){const u=await requireUser(req,'buyer'),d=await body(req);if(!normalizePhone(u.phone))fail(400,'Add your mobile number in your dashboard before sending an offer.');const id=await transaction(async()=>{const c=await get('SELECT * FROM crops WHERE id=?',d.crop);if(!c||c.archived||c.sample||c.qty===0)fail(409,'This listing is not available.');const qty=num(d.qty,'quantity',1,c.qty,true),price=money(d.price,'offer price',0.01),transport=money(d.transport,'transport'),handling=money(d.handling,'handling');if(price*qty<transport+handling)fail(400,'Costs cannot exceed the total offer.');if(await get("SELECT id FROM offers WHERE crop_id=? AND buyer_id=? AND status='pending'",c.id,u.id))fail(409,'You already have a pending offer. Withdraw it before sending another.');const id=randomUUID();await run('INSERT INTO offers(id,crop_id,buyer_id,qty,price,transport,handling,created) VALUES(?,?,?,?,?,?,?,?)',id,c.id,u.id,qty,price,transport,handling,Date.now());return id});return send(201,{id})}

 const om=pathname.match(/^\/api\/offers\/([a-zA-Z0-9-]+)\/(accept|decline|withdraw)$/);
 if(om&&req.method==='POST'){
 const u=await requireUser(req);await body(req);const o=await get('SELECT o.*,c.owner_id,c.qty AS stock,c.archived FROM offers o JOIN crops c ON c.id=o.crop_id WHERE o.id=?',om[1]);
 if(!o)fail(404,'Offer not found.');const a=om[2];if(a==='withdraw'?o.buyer_id!==u.id:o.owner_id!==u.id)fail(403,'This offer does not belong to you.');if(o.status!=='pending')fail(409,'This offer has already been updated.');
 if(a==='accept'){
 const result=await db.batch([
 db.prepare("UPDATE crops SET qty=qty-?,revision=revision+1 WHERE id=? AND owner_id=? AND archived=0 AND qty>=? AND EXISTS(SELECT 1 FROM offers WHERE id=? AND status='pending')").bind(o.qty,o.crop_id,u.id,o.qty,o.id),
 db.prepare("UPDATE offers SET status='accepted' WHERE id=? AND status='pending' AND changes()=1").bind(o.id),
 db.prepare("UPDATE offers SET status='declined' WHERE crop_id=? AND status='pending' AND qty>(SELECT qty FROM crops WHERE id=?)").bind(o.crop_id,o.crop_id)
 ]);if(result[0].meta.changes!==1)fail(409,'Not enough stock remains or the offer changed.');
 }else{const result=await run("UPDATE offers SET status=? WHERE id=? AND status='pending'",a==='withdraw'?'withdrawn':'declined',o.id);if(result.meta.changes!==1)fail(409,'This offer has already been updated.')}
 return send(200,{ok:true});}

 if(/^\/media\/[a-f0-9-]+$/.test(pathname)){const m=await get('SELECT mime,bytes FROM media WHERE id=?',pathname.slice(7));if(!m)fail(404,'Image not found.');headers.set('Content-Type',m.mime);headers.set('Cache-Control','private,max-age=3600');return new Response(Array.isArray(m.bytes)?new Uint8Array(m.bytes):m.bytes,{headers})}
 fail(404,'Not found.');
 }catch(e){const status=e.status||(/UNIQUE constraint/.test(e.message)?409:500);if(status===500)console.error('Request failed:',e.message);return send(status,{error:e.status?e.message:status===409?'An existing record conflicts with this request. Refresh and try again.':'Something went wrong. Please try again.'})}
}
