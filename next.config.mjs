export default {
  poweredByHeader:false,
  serverExternalPackages:['@libsql/client'],
  outputFileTracingIncludes:{'/*':['./migrations/*.sql']},
  async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'same-origin'}]},{source:'/app.js',headers:[{key:'Cache-Control',value:'no-cache'}]}]}
};
