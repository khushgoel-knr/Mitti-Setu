import {getDatabase} from './database.mjs';
import {handleRequest} from './cloud-backend.mjs';
import {databaseFailure} from './database-errors.mjs';
export async function dispatch(request){
 // Next may expose its internal hostname in request.url. Match browser Origin
 // against the actual Host routed to this deployment, preserving CSRF checks.
 const publicURL=new URL(request.url);
 publicURL.host=request.headers.get('host')||publicURL.host;
 if(process.env.VERCEL)publicURL.protocol='https:';
 request=new Request(publicURL,request);
 let DB;
 try{DB=await getDatabase()}catch(error){const failure=databaseFailure(error);console.error('Mitti Setu database setup:',failure.code);return Response.json(failure,{status:503,headers:{'Cache-Control':'no-store'}})}
 return handleRequest(request,{DB,DATABASE_PREPARED:!!process.env.VERCEL,PLANT_ID_API_KEY:process.env.PLANT_ID_API_KEY,GEMINI_API_KEY:process.env.GEMINI_API_KEY,GEMINI_MODEL:process.env.GEMINI_MODEL});
}
