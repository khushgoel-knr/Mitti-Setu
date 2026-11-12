import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {databaseAdapter,migrate} from '../lib/database.mjs';
import {databaseConfig,databaseFailure} from '../lib/database-errors.mjs';
import {validEmail,normalizePhone} from '../lib/validation.mjs';
import {cropMetadata,estimateLegacyQuality} from '../lib/crop-metadata.mjs';
test('quality and crop dates reject invalid values, future dates and reversed chronology',()=>{
 const valid={quality:0,cultivatedDate:'2024-02-29',harvestedDate:'2024-03-01'};
 assert.deepEqual(cropMetadata(valid),{quality:0,quality_source:'farmer',cultivated_date:'2024-02-29',harvested_date:'2024-03-01'});
 for(const bad of [{quality:101},{quality:-1},{quality:1.5},{quality:null},{cultivatedDate:'2025-02-29'},{harvestedDate:'2999-01-01'},{harvestedDate:'2024-02-01'},{cultivatedDate:''}])assert.throws(()=>cropMetadata({...valid,...bad}),e=>e.status===400);
});
test('legacy quality estimates are labelled, preserve declarations, never invent dates, and run once per missing score',async()=>{
 const client=createClient({url:':memory:'});
 try{
  await migrate(client);const db=databaseAdapter(client);
  await client.execute("INSERT INTO users(id,name,email,role,created) VALUES('seller','Fixture','fixture@gmail.com','farmer',1)");
  for(const [id,price,quality,source]of [['low',1000,null,'not_provided'],['higher',2000,null,'not_provided'],['declared',3000,99,'farmer']])await client.execute({sql:"INSERT INTO crops(id,owner_id,name,kind,category,qty,price,place,created,quality,quality_source) VALUES(?,'seller','Tomato','tomato','vegetables',10,?,'Guntur',1,?,?)",args:[id,price,quality,source]});
  await estimateLegacyQuality(db);
  const low=await db.prepare("SELECT * FROM crops WHERE id='low'").first(),higher=await db.prepare("SELECT * FROM crops WHERE id='higher'").first();
  assert.ok(low.quality<higher.quality);assert.equal(low.quality_source,'price_estimate');assert.equal(low.cultivated_date,null);assert.equal(low.harvested_date,null);
  assert.equal((await db.prepare("SELECT quality FROM crops WHERE id='declared'").first()).quality,99);
  await client.execute("UPDATE crops SET price=9999 WHERE id='low'");await estimateLegacyQuality(db);
  assert.equal((await db.prepare("SELECT quality FROM crops WHERE id='low'").first()).quality,low.quality);
 }finally{client.close()}
});
test('requested listing removal is exact, idempotent and preserves accepted trade history',async()=>{
 const client=createClient({url:':memory:'});
 try{
  await migrate(client);
  await client.execute('DELETE FROM mitti_migrations WHERE version=3');
  await client.execute("INSERT INTO users(id,name,email,role,created) VALUES('owner','Local fixture','fixture@gmail.com','farmer',1)");
  const id='657af0ce-bfa3-4789-9081-cc201571aa7c';
  for(const cropId of [id,'other-crop'])await client.execute({sql:"INSERT INTO crops(id,owner_id,name,kind,category,qty,price,place,created) VALUES(?,'owner','tomato','other','vegetables',6578,76800,'manglagiri',1)",args:[cropId]});
  for(const [offerId,cropId,status]of [['pending',id,'pending'],['accepted',id,'accepted'],['other-offer','other-crop','pending']])await client.execute({sql:"INSERT INTO offers(id,crop_id,buyer_id,qty,price,transport,handling,status,created) VALUES(?,?,'owner',1,76800,0,0,?,1)",args:[offerId,cropId,status]});
  await migrate(client);await migrate(client);
  const crops=await client.execute('SELECT id,archived,revision,qty FROM crops ORDER BY id');
  assert.deepEqual(crops.rows.map(r=>[r.id,r.archived,r.revision,r.qty]),[[id,1,2,6578],['other-crop',0,1,6578]]);
  const offers=await client.execute('SELECT id,status FROM offers ORDER BY id');
  assert.deepEqual(offers.rows.map(r=>[r.id,r.status]),[['accepted','accepted'],['other-offer','pending'],['pending','declined']]);
 }finally{client.close()}
});
test('Gmail/SRM domains and Indian contact normalization',()=>{
 for(const email of ['name@gmail.com','name@srmap.edu.in','student_123@SRMAP.EDU.IN'])assert.equal(validEmail(email),true,email);
 for(const email of ['name@gmail.com.attacker.com','name@srmap.edu.in.evil','@gmail.com','name@example.com','a@@gmail.com'])assert.equal(validEmail(email),false,email);
 assert.equal(normalizePhone('+91 98765 43210'),'9876543210');
 for(const phone of ['123','1234567890','9876543210123',null])assert.equal(normalizePhone(phone),null);
});
test('database settings distinguish missing values and trim pasted whitespace',()=>{
 for(const [env,code] of [[{VERCEL:'1'},'DB_URL_MISSING'],[{VERCEL:'1',TURSO_DATABASE_URL:'libsql://test.turso.io'},'DB_TOKEN_MISSING'],[{VERCEL:'1',TURSO_DATABASE_URL:'eyJ-not-a-url',TURSO_AUTH_TOKEN:'test'},'DB_URL_INVALID']]){
  assert.throws(()=>databaseConfig(env),e=>databaseFailure(e).code===code);
 }
 assert.deepEqual(databaseConfig({VERCEL:'1',TURSO_DATABASE_URL:' libsql://test.turso.io\n',TURSO_AUTH_TOKEN:' secret-test-token\n'}),{url:'libsql://test.turso.io',authToken:'secret-test-token'});
});
test('database failures never expose credentials or raw provider errors',()=>{
 const errors=[{code:'SERVER_ERROR',message:'Server returned HTTP status 401 secret-test-token'},{code:'SQLITE_READONLY',message:'secret-test-token'},{code:'ENOENT',message:'secret-test-token'},{code:'ENOTFOUND',message:'secret-test-token'},{message:'unrecognised secret-test-token'}];
 assert.deepEqual(errors.map(e=>databaseFailure(e).code),['DB_AUTH_FAILED','DB_WRITE_DENIED','DB_SCHEMA_MISSING','DB_UNREACHABLE','DB_SETUP_FAILED']);
 for(const error of errors)assert.ok(!JSON.stringify(databaseFailure(error)).includes('secret-test-token'));
});
test('Turso adapter preserves migration idempotency, blobs and atomic stock acceptance',async()=>{
 const client=createClient({url:':memory:'});
 try{
  await migrate(client);await migrate(client);
  assert.ok((await client.execute('PRAGMA table_info(users)')).rows.some(r=>r.name==='phone'));
  const db=databaseAdapter(client);
  await db.prepare('INSERT INTO users(id,name,email,role,created) VALUES(?,?,?,?,?)').bind('farmer','Farmer','test@gmail.com','farmer',1).run();
  const blob=new Uint8Array([137,80,78,71]).buffer;
  await db.prepare('INSERT INTO media VALUES(?,?,?,?)').bind('photo','farmer','image/png',blob).run();
  assert.deepEqual(new Uint8Array((await db.prepare('SELECT bytes FROM media').first()).bytes),new Uint8Array(blob));
  await client.execute("INSERT INTO crops(id,owner_id,name,kind,category,qty,price,place,created) VALUES('crop','farmer','Tomatoes','tomato','vegetables',100,2500,'Guntur',1)");
  await client.execute("INSERT INTO offers(id,crop_id,buyer_id,qty,price,transport,handling,created) VALUES('offer','crop','farmer',60,2500,0,0,1)");
  const result=await db.batch([db.prepare("UPDATE crops SET qty=qty-60 WHERE id='crop' AND qty>=60"),db.prepare("UPDATE offers SET status='accepted' WHERE id='offer' AND changes()=1")]);
  assert.equal(result[0].meta.changes,1);assert.equal((await db.prepare("SELECT qty FROM crops WHERE id='crop'").first()).qty,40);assert.equal((await db.prepare("SELECT status FROM offers WHERE id='offer'").first()).status,'accepted');
  await assert.rejects(db.batch([db.prepare("UPDATE crops SET qty=0 WHERE id='crop'"),db.prepare('INSERT INTO table_that_does_not_exist VALUES(1)')]));
  assert.equal((await db.prepare("SELECT qty FROM crops WHERE id='crop'").first()).qty,40);
 }finally{client.close()}
});
