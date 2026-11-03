import {SITE_HTML} from '../lib/site-html.js';
export const dynamic='force-dynamic';
export function GET(){return new Response(SITE_HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}
