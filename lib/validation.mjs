export function validEmail(value){
 if(typeof value!=='string'||value.length>254)return false;
 const parts=value.trim().toLowerCase().split('@');
 return parts.length===2&&parts[1]==='gmail.com'&&parts[0].length<=64&&/^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(parts[0]);
}
