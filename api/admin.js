import {createHash,timingSafeEqual} from 'node:crypto';

const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const send=(res,n,d)=>res.status(n).json(d);

async function redis(cmd){
  const u=process.env.UPSTASH_REDIS_REST_URL,t=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!u||!t)throw Error('Brak konfiguracji Upstash');
  const r=await fetch(u,{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify(cmd)});
  const j=await r.json();
  if(!r.ok||j.error)throw Error('Błąd Redis');
  return j.result;
}

const inviteKey=code=>'edukot:invite:'+hash(String(code).trim().toUpperCase());
const reqKey=id=>'edukot:request:'+hash(id);
const INVITES_SET='edukot:invites';
const REQUESTS_SET='edukot:requests';

const clientIp=req=>String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'?').split(',')[0].trim();

async function hits(name,ip){return Number(await redis(['GET','edukot:rl:'+name+':'+hash(ip)]))||0}
async function addHit(name,ip,ttl){const k='edukot:rl:'+name+':'+hash(ip);const n=await redis(['INCR',k]);if(n===1)await redis(['EXPIRE',k,ttl])}

function safeEqual(a,b){
  const ha=Buffer.from(hash(a));
  const hb=Buffer.from(hash(b));
  if(ha.length!==hb.length)return false;
  return timingSafeEqual(ha,hb);
}

async function adminAuth(req,res){
  const wantLogin=process.env.EDUKOT_ADMIN_LOGIN;
  const wantPass=process.env.EDUKOT_ADMIN_PASSWORD;
  if(!wantLogin||!wantPass){
    send(res,503,{error:'Brak zmiennych EDUKOT_ADMIN_LOGIN i EDUKOT_ADMIN_PASSWORD w Vercel (Settings → Environment Variables).'});
    return false;
  }
  const ip=clientIp(req);
  if(await hits('admin',ip)>=8){send(res,429,{error:'Zbyt wiele błędnych prób. Spróbuj za 15 minut.'});return false}
  const gotLogin=String(req.headers['x-admin-login']||'');
  const gotPass=String(req.headers['x-admin-password']||'');
  if(!safeEqual(gotLogin,wantLogin)||!safeEqual(gotPass,wantPass)){
    await addHit('admin',ip,900);
    send(res,401,{error:'Nieprawidłowy login lub hasło'});
    return false;
  }
  return true;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-admin-login,x-admin-password');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if(req.method==='OPTIONS')return res.status(204).end();

  try{
    let body=req.body||{};
    if(typeof body==='string'){try{body=JSON.parse(body)}catch{body={}}}
    const action=body.action||req.query?.action||'';

    if(req.method==='POST'&&action==='verify'){
      if(!await adminAuth(req,res))return;
      return send(res,200,{ok:true,hasTeacherPin:!!process.env.EDUKOT_TEACHER_PIN,hasRedis:!!(process.env.UPSTASH_REDIS_REST_URL&&process.env.UPSTASH_REDIS_REST_TOKEN)});
    }

    if(!await adminAuth(req,res))return;

    // Podsumowanie
    if(req.method==='GET'&&action==='summary'){
      const invMembers=await redis(['SMEMBERS',INVITES_SET])||[];
      const reqMembers=await redis(['SMEMBERS',REQUESTS_SET])||[];
      let activeInvites=0,instant=0,pending=0;
      for(const m of invMembers){
        const code=m.includes(':')?m.split(':').slice(1).join(':'):m;
        const raw=await redis(['GET',inviteKey(code)]);
        if(!raw){await redis(['SREM',INVITES_SET,m]);continue}
        const inv=JSON.parse(raw);
        if(inv.active)activeInvites++;
        if(inv.autoApprove)instant++;
      }
      for(const m of reqMembers){
        const id=m.split(':')[1];
        const raw=id&&await redis(['GET',reqKey(id)]);
        if(!raw){await redis(['SREM',REQUESTS_SET,m]);continue}
        const q=JSON.parse(raw);
        if(q.status==='pending')pending++;
        else await redis(['SREM',REQUESTS_SET,m]);
      }
      return send(res,200,{
        invitesTotal:invMembers.length,
        invitesActive:activeInvites,
        invitesInstant:instant,
        requestsPending:pending,
        hasTeacherPin:!!process.env.EDUKOT_TEACHER_PIN,
        hasRedis:true
      });
    }

    // Lista kodów zaproszeń
    if(req.method==='GET'&&action==='invites'){
      const members=await redis(['SMEMBERS',INVITES_SET])||[];
      const list=[];
      for(const m of members){
        const code=m.includes(':')?m.split(':').slice(1).join(':'):m;
        const raw=await redis(['GET',inviteKey(code)]);
        if(!raw){await redis(['SREM',INVITES_SET,m]);continue}
        const inv=JSON.parse(raw);
        list.push({
          code:inv.code||code,
          childId:inv.childId||'',
          childName:inv.childName||'',
          active:!!inv.active,
          autoApprove:!!inv.autoApprove,
          createdAt:inv.createdAt||0
        });
      }
      list.sort((a,b)=>b.createdAt-a.createdAt);
      return send(res,200,{invites:list});
    }

    // Lista oczekujących próśb
    if(req.method==='GET'&&action==='requests'){
      const members=await redis(['SMEMBERS',REQUESTS_SET])||[];
      const list=[];
      for(const m of members){
        const id=m.split(':')[1];
        const raw=id&&await redis(['GET',reqKey(id)]);
        if(!raw){await redis(['SREM',REQUESTS_SET,m]);continue}
        const q=JSON.parse(raw);
        if(q.status!=='pending'){await redis(['SREM',REQUESTS_SET,m]);continue}
        list.push({
          id:q.id,
          inviteCode:q.inviteCode,
          parentName:q.parentName,
          contact:q.contact||'',
          childName:q.childName||'',
          createdAt:q.createdAt||0
        });
      }
      list.sort((a,b)=>a.createdAt-b.createdAt);
      return send(res,200,{requests:list});
    }

    // Znajdź jeden kod (szczegóły)
    if(req.method==='POST'&&action==='find-invite'){
      const code=String(body.code||'').trim().toUpperCase();
      if(code.length<3)return send(res,400,{error:'Podaj kod (min. 3 znaki)'});
      const raw=await redis(['GET',inviteKey(code)]);
      if(!raw)return send(res,404,{error:'Nie znaleziono kodu: '+code});
      const inv=JSON.parse(raw);
      return send(res,200,{
        invite:{
          code:inv.code||code,
          childId:inv.childId||'',
          childName:inv.childName||'',
          active:!!inv.active,
          autoApprove:!!inv.autoApprove,
          createdAt:inv.createdAt||0
        }
      });
    }

    // Włącz / wyłącz kod
    if(req.method==='POST'&&action==='toggle-invite'){
      const code=String(body.code||'').trim().toUpperCase();
      if(code.length<4)return send(res,400,{error:'Podaj kod'});
      const raw=await redis(['GET',inviteKey(code)]);
      if(!raw)return send(res,404,{error:'Nie znaleziono kodu'});
      const inv=JSON.parse(raw);
      if(body.active===false||body.active==='false'||body.active===0||body.active==='0')inv.active=false;
      else if(body.active===true||body.active==='true'||body.active===1||body.active==='1')inv.active=true;
      else inv.active=!inv.active;
      await redis(['SET',inviteKey(code),JSON.stringify(inv),'EX',180*86400]);
      return send(res,200,{ok:true,code,active:inv.active});
    }

    // Usuń kod z listy (i dezaktywuj)
    if(req.method==='POST'&&action==='delete-invite'){
      const code=String(body.code||'').trim().toUpperCase();
      if(code.length<4)return send(res,400,{error:'Podaj kod'});
      const raw=await redis(['GET',inviteKey(code)]);
      if(raw){
        const inv=JSON.parse(raw);
        inv.active=false;
        await redis(['SET',inviteKey(code),JSON.stringify(inv),'EX',86400]);
      }
      await redis(['SREM',INVITES_SET,hash(code)+':'+code]);
      return send(res,200,{ok:true});
    }

    // Usuń kod całkowicie (klucz + lista)
    if(req.method==='POST'&&action==='purge-invite'){
      const code=String(body.code||'').trim().toUpperCase();
      if(code.length<3)return send(res,400,{error:'Podaj kod'});
      await redis(['DEL',inviteKey(code)]);
      await redis(['SREM',INVITES_SET,hash(code)+':'+code]);
      return send(res,200,{ok:true,code});
    }

    // Wyłącz wszystkie kody
    if(req.method==='POST'&&action==='deactivate-all-invites'){
      const members=await redis(['SMEMBERS',INVITES_SET])||[];
      let n=0;
      for(const m of members){
        const code=m.includes(':')?m.split(':').slice(1).join(':'):m;
        const raw=await redis(['GET',inviteKey(code)]);
        if(!raw){await redis(['SREM',INVITES_SET,m]);continue}
        const inv=JSON.parse(raw);
        if(inv.active){
          inv.active=false;
          await redis(['SET',inviteKey(code),JSON.stringify(inv),'EX',180*86400]);
          n++;
        }
      }
      return send(res,200,{ok:true,deactivated:n});
    }

    // Usuń wszystkie kody z listy (i wyłącz)
    if(req.method==='POST'&&action==='delete-all-invites'){
      const members=await redis(['SMEMBERS',INVITES_SET])||[];
      let n=0;
      for(const m of members){
        const code=m.includes(':')?m.split(':').slice(1).join(':'):m;
        const raw=await redis(['GET',inviteKey(code)]);
        if(raw){
          const inv=JSON.parse(raw);
          inv.active=false;
          await redis(['SET',inviteKey(code),JSON.stringify(inv),'EX',86400]);
        }
        await redis(['SREM',INVITES_SET,m]);
        n++;
      }
      return send(res,200,{ok:true,removed:n});
    }

    // Odrzuć jedną prośbę
    if(req.method==='POST'&&action==='reject-request'){
      const id=String(body.requestId||'');
      const raw=await redis(['GET',reqKey(id)]);
      if(!raw)return send(res,404,{error:'Nie znaleziono prośby'});
      const q=JSON.parse(raw);
      q.status='rejected';
      await redis(['SET',reqKey(id),JSON.stringify(q),'EX',7*86400]);
      await redis(['SREM',REQUESTS_SET,hash(id)+':'+id]);
      return send(res,200,{ok:true});
    }

    // Usuń wszystkie oczekujące prośby
    if(req.method==='POST'&&action==='clear-all-requests'){
      const members=await redis(['SMEMBERS',REQUESTS_SET])||[];
      let n=0;
      for(const m of members){
        const id=m.split(':')[1];
        if(!id){await redis(['SREM',REQUESTS_SET,m]);continue}
        const raw=await redis(['GET',reqKey(id)]);
        if(raw){
          const q=JSON.parse(raw);
          q.status='rejected';
          await redis(['SET',reqKey(id),JSON.stringify(q),'EX',7*86400]);
        }
        await redis(['SREM',REQUESTS_SET,m]);
        n++;
      }
      return send(res,200,{ok:true,cleared:n});
    }

    return send(res,405,{error:'Niedozwolona metoda lub akcja'});
  }catch(e){
    return send(res,500,{error:e.message||'Błąd serwera'});
  }
}
