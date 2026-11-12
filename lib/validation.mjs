export function validEmail(value){
 if(typeof value!=='string'||value.length>254)return false;
 const parts=value.trim().toLowerCase().split('@');
 return parts.length===2&&['gmail.com','srmap.edu.in'].includes(parts[1])&&parts[0].length<=64&&/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(parts[0]);
}
export function normalizePhone(value){
 if(typeof value!=='string')return null;
 const phone=value.trim().replace(/[ ()-]/g,'').replace(/^(?:\+91|0091)/,'');
 return /^[6-9][0-9]{9}$/.test(phone)?phone:null;
}
