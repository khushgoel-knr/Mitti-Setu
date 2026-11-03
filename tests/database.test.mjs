import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {databaseAdapter,migrate} from '../lib/database.mjs';
import {databaseConfig,databaseFailure} from '../lib/database-errors.mjs';
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
