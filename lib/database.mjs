import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {databaseConfig} from './database-errors.mjs';

const plain=result=>({results:result.rows.map(row=>Object.fromEntries(result.columns.map(key=>[key,row[key]]))),meta:{changes:result.rowsAffected}});
export function databaseAdapter(client){
 class Statement{
  constructor(sql,args=[]){this.sql=sql;this.args=args}
  bind(...args){return new Statement(this.sql,args)}
  async first(){return plain(await client.execute({sql:this.sql,args:this.args})).results[0]||null}
  async all(){return plain(await client.execute({sql:this.sql,args:this.args}))}
  async run(){return plain(await client.execute({sql:this.sql,args:this.args}))}
 }
 return {prepare:sql=>new Statement(sql),batch:async statements=>(await client.batch(statements.map(s=>({sql:s.sql,args:s.args})),'write')).map(plain)};
}
export async function migrate(client){
 await client.execute('CREATE TABLE IF NOT EXISTS mitti_migrations (version INTEGER PRIMARY KEY, applied INTEGER NOT NULL)');
 const result=await client.execute('SELECT version FROM mitti_migrations');
 const versions=new Set(result.rows.map(r=>Number(r.version)));
 if(!versions.has(1)){
 const source=await readFile(path.join(process.cwd(),'migrations','001-initial.sql'),'utf8');
 const statements=source.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>s.replace(/^CREATE TABLE /,'CREATE TABLE IF NOT EXISTS ').replace(/^CREATE UNIQUE INDEX /,'CREATE UNIQUE INDEX IF NOT EXISTS ').replace(/^CREATE INDEX /,'CREATE INDEX IF NOT EXISTS '));
 await client.batch([...statements,{sql:'INSERT OR IGNORE INTO mitti_migrations VALUES(1,?)',args:[Date.now()]}],'write');
 }
 if(!versions.has(2)){
  const columns=await client.execute('PRAGMA table_info(users)');
  const changes=columns.rows.some(r=>r.name==='phone')?[]:["ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''"];
  await client.batch([...changes,{sql:'INSERT OR IGNORE INTO mitti_migrations VALUES(2,?)',args:[Date.now()]}],'write');
 }
}
let ready;
export function getDatabase({initialize=!process.env.VERCEL}={}){
 if(!ready)ready=(async()=>{
  const config=databaseConfig(process.env);
  const {createClient}=process.env.VERCEL?await import('@libsql/client/web'):await import('@libsql/client');
  const client=createClient(config);
  try{if(initialize)await migrate(client);return databaseAdapter(client)}catch(error){client.close();throw error}
 })().catch(error=>{ready=undefined;throw error});
 return ready;
}
