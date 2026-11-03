const messages={
 DB_URL_MISSING:'The database address is missing. Add TURSO_DATABASE_URL for Production in Vercel, then redeploy.',
 DB_TOKEN_MISSING:'The database access token is missing. Add TURSO_AUTH_TOKEN for Production in Vercel, then redeploy.',
 DB_URL_INVALID:'The database address is invalid. TURSO_DATABASE_URL must contain only the full libsql:// address from Turso, then redeploy.',
 DB_AUTH_FAILED:'Turso rejected the database credentials. Check that the URL and token belong to the same database, update them in Vercel, then redeploy.',
 DB_WRITE_DENIED:'The database token does not allow setup or writes. Use a read-and-write database token in Vercel, then redeploy.',
 DB_SCHEMA_MISSING:'The database setup file is missing from this deployment. The site owner needs to redeploy the latest code.',
 DB_UNREACHABLE:'The database could not be reached. Try again shortly. The site owner should check the Turso database status and address.',
 DB_SETUP_FAILED:'The database setup could not finish. The site owner should check the Vercel runtime logs. Reference: DB_SETUP_FAILED.'
};
function setupError(code){return Object.assign(new Error(messages[code]),{setupCode:code})}
export function databaseConfig(env){
 const url=env.TURSO_DATABASE_URL?.trim(),authToken=env.TURSO_AUTH_TOKEN?.trim();
 if(!url)throw setupError('DB_URL_MISSING');
 let parsed;try{parsed=new URL(url)}catch{throw setupError('DB_URL_INVALID')}
 if(env.VERCEL&&(parsed.protocol!=='libsql:'||!parsed.hostname||parsed.username||parsed.password||parsed.hash))throw setupError('DB_URL_INVALID');
 if(env.VERCEL&&!authToken)throw setupError('DB_TOKEN_MISSING');
 return {url,authToken:authToken||undefined};
}
export function databaseFailure(error){
 const causes=[];for(let e=error;e&&causes.length<5;e=e.cause)causes.push(e);
 let code=causes.map(e=>e.setupCode).find(c=>Object.hasOwn(messages,c));
 const native=causes.map(e=>String(e.code||'')).join(' ');
 // Inspect error types for classification only; never return raw errors or URLs.
 const detail=causes.map(e=>String(e.message||'')).join(' ');
 if(!code){
  if(/SQLITE_READONLY|SQLITE_PERM|SQLITE_AUTH/.test(native))code='DB_WRITE_DENIED';
  else if(/AUTH|UNAUTHORIZED|FORBIDDEN/.test(native)||/\b40[13]\b|unauthori[sz]ed|invalid.{0,20}token|expired.{0,20}token/i.test(detail))code='DB_AUTH_FAILED';
  else if(/ENOENT/.test(native))code='DB_SCHEMA_MISSING';
  else if(/URL_INVALID|URL_SCHEME/.test(native))code='DB_URL_INVALID';
  else if(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET/.test(native)||/fetch failed|network|timed out/i.test(detail))code='DB_UNREACHABLE';
  else code='DB_SETUP_FAILED';
 }
 return {code,error:messages[code]};
}
