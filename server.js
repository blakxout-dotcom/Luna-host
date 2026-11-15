// Luna host: serves the app and a lightweight rewriting proxy. Zero dependencies (Node 18.14+).
const http=require('http'),fs=require('fs'),path=require('path'),dns=require('dns').promises,net=require('net'),crypto=require('crypto'),{Readable}=require('stream');
const PORT=process.env.PORT||3000,PASS=process.env.PASS||'',OPEN=process.env.ALLOW_PRIVATE==='1';
const AD=['doubleclick.net','googlesyndication.com','googleadservices.com','adservice.google.com','taboola.com','outbrain.com','adnxs.com','criteo.com'];
const DROP=new Set(['x-frame-options','content-security-policy','content-security-policy-report-only','content-encoding','content-length','transfer-encoding','set-cookie','strict-transport-security','connection','keep-alive','location','cross-origin-opener-policy','cross-origin-embedder-policy','cross-origin-resource-policy','report-to','nel','permissions-policy']);
const jar={};
const priv=ip=>net.isIPv4(ip)?/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip):/^(::1?$|f[cd]|fe80|::ffff:)/i.test(ip);
const px=(u,b)=>{if(!u||u[0]=='#')return u;try{const a=new URL(u,b);return /^https?:$/.test(a.protocol)?'/p?u='+encodeURIComponent(a.href):u}catch{return u}};
const css=(t,b)=>t.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi,(m,q,v)=>/^(data:|#)/i.test(v)?m:'url('+q+px(v,b)+q+')');
const CLIENT=`(function(){var B=window.__B,O='/p?u=';function P(u){try{u=String(u);if(u.indexOf(O)==0||u.charAt(0)=='#'||/^(data|blob|javascript|mailto|tel):/.test(u))return u;var a=new URL(u,B);return /^https?:$/.test(a.protocol)?O+encodeURIComponent(a.href):u}catch(e){return u}}
var f=window.fetch;window.fetch=function(i,n){try{if(typeof i=='string'||i instanceof URL)i=P(i);else if(i&&i.url)i=new Request(P(i.url),i)}catch(e){}return f.call(this,i,n)};
var x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=P(u);return x.apply(this,arguments)};
var wo=window.open;window.open=function(u){return wo.call(window,u?P(u):u)};
['pushState','replaceState'].forEach(function(k){var h=history[k];history[k]=function(s,t,u){try{return h.call(this,s,t,u?P(u):u)}catch(e){}}});
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented)return;var h=a.getAttribute('href');if(!h||h.charAt(0)=='#'||/^(javascript|mailto|tel):/.test(h)||h.indexOf(O)==0)return;e.preventDefault();if(a.target=='_blank')window.open(h);else location.href=P(h)},true);
document.addEventListener('submit',function(e){var fm=e.target;if(e.defaultPrevented)return;var a=new URL(fm.getAttribute('action')||'',B);if((fm.method||'get').toLowerCase()=='get'){e.preventDefault();new FormData(fm).forEach(function(v,k){if(typeof v=='string')a.searchParams.set(k,v)});location.href=P(a.href)}else fm.action=P(a.href)},true)})();`;
function html(t,b){
 t=t.replace(/<base\b[^>]*>/gi,'').replace(/\sintegrity\s*=\s*(["']).*?\1/gi,'')
  .replace(/(\s(?:href|src|action|poster|data-src)\s*=\s*)(["'])(.*?)\2/gi,(m,a,q,v)=>a+q+px(v.replace(/&amp;/g,'&'),b)+q)
  .replace(/(\ssrcset\s*=\s*)(["'])(.*?)\2/gi,(m,a,q,v)=>a+q+v.split(',').map(x=>{const[u,...r]=x.trim().split(/\s+/);return[px(u,b),...r].join(' ')}).join(', ')+q);
 const inj='<script>window.__B='+JSON.stringify(b)+';'+CLIENT+'</script>';
 return /<head[^>]*>/i.test(t)?t.replace(/<head[^>]*>/i,m=>m+inj):inj+t}
http.createServer(async(q,res)=>{
 const send=(c,t,h={})=>{res.writeHead(c,{'content-type':'text/html;charset=utf-8',...h});res.end(t)};
 try{
  const U=new URL(q.url,'http://x'),ck={};(q.headers.cookie||'').split(/;\s*/).forEach(c=>{const i=c.indexOf('=');if(i>0)ck[c.slice(0,i)]=c.slice(i+1)});
  if(U.pathname=='/health')return send(200,'luna',{'content-type':'text/plain'});
  if(PASS&&ck.lpass!==encodeURIComponent(PASS)){
   if(U.pathname=='/login'&&U.searchParams.get('k')===PASS)return send(302,'',{location:'/','set-cookie':'lpass='+encodeURIComponent(PASS)+'; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000'});
   return send(401,'<body style="font:16px system-ui;background:#11111b;color:#eee;display:grid;place-items:center;height:100vh"><form action="/login"><input name="k" type="password" placeholder="Password" autofocus style="padding:12px;border-radius:10px"> <button style="padding:12px">Enter</button></form>')}
  if(U.pathname=='/')return send(200,fs.readFileSync(path.join(__dirname,'public/index.html'),'utf8').replace('<head>','<head><script>window.LUNA_PX=1</script>'));
  if(U.pathname!='/p')return send(404,'Not found');
  let T;try{T=new URL(U.searchParams.get('u'));if(!/^https?:$/.test(T.protocol))throw 0}catch{return send(400,'Bad URL')}
  if(AD.some(d=>T.hostname==d||T.hostname.endsWith('.'+d)))return send(204,'');
  if(!OPEN){const a=await dns.lookup(T.hostname,{all:true});if(a.some(x=>priv(x.address)))return send(403,'Blocked address')}
  const sid=ck.lsid||crypto.randomBytes(8).toString('hex'),J=(jar[sid]=jar[sid]||{}),H=T.hostname;
  const body=['GET','HEAD'].includes(q.method)?undefined:await new Promise(r=>{const c=[];q.on('data',d=>c.push(d));q.on('end',()=>r(Buffer.concat(c)))});
  const h={'user-agent':q.headers['user-agent']||'Mozilla/5.0','accept':q.headers.accept||'*/*','accept-language':q.headers['accept-language']||'en-US,en;q=0.9',referer:T.href};
  if(q.headers['content-type'])h['content-type']=q.headers['content-type'];if(q.headers.range)h.range=q.headers.range;if(body)h.origin=T.origin;
  const ckh=Object.entries(J[H]||{}).map(([k,v])=>k+'='+v).join('; ');if(ckh)h.cookie=ckh;
  const r=await fetch(T,{method:q.method,headers:h,body,redirect:'manual',signal:AbortSignal.timeout(25000)});
  (r.headers.getSetCookie?r.headers.getSetCookie():[]).forEach(c=>{const kv=c.split(';')[0],i=kv.indexOf('=');if(i>0)(J[H]=J[H]||{})[kv.slice(0,i).trim()]=kv.slice(i+1)});
  const o={'set-cookie':'lsid='+sid+'; Path=/; HttpOnly; SameSite=Lax'};r.headers.forEach((v,k)=>{if(!DROP.has(k))o[k]=v});
  const loc=r.headers.get('location');if(r.status>=300&&r.status<400&&loc){o.location=px(loc,T.href);res.writeHead(r.status,o);return res.end()}
  const ct=r.headers.get('content-type')||'';
  if(/text\/html/i.test(ct)){o['content-type']='text/html;charset=utf-8';res.writeHead(r.status,o);return res.end(css(html(await r.text(),T.href),T.href))}
  if(/text\/css/i.test(ct)){res.writeHead(r.status,o);return res.end(css(await r.text(),T.href))}
  res.writeHead(r.status,o);r.body?Readable.fromWeb(r.body).pipe(res):res.end();
 }catch(e){if(res.headersSent)res.end();else send(502,'<body style="font:16px system-ui;padding:40px">Could not load this page: '+String(e.message).replace(/</g,'&lt;'))}
}).listen(PORT,()=>console.log('Luna on :'+PORT));
