import {query,transaction} from '@/lib/db';
import {currentActor,audit,encodePassword,random,json,sameOrigin,serverFailure} from '@/lib/security';
import {limitedJson} from '@/lib/uploads';
import {totpStep} from '@/lib/totp';
import {sealSecret} from '@/lib/secrets';
import {LIMITS,requestLimit,throttled} from '@/lib/abuse';
import {operationsStatus} from '@/lib/evidence';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 try{
  const actor=await currentActor();if(actor?.role!=='superadmin')return json({error:'শুধু সুপার অ্যাডমিনের অনুমতি আছে।'},403);
  const page=Math.max(0,Math.min(100000,Number(new URL(req.url).searchParams.get('page'))||0));
  const [staff,logs,operations]=await Promise.all([
   query('SELECT id,username,active,created_at FROM jamatnama.staff ORDER BY created_at DESC'),
   query('SELECT * FROM jamatnama.audit_log ORDER BY id DESC LIMIT 50 OFFSET $1',[Math.floor(page)*50]),
   operationsStatus(),
  ]);
  return json({staff:staff.rows,logs:logs.rows,operations});
 }catch(error){return serverFailure('admin.team.read',error);}
}
export async function POST(req:Request){
 try{
  const actor=await currentActor();if(!sameOrigin(req)||actor?.role!=='superadmin')return json({error:'অনুমতি নেই।'},403);
  if(!await requestLimit('team-management',LIMITS.team))return throttled(LIMITS.team.seconds);
  const b=await limitedJson(req).catch(()=>null);
  if(!b)return json({error:'অনুরোধ সঠিক নয়।'},400);
  if(b.action==='create'){
   const username=typeof b.username==='string'?b.username.trim().toLowerCase():'';
   if(!/^[a-z0-9_-]{3,40}$/.test(username)||username==='superadmin'||typeof b.password!=='string'||b.password.length<14||b.password.length>128)
    return json({error:'Username এবং কমপক্ষে ১৪ অক্ষরের password সঠিকভাবে দিন।'},400);
   const secret = typeof b.secret === "string" ? b.secret.replace(/[\s=]/g, "").toUpperCase() : "";
   if (typeof b.code !== "string" || totpStep(secret, b.code) === null)
     return json({ error: "Moderator-এর নিজস্ব authenticator key ও বর্তমান কোড দিন।" }, 400);
   const encoded=await encodePassword(b.password),id=random();
   try{
    await transaction(async client=>{
     await client.query('INSERT INTO jamatnama.staff(id,username,totp_secret,password_hash,created_at) VALUES($1,$2,$3,$4,$5)',[id,username,sealSecret(secret),encoded,new Date().toISOString()]);
     await audit(actor,'moderator.created',id,username,client);
    });
   }catch(error){
    if((error as {code?:string}).code==='23505')return json({error:'এই username আগে ব্যবহার হয়েছে।'},409);
    throw error;
   }
  }else if(b.action==='disable'||b.action==='enable'){
   if(typeof b.id!=='string')return json({error:'সঠিক account দিন।'},400);
   const active=b.action==='enable';
   const found=await transaction(async client=>{
    const current=await client.query<{active:boolean}>('SELECT active FROM jamatnama.staff WHERE id=$1 FOR UPDATE',[b.id]);
    if(!current.rows[0])return false;
    // Revocation and the status change commit together. A repeat of the same action is a no-op.
    await client.query('DELETE FROM jamatnama.staff_sessions WHERE staff_id=$1',[b.id]);
    if(current.rows[0].active!==active){
     await client.query('UPDATE jamatnama.staff SET active=$1 WHERE id=$2',[active,b.id]);
     await audit(actor,`moderator.${b.action}`,String(b.id),'',client);
    }
    return true;
   });
   if(!found)return json({error:'Account পাওয়া যায়নি।'},404);
  }else return json({error:'সঠিক action দিন।'},400);
  return json({ok:true});
 }catch(error){return serverFailure('admin.team.write',error);}
}
