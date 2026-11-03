import {getDatabase} from './database.mjs';
import {handleRequest} from './cloud-backend.mjs';
export async function dispatch(request){
 // Next may expose its internal hostname in request.url. Match browser Origin
 // against the actual Host routed to this deployment, preserving CSRF checks.
 const publicURL=new URL(request.url);
 publicURL.host=request.headers.get('host')||publicURL.host;
 if(process.env.VERCEL)publicURL.protocol='https:';
 request=new Request(publicURL,request);
 let DB;
 try{DB=await getDatabase()}catch{return Response.json({error:'The database is not connected yet. The site owner needs to configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel, then redeploy.'},{status:503,headers:{'Cache-Control':'no-store'}})}
 return handleRequest(request,{DB,PLANT_ID_API_KEY:process.env.PLANT_ID_API_KEY});
}
