"use client";
import {useEffect,useState} from 'react';
type Staff={id:string;username:string;active:boolean};
type Operations={evidence:Record<string,{count:number;bytes:number;oldest:string|null}>;budgetUsed:{total?:number;today?:number};budgetLimits:{total:number;daily:number};uploadsEnabled:boolean};
const gb=(n=0)=>(n/1073741824).toFixed(1);
type Log={id:number;actor_name:string;action:string;target:string;detail:string;created_at:string};
export default function TeamPanel(){
 const [staff,setStaff]=useState<Staff[]>([]),[logs,setLogs]=useState<Log[]>([]),[error,setError]=useState(''),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[ops,setOps]=useState<Operations|null>(null);
 async function load(){try{const r=await fetch(`/api/admin/team?page=${page}`);const d=await r.json();if(!r.ok)throw Error(d.error);setStaff(d.staff);setLogs(d.logs);setOps(d.operations);}catch(e){setError(String(e));}}
 useEffect(()=>{void load();},[page]);
 async function change(body:object){setBusy(true);setError('');try{const r=await fetch('/api/admin/team',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);await load();return true;}catch(e){setError(String(e));return false;}finally{setBusy(false);}}
 return <section className="admin-report"><h2>টিম ও কার্যক্রম — সুপার অ্যাডমিন</h2><p>Moderator রিপোর্ট পর্যালোচনা করতে পারেন। Account ও activity log শুধু আপনি পরিচালনা করবেন।</p>
 <form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form);if(await change({action:'create',username:f.get('username'),password:f.get('password')}))form.reset();}}>
 <label>Moderator username<input name="username" required pattern="[a-z0-9_-]{3,40}" autoComplete="off" placeholder="যেমন: karim_review"/></label>
 <label>পাসওয়ার্ড (কমপক্ষে ১৪ অক্ষর)<input name="password" type="password" minLength={14} maxLength={128} required autoComplete="new-password" placeholder="কমপক্ষে ১৪ অক্ষর"/></label>
 <button className="jwr-button" disabled={busy}>Moderator তৈরি করুন</button></form>
 {error&&<p role="alert">{error}</p>}
 {staff.map(s=><p key={s.id}>{s.username} — {s.active?'সক্রিয়':'বন্ধ'} <button disabled={busy} onClick={()=>void change({action:s.active?'disable':'enable',id:s.id})}>{s.active?'অ্যাকাউন্ট বন্ধ করুন':'সক্রিয় করুন'}</button></p>)}
 {ops&&<p className="muted">প্রমাণের স্টোরেজ: মোট {gb(ops.budgetUsed.total)} / {gb(ops.budgetLimits.total)} GB · আজ {gb(ops.budgetUsed.today)} / {gb(ops.budgetLimits.daily)} GB · স্ক্যানের অপেক্ষায় {ops.evidence.pending_scan?.count||0}টি · স্ক্যান ব্যর্থ {ops.evidence.scan_error?.count||0}টি · আপলোড {ops.uploadsEnabled?'চালু':'বন্ধ'}</p>}
 <h3>কার্যক্রমের ইতিহাস</h3><button disabled={busy} onClick={()=>void load()}>রিফ্রেশ</button>
 <div style={{overflowX:'auto'}}><table><thead><tr><th>সময়</th><th>Account</th><th>কাজ</th><th>বিষয়</th><th>পরিবর্তন</th></tr></thead><tbody>{logs.map(l=><tr key={l.id}><td>{new Date(l.created_at).toLocaleString('bn-BD')}</td><td>{l.actor_name}</td><td>{l.action}</td><td>{l.target}</td><td>{l.detail}</td></tr>)}</tbody></table></div>
 <button disabled={!page} onClick={()=>setPage(page-1)}>আগের পাতা</button><button disabled={logs.length<50} onClick={()=>setPage(page+1)}>পরের পাতা</button></section>;
}
