const config={apiKey:'test-api-key',databaseURL:'https://swim-manager-test-default-rtdb.firebaseio.com'};
const clone=value=>JSON.parse(JSON.stringify(value));
function storage(){
  const values=new Map();
  return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};
}
function backend(){
  const saves=new Map(),versions=new Map(),calls=[];
  const server={saves,versions,calls,beforePut:null,beforeGet:null,refreshes:0};
  const uid=email=>Buffer.from(email).toString('base64url');
  const response=(value,status=200,etag)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...(etag?{ETag:etag}:{})}});
  server.set=(id,value)=>{saves.set(id,clone(value));versions.set(id,(versions.get(id)||0)+1)};
  server.fetch=async(url,options={})=>{
    const u=new URL(url),method=options.method||'GET';calls.push({path:u.pathname,method});
    if(u.hostname==='identitytoolkit.googleapis.com'){
      const data=JSON.parse(options.body);
      if(data.password==='wrong-password')return response({error:{message:'INVALID_LOGIN_CREDENTIALS'}},400);
      const id=uid(data.email);
      return response({localId:id,email:data.email,idToken:'id:'+id,refreshToken:'refresh:'+id,expiresIn:'3600'});
    }
    if(u.hostname==='securetoken.googleapis.com'){
      server.refreshes++;
      const id=new URLSearchParams(options.body).get('refresh_token').slice('refresh:'.length);
      return response({id_token:'id:'+id,refresh_token:'refresh:'+id,expires_in:'3600'});
    }
    const match=u.pathname.match(/^\/swimManagerSaves\/([^/]+)(\/revision)?\.json$/);
    if(u.origin!==config.databaseURL||!match||u.searchParams.get('auth')!=='id:'+match[1])return response({error:'Permission denied'},401);
    const id=match[1],etag=()=>JSON.stringify('etag-'+(versions.get(id)||0));
    if(method==='GET'){
      if(server.beforeGet)await server.beforeGet(id,Boolean(match[2]));
      return response(match[2]?saves.get(id)?.revision||null:saves.get(id)||null,200,etag());
    }
    if(method==='PUT'){
      if(server.beforePut)await server.beforePut(id);
      if(new Headers(options.headers).get('If-Match')!==etag())return response(saves.get(id)||null,412,etag());
      const data=JSON.parse(options.body);data.updatedAt=Date.now();server.set(id,data);
      return response(data,200,etag());
    }
    return response({error:'Unsupported'},400);
  };
  return server;
}
module.exports={config,storage,backend,clone};
