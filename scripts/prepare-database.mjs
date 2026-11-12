import {getDatabase} from '../lib/database.mjs';
import {seed} from '../lib/cloud-backend.mjs';
if(process.env.VERCEL){
 const db=await getDatabase({initialize:true});
 await seed(db);
 console.log('Database prepared for deployment.');
}
