import * as XLSX from "xlsx";

/* EFFY Ambassador Dashboard parser.
   - col6 = voyage budget (total, repeated per row)
   - Sales Vs Budget = budgeted sales / voyage budget - 1 (true accumulated)
   - Zero-budget voyages excluded from Sales Vs Budget only (nb)
   - Non-revenue voyages (<= -99%) excluded from averages (nr)
   - Week runs Monday to Sunday (organizational performance week)
   - Contract reset: 4+ consecutive ship voyages missed ends a contract;
     only the latest contract is measured.
   - Fleets auto-discovered from sheet names (extensible). */

const MONTHS_FULL=["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_ORDER=Object.fromEntries(MONTHS_FULL.map((m,i)=>[m,i+1]));
const MS=Object.fromEntries(MONTHS_FULL.map(m=>[m,m.slice(0,3)]));
const COL={label:0,sales:1,trans:3,units:4,upt:5,budget:6,gap:7,pctVoy:9,pax:10};
const CONTRACT_GAP_VOYAGES=5;   // 5+ consecutive missed ship voyages ends a contract
const GREYOUT_GAP_VOYAGES=4;    // 4+ consecutive missed = mark inactive (greyed out)
const FLEET_REGISTRY={RCI:"rc",CCL:"carnival",NCL:"ncl",PCL:"pcl"};
const fleetSlug=(sheet)=>FLEET_REGISTRY[sheet]||sheet.toLowerCase().replace(/[^a-z0-9]/g,"");

const isDate=s=>/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(s).trim());
const isVoyageId=s=>/\d{4}-\d{2}-\d{2}/.test(String(s));
const isWeek=s=>/^\d+$/.test(String(s).trim());
const num=v=>{if(v===""||v==null)return 0;const n=Number(String(v).replace(/[$,]/g,""));return isNaN(n)?0:n;};
const parseVid=vid=>({id:vid,ship:vid.slice(0,-13).trim(),days:parseInt(vid.slice(-3),10),start:vid.slice(-13,-3)});
const formatShip=(raw)=>{const s=String(raw||"").trim();let m;m=s.match(/^RCI(.+?)\s*OTS$/i);if(m)return"RCI "+m[1].trim()+" OTS";m=s.match(/^CCL(.+)$/i);if(m)return"Carnival "+m[1].trim();m=s.match(/^NCL(.+)$/i);if(m)return"Norwegian "+m[1].trim();m=s.match(/^PCL(.+)$/i);if(m)return"Princess "+m[1].trim();return s||null;};
const latestShip=(recs)=>{let best=null,bt=-Infinity;for(const r of recs){if(!r.vid)continue;const t=new Date((r.vstart||"")+"T00:00:00").getTime();if(!isNaN(t)&&t>=bt){bt=t;best=r.vid.slice(0,-13).trim();}}return best?formatShip(best):null;};
const mondayKey=dt=>{const d=new Date(dt);const dow=(d.getDay()+6)%7;d.setDate(d.getDate()-dow);return d.toISOString().slice(0,10);};// week anchor: Monday (performance week Mon-Sun)
const estNow=()=>{const u=new Date();return new Date(u.getTime()-5*3600000);};
const lastCompletedWeekMonday=()=>{const n=estNow();const dow=(n.getUTCDay()+6)%7;const thisMon=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate()-dow));const lastMon=new Date(thisMon.getTime()-7*86400000);return lastMon.toISOString().slice(0,10);};// last completed Monday-to-Sunday week

export function parseExcelFile(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{
        const wb=XLSX.read(e.target.result,{type:"array"});
        const records=[];const fleetLabels={};
        for(const sheet of wb.SheetNames){
          const slug=fleetSlug(sheet);
          const recs=parseSheet(XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,raw:true,defval:""}),slug);
          if(recs.length){records.push(...recs);fleetLabels[slug]=sheet.toUpperCase();}
        }
        const ships=buildShipSchedules(records);
        const cands={};
        for(const r of records){if(!r.amb)continue;(cands[r.amb]=cands[r.amb]||{name:r.amb,org:r.fleet,records:[]}).records.push(r);}
        const results=[];
        for(const data of Object.values(cands)){const c=build(data,ships);if(c)results.push(c);}
        results.sort((a,b)=>a.name.localeCompare(b.name));
        const fleetMax={};
        for(const org of new Set(results.map(c=>c.org))){fleetMax[org]=Math.max(...results.filter(c=>c.org===org).map(c=>c.acc.sd),1);}
        console.log("Parsed:",results.length,"candidates",fleetLabels,fleetMax);
        resolve({candidates:results,fleetMax,fleetLabels});
      }catch(err){console.error("Parse error:",err);reject(err);}
    };
    reader.onerror=()=>reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

function parseSheet(rows,fleet){
  let start=rows.findIndex(r=>String(r?.[COL.label]??"").trim()==="Row Labels");
  start=start>=0?start+1:7;
  let amb=null,month=null,week=null,voy=null;const out=[];
  for(let i=start;i<rows.length;i++){
    const a=String(rows[i]?.[COL.label]??"").trim();
    if(!a||a.toLowerCase()==="grand total")continue;
    const cap=a.charAt(0).toUpperCase()+a.slice(1).toLowerCase();
    if(MONTH_ORDER[cap]){month=cap;week=null;voy=null;continue;}
    if(isDate(a)){
      const[m,d,y]=a.split("/").map(Number);const r=rows[i];
      out.push({fleet,amb,month,week,vid:voy?voy.id:null,vdays:voy?voy.days:null,vstart:voy?voy.start:null,
        date:new Date(y,m-1,d),sales:num(r[COL.sales]),trans:num(r[COL.trans]),units:num(r[COL.units]),
        upt:num(r[COL.upt]),budget:num(r[COL.budget]),gap:num(r[COL.gap]),pctVoy:num(r[COL.pctVoy]),pax:num(r[COL.pax])});
      continue;
    }
    if(isWeek(a)){week=parseInt(a,10);voy=null;continue;}
    if(isVoyageId(a)){voy=parseVid(a);continue;}
    amb=a;month=null;week=null;voy=null;
  }
  return out;
}

function buildShipSchedules(records){
  const ships={};
  for(const r of records){if(!r.vid)continue;const ship=r.vid.slice(0,-13).trim();const dt=new Date(r.vstart+"T00:00:00");if(!isNaN(dt))(ships[ship]=ships[ship]||new Set()).add(dt.getTime());}
  const out={};for(const s in ships)out[s]=[...ships[s]].sort((a,b)=>a-b);return out;
}

function latestContract(recs,ships){
  // missing 3+ consecutive ship voyages (no metric performance) ends a contract
  const voyMap={};
  for(const r of recs){if(r.vid&&!voyMap[r.vid])voyMap[r.vid]={start:new Date(r.vstart+"T00:00:00").getTime(),ship:r.vid.slice(0,-13).trim()};}
  const voys=Object.values(voyMap).sort((a,b)=>a.start-b.start);
  if(voys.length<2)return recs;
  let contractStart=voys[0].start;
  for(let j=0;j<voys.length-1;j++){
    const d1=voys[j].start,d2=voys[j+1].start,ship=voys[j].ship;
    const missed=(ships[ship]||[]).filter(x=>x>d1&&x<d2).length;
    if(missed>=CONTRACT_GAP_VOYAGES)contractStart=d2;
  }
  return recs.filter(r=>r.date.getTime()>=contractStart);
}

function buildVoyages(recs){
  const byVoy={};
  for(const r of recs){if(!r.vid)continue;const k=`${r.month}|${r.week}|${r.vid}`;(byVoy[k]=byVoy[k]||{month:r.month,week:r.week,recs:[]}).recs.push(r);}
  const voys=Object.values(byVoy).map(v=>{
    const sales=v.recs.reduce((a,r)=>a+r.sales,0),trans=v.recs.reduce((a,r)=>a+r.trans,0),units=v.recs.reduce((a,r)=>a+r.units,0);
    const budget=Math.max(...v.recs.map(r=>r.budget||0));const hasB=budget>0;
    const sp=hasB?Math.round((sales/budget-1)*100):-999;
    const gap=hasB?Math.round(sales-budget):0; // budget sales gap for the voyage (dollars)
    const pv=v.recs.filter(r=>r.pctVoy>0&&r.sales>0).reduce((a,r)=>a+r.pctVoy,0);
    return{month:v.month,week:v.week,date:v.recs[0].vstart||"",vdate:v.recs[0].vstart,vd:v.recs[0].vdays||0,
      sales,trans,units,budget,sp,gap,pctVoy:pv,aur:units?Math.round(sales/units):0,atv:trans?Math.round(sales/trans):0,
      upt:trans?Math.round(units/trans*100)/100:0,nr:(!hasB||sp<=-99)?1:0,nb:hasB?0:1};
  });
  voys.sort((a,b)=>(MONTH_ORDER[a.month]||0)-(MONTH_ORDER[b.month]||0)||(a.week||0)-(b.week||0));
  return voys;
}

function agg(list){
  const rev=list.filter(v=>!v.nb&&!v.nr);
  const budgeted=list.filter(v=>!v.nb);
  const n=budgeted.length;
  const bsales=budgeted.reduce((a,v)=>a+v.sales,0),bbudget=budgeted.reduce((a,v)=>a+v.budget,0);
  const ts=rev.reduce((a,v)=>a+v.sales,0),tu=rev.reduce((a,v)=>a+v.units,0),tt=rev.reduce((a,v)=>a+v.trans,0);
  const gap=budgeted.reduce((a,v)=>a+(v.gap||0),0); // total budget sales gap (dollars) across budgeted voyages
  return{sp:bbudget?Math.round((bsales/bbudget-1)*1000)/10:0,vs:n?Math.round(rev.reduce((a,v)=>a+v.pctVoy,0)/n*1000)/10:0,
    sd:n?Math.round(ts/n):0,sdTot:Math.round(ts),gap:Math.round(gap),aur:tu?Math.round(ts/tu):0,atv:tt?Math.round(ts/tt):0,
    tr:n?Math.round(tt/n*10)/10:0,u:n?Math.round(tu/n*10)/10:0,upt:tt?Math.round(tu/tt*100)/100:0,n:list.length,hasBudget:bbudget>0};
}

// True if the ambassador has missed GREYOUT_GAP_VOYAGES+ consecutive ship voyages
// since their LAST sailed voyage (i.e. they've recently gone quiet -> inactive).
function recentlyInactive(recs,ships){
  const voyMap={};
  for(const r of recs){if(r.vid&&!voyMap[r.vid])voyMap[r.vid]={start:new Date(r.vstart+"T00:00:00").getTime(),ship:r.vid.slice(0,-13).trim()};}
  const voys=Object.values(voyMap).sort((a,b)=>a.start-b.start);
  if(!voys.length)return true;
  const last=voys[voys.length-1];
  const sched=ships[last.ship]||[];
  // count ship voyages that departed AFTER this ambassador's last sailing
  const missedSince=sched.filter(x=>x>last.start).length;
  return missedSince>=GREYOUT_GAP_VOYAGES;
}

function build(data,ships){
  const recs=latestContract(data.records,ships);
  const voys=buildVoyages(recs);
  if(!voys.length)return null;
  const months=[...new Set(voys.map(v=>v.month))].sort((a,b)=>(MONTH_ORDER[a]||0)-(MONTH_ORDER[b]||0));
  const monthly={};
  for(const m of months){const a=agg(voys.filter(v=>v.month===m));monthly[MS[m]]={vs:a.vs,sp:a.sp,sd:a.sd,sdTot:a.sdTot,gap:a.gap,sdAvg:a.sd,aur:a.aur,atv:a.atv,tr:a.tr,trAvg:a.tr,u:a.u,uAvg:a.u,upt:a.upt,n:a.n};}
  const A=agg(voys);
  const acc={sp:A.sp,vs:A.vs,aur:A.aur,atv:A.atv,sd:A.sdTot,sdAvg:A.sd,gap:A.gap,tr:A.tr,trAvg:A.tr,u:A.u,uAvg:A.u,upt:A.upt};
  const lm=months[months.length-1];const mA=agg(voys.filter(v=>v.month===lm));
  const mtd={sp:mA.sp,vs:mA.vs,aur:mA.aur,atv:mA.atv,sd:mA.sdTot,gap:mA.gap,tr:mA.tr,u:mA.u,upt:mA.upt,month:MS[lm]};
  const weeks={};for(const v of voys)(weeks[mondayKey(v.vdate)]=weeks[mondayKey(v.vdate)]||[]).push(v);
  // Weekly view = last COMPLETED Mon-Sun week per EST (fallback to most recent completed week).
  const targetWk=lastCompletedWeekMonday();
  const completed=Object.keys(weeks).filter(wk=>wk&&wk<=targetWk);
  const lwk=weeks[targetWk]?targetWk:(completed.length?completed.sort().pop():null);
  let wkAvg={sp:0,vs:0,aur:0,atv:0,sd:0,tr:0,u:0,upt:0,weekOf:"",isCurrent:0};
  if(lwk){const w=agg(weeks[lwk]);wkAvg={sp:w.sp,vs:w.vs,aur:w.aur,atv:w.atv,sd:w.sdTot,tr:w.tr,u:w.u,upt:w.upt,weekOf:lwk,isCurrent:lwk===targetWk?1:0};}
  const mKeys=Object.keys(monthly).filter(k=>monthly[k].sp!==0||monthly[k].aur!==0);
  const tdir=(metric)=>{if(mKeys.length<2)return"none";const cur=monthly[mKeys[mKeys.length-1]][metric],prev=monthly[mKeys[mKeys.length-2]][metric];if(prev===0&&cur===0)return"none";const d=cur-prev;if(Math.abs(d)<0.01*Math.max(Math.abs(prev),1))return"trending";return d>0?"growth":"declining";};
  const trajD={sp:tdir("sp"),aur:tdir("aur"),tr:tdir("tr"),u:tdir("u")};
  let traj={st:0,vt:0,at:0,tt:0,d:"insufficient"};
  if(mKeys.length>=2){const r=monthly[mKeys[mKeys.length-1]],p=monthly[mKeys[mKeys.length-2]];const pc=(n,o)=>o!==0?Math.round((n-o)/Math.abs(o)*1000)/10:0;traj={st:pc(r.sp,p.sp),vt:pc(r.vs,p.vs),at:pc(r.aur,p.aur),tt:pc(r.atv,p.atv),d:""};traj.d=traj.st>10?"improving":traj.st<-10?"declining":"stable";}
  const growth=mKeys.length>=2?Math.round((monthly[mKeys[mKeys.length-1]].sp-monthly[mKeys[0]].sp)*10)/10:(mKeys.length?Math.round(monthly[mKeys[0]].sp*10)/10:0);
  const greyOut=recentlyInactive(data.records,ships);
  const status=greyOut?"Not Active":"Active";
  const tier=acc.sp>=20?"star":acc.sp>=0?"growth":acc.sp>=-25?"watch":"critical";
  const weekly=voys.map(v=>({m:MS[v.month],v:v.week||0,date:v.date,vd:v.vd,vs:Math.round(v.pctVoy*100),sp:v.sp,sd:Math.round(v.sales),gap:v.gap,aur:v.aur,tr:Math.round(v.trans),u:Math.round(v.units),upt:v.upt,atv:v.atv,nr:v.nr,nb:v.nb}));
  const ms=MONTHS_FULL.slice(0,6).map(m=>monthly[MS[m]]?Math.round(monthly[MS[m]].sd):null);
  const ship=latestShip(recs);
  return{name:data.name,org:data.org,ship,status,greyOut,module:"Unknown",mc:0,acc,mtd,wkAvg,traj,trajD,growth,tier,monthly,weekly,ms};
}
