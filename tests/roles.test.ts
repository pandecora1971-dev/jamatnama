import {test,after,before} from 'node:test';import assert from 'node:assert/strict';import{randomBytes}from'node:crypto';
import{staffIdentity,hash,random,audit,encodePassword,passwordValid}from'../lib/security';
import{sealSecret,openSecret}from'../lib/secrets';
import{admin,finish,resetData}from'./support/db';
process.env.SESSION_SECRET=randomBytes(32).toString('hex');
before(resetData);after(finish);
test('moderator sessions resolve identity and disable takes effect immediately',async()=>{
 const id=random(),token=random();const encoded=await encodePassword('long-password-for-test');
 await admin.query('INSERT INTO jamatnama.staff(id,username,totp_secret,password_hash,created_at) VALUES($1,$2,$3,$4,$5)',[id,'reviewer',sealSecret('A'.repeat(32)),encoded,new Date().toISOString()]);
 await admin.query('INSERT INTO jamatnama.staff_sessions(token_hash,staff_id,expires) VALUES($1,$2,$3)',[hash(token),id,Date.now()+10000]);
 assert.equal(await passwordValid('long-password-for-test',encoded),true);assert.equal(await passwordValid('wrong',encoded),false);
 assert.deepEqual(await staffIdentity(token),{id,username:'reviewer',role:'moderator'});
 await admin.query('UPDATE jamatnama.staff SET active=false WHERE id=$1',[id]);assert.equal(await staffIdentity(token),null);
 await admin.query('UPDATE jamatnama.staff SET active=true WHERE id=$1',[id]);await admin.query('UPDATE jamatnama.staff_sessions SET expires=0');assert.equal(await staffIdentity(token),null);
});
test('audit preserves account attribution and never needs credentials',async()=>{
 await audit({id:'owner',username:'superadmin',role:'superadmin'},'moderator.disable','test-id');
 const {rows}=await admin.query('SELECT * FROM jamatnama.audit_log');assert.equal(rows[0]?.actor_name,'superadmin');assert.equal(rows[0]?.action,'moderator.disable');assert.equal(rows[0]?.detail,'');
});
test('authenticator secrets are sealed at rest and tamper-evident',()=>{
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',sealed=sealSecret(secret);
 assert.equal(sealed.includes(secret),false);assert.equal(openSecret(sealed),secret);
 const parts=sealed.split('.');parts[3]=Buffer.from('tampered').toString('base64url');
 assert.throws(()=>openSecret(parts.join('.')));assert.throws(()=>openSecret(secret));
});
