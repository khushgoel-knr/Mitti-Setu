import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {databaseAdapter,migrate} from '../lib/database.mjs';
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
