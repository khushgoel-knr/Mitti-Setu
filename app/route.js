import {SITE_HTML} from '../lib/site-html.js';
export const dynamic='force-static';
export function GET(){return new Response(SITE_HTML,{headers:{'Content-Type':'text/html; charset=utf-8'}})}
