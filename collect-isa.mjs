import {readFile,writeFile,mkdir,rename,rm,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.env.ISA_DATA_ROOT||'isa'),stage=root+'.stage';
const now=new Date(),manual=process.env.MANUAL_REFRESH==='true',calendar=JSON.parse(execFileSync('python',[path.join(here,'krx-calendar.py')],{encoding:'utf8'}));
const date=calendar.date,session=calendar.sessions[date],minute=60000;
const slot=session?Math.floor((now-new Date(session.open))/(30*minute)):-1,regularSlots=session?Math.round((new Date(session.close)-new Date(session.open))/(30*minute)):-1;
const post=session&&now>=new Date(new Date(session.close).getTime()+60*minute)&&now<new Date(new Date(session.close).getTime()+90*minute);
const due=session&&((slot>=0&&slot<=regularSlots&&now<new Date(new Date(session.close).getTime()+30*minute))||post);
const key=date+':'+(post?'post':slot);
const read=async p=>{try{return JSON.parse(await readFile(p,'utf8'))}catch{return null}};
const prior=await read(path.join(root,'catalog.json'));
if(!manual&&(!due||prior?.completedSlot===key)){console.log(JSON.stringify({skipped:true,reason:'Not a due KRX session slot',date}));process.exit(0)}
async function source(url,encoding='utf-8'){let error;for(let n=0;n<3;n++){try{const r=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'user-agent':'Mozilla/5.0','accept':'application/json,text/plain,*/*'}});if(!r.ok)throw Error('HTTP '+r.status);return new TextDecoder(encoding).decode(await r.arrayBuffer())}catch(e){error=e;if(n<2)await new Promise(r=>setTimeout(r,500*(n+1)))}}throw error}
const num=v=>v==null?null:Number(String(v).replace(/[, %]/g,''));
function won(v){if(typeof v==='number')return v;if(!v)return null;const s=String(v).replaceAll(',','');let n=0;for(const m of s.matchAll(/([\d.]+)\s*(조|억|만)/g))n+=+m[1]*({'조':1e12,'억':1e8,'만':1e4}[m[2]]);return n||num(s)}
export function tagsFor(name){const tags=['주식','해외주식'];const rules=[['S&P 500',/S&P\s*500/],['나스닥',/나스닥|NASDAQ/i],['배당',/배당/],['현금흐름',/캐시카우|현금흐름/],['모멘텀',/모멘텀/],['퀄리티',/퀄리티/],['가치주',/가치|밸류/],['성장주',/성장|그로스/],['커버드콜·옵션',/커버드콜|타겟콜|프리미엄/],['반도체',/반도체/],['기술주',/테크|기술|나스닥|AI|인공지능/],['액티브',/액티브/],['환헤지',/\(H\)|합성H|환헤지/],['미국',/미국|US/],['중국',/중국|차이나|항셍|홍콩/],['일본',/일본|니케이|TOPIX/],['인도',/인도/],['유럽',/유럽|유로/],['글로벌',/글로벌|월드|MSCI/],['레버리지',/레버리지|2X|3X|2배|3배/],['인버스',/인버스/]];for(const [t,r]of rules)if(r.test(name))tags.push(t);return tags}
const list=JSON.parse(await source('https://finance.naver.com/api/sise/etfItemList.nhn','euc-kr')).result?.etfItemList;
if(!Array.isArray(list)||list.length<300)throw Error('Incomplete ETF universe');
// Source category 4 is overseas equities; exclude single-company leveraged exposures.
const entries=list.filter(x=>x.etfTabCode===4&&!/(?:골드|금|은|원유|천연가스).*(?:선물|현물)|국제금커버드콜/.test(x.itemname)&&/^[A-Z0-9]{6}$/.test(x.itemcode)&&!/(?:테슬라|엔비디아|애플|아마존|메타|마이크로소프트|팔란티어|코인베이스|알파벳|브로드컴|AMD|TSMC|TSLA|NVDA).*(?:레버리지|2X|3X|2배|3배)/i.test(x.itemname));
if(entries.length<100)throw Error('Overseas equity ETF universe incomplete');
const reference=JSON.parse(await source('https://m.stock.naver.com/api/stock/'+entries[0].itemcode+'/basic'));
const quoteDate=reference.localTradedAt?.slice(0,10);if(!quoteDate||!/^\d{4}-\d{2}-\d{2}$/.test(quoteDate))throw Error('Quote date unavailable');
await rm(stage,{recursive:true,force:true});await mkdir(path.join(stage,'funds'),{recursive:true});
const results=[],failed=[];let next=0;
async function collect(entry){const t=entry.itemcode,old=await read(path.join(root,'funds',t+'.json')),metaDue=!old||old.metadataDate!==date||old.metadataSchema!==2,historyDue=!old||old.historyDate!==date||post;let info=old?.sourceInfo,bars=old?.prices||[],errors={};
 if(metaDue)info=JSON.parse(await source('https://m.stock.naver.com/api/etf/'+t+'/basic'));
 if(!info?.etfBaseIndex&&!info?.issuerName)throw Error('ETF metadata unavailable');
 if(historyDue){const raw=await source('https://api.finance.naver.com/siseJson.naver?symbol='+t+'&requestType=1&startTime=19900101&endTime='+date.replaceAll('-','')+'&timeframe=day');bars=[...raw.matchAll(/\["(\d{8})"\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)/g)].map(m=>[m[1].slice(0,4)+'-'+m[1].slice(4,6)+'-'+m[1].slice(6),+m[2]]).filter(p=>p[1]>0);if(!bars.length)throw Error('Price history unavailable')}
 const prices=new Map(bars);prices.set(quoteDate,entry.nowVal);bars=[...prices].sort((a,b)=>a[0].localeCompare(b[0]));
 const fields=Object.fromEntries((info.totalInfos||[]).map(v=>[v.code,v.value])),key=info.etfKeyIndicator||info,tags=tagsFor(entry.itemname),leverage=tags.includes('인버스')?(tags.includes('레버리지')?-2:-1):tags.includes('레버리지')?2:1;
 const f={ticker:t,name:entry.itemname,market:'isa',currency:'KRW',exchange:'KRX',assetClass:'Equity',category:'국내 상장 해외주식형',provider:key.issuerName||fields.issueName,index:info.etfBaseIndex||fields.etfBaseIdx||null,aum:won(key.totalNav),marketCap:won(key.marketValue),aumLabel:'순자산총액',fee:key.totalFee??num(fields.fundPay),leverage,tags,price:entry.nowVal,priceDate:quoteDate,priceTime:null,dailyChange:entry.changeRate,dailyDelta:entry.changeVal,nav:entry.nav,asOf:now.toISOString(),pricesAsOf:now.toISOString(),metadataAsOf:metaDue?now.toISOString():old.metadataAsOf,metadataDate:date,metadataSchema:2,historyDate:historyDue?date:old.historyDate,prices:bars,description:(info.etfSummary||info.description)?.replace(/<[^>]*>/g,' '),sourceDividendYield:key.dividendYieldTtm??null,sourceDividendPerShareTtm:info.dividendPerShareTtm??null,dividendMonths:info.dividendMonthsThisYear||null,dividends:[],holdings:(info.constituentList||[]).map((h,i)=>({rank:i+1,ticker:h.reutersCode?.replace(/\.(O|N|K|P)$/,''),name:h.itemName,weight:h.constituentWeight})),holdingsCount:info.constituentTotalCount??null,holdingsAsOf:null,holdingsCollectedAt:metaDue?now.toISOString():old.holdingsCollectedAt,holdingSearch:(info.constituentList||[]).map(h=>({ticker:h.reutersCode?.replace(/\.(O|N|K|P)$/,''),name:h.itemName,weight:h.constituentWeight})),overviewSource:'https://stock.naver.com/domestic/stock/'+t,holdingsSource:'https://stock.naver.com/domestic/stock/'+t,website:null,sourceInfo:info,errors};
 if(!(f.aum>0)||!(f.price>0))throw Error('Invalid ETF values');await writeFile(path.join(stage,'funds',t+'.json'),JSON.stringify(f));const summary={...f};for(const k of ['prices','sourceInfo','dividends','holdings','description','errors'])delete summary[k];results.push(summary)}
await Promise.all(Array.from({length:6},async()=>{while(next<entries.length){const e=entries[next++];try{await collect(e)}catch(err){failed.push({ticker:e.itemcode,error:err.message});const old=await read(path.join(root,'funds',e.itemcode+'.json'));if(old){await writeFile(path.join(stage,'funds',e.itemcode+'.json'),JSON.stringify(old));const f={...old};for(const k of ['prices','sourceInfo','dividends','holdings','description','errors'])delete f[k];results.push(f)}}}}));
if(results.length<entries.length*.95)throw Error('Too many failed ETFs; previous snapshot retained: '+JSON.stringify(failed));
results.sort((a,b)=>b.aum-a.aum);
const snapshotRef=process.env.SNAPSHOT_REF||'bundled-isa',catalog={market:'isa',currency:'KRW',asOf:now.toISOString(),quoteDate,source:'NAVER Finance',count:results.length,funds:results,threshold:null,snapshotRef,completedSlot:due?key:prior?.completedSlot,failedTickers:failed.map(x=>x.ticker),cadence:{timezone:'Asia/Seoul',regular:'09:00–15:30, every 30 minutes',postClose:'16:30 (one hour after close)',calendar:'XKRX exchange_calendars',modelCalls:0}};

const DIVERGENCE_RULES={left:2,right:2,indicator:"Wilder RSI 14",exposure:"positive-1x-only",closedBarsOnly:true};
function rsiSeries(values,period=14){
 const out=Array(values.length).fill(null);if(values.length<=period)return out;
 let gain=0,loss=0;for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}gain/=period;loss/=period;
 const value=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
 out[period]=value();for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;out[i]=value()}return out;
}

function findDivergences(bars,rsis,frame='daily'){
 const {left,right}=DIVERGENCE_RULES,maxAge=frame==='weekly'?4:10,maxGap=frame==='weekly'?26:60,minGap=5;
 const signals=[];
 for(const type of ['bullish','bearish']){
  const pivots=[];for(let i=Math.max(14,left);i<bars.length-right;i++){
   const v=bars[i][1];let pivot=true;for(let k=1;k<=left;k++)if(type==='bullish'?v>=bars[i-k][1]:v<=bars[i-k][1])pivot=false;for(let k=1;k<=right;k++)if(type==='bullish'?v>=bars[i+k][1]:v<=bars[i+k][1])pivot=false;if(pivot&&Number.isFinite(rsis[i]))pivots.push(i);
  }
  for(let k=1;k<pivots.length;k++){
   const a=pivots[k-1],b=pivots[k],confirmed=b+right,age=bars.length-1-confirmed;
   if(b-a<minGap||b-a>maxGap||age>=maxAge)continue;
   const p1=bars[a][1],p2=bars[b][1],r1=rsis[a],r2=rsis[b];
   if(!(type==='bullish'?p2<p1&&r2>r1:p2>p1&&r2<r1))continue;
   // A later close beyond the second pivot invalidates the setup.
   if(bars.slice(confirmed+1).some(p=>type==='bullish'?p[1]<p2:p[1]>p2))continue;
   signals.push({type,timeframe:frame,firstDate:bars[a][0],secondDate:bars[b][0],confirmedDate:bars[confirmed][0],firstPrice:p1,secondPrice:p2,firstRsi:r1,secondRsi:r2,priceChange:(p2/p1-1)*100,rsiChange:r2-r1,barsApart:b-a,barsSinceConfirmation:age});
  }
 }
 return signals;
}

function weekKey(d){const x=new Date(d+'T12:00Z');x.setUTCDate(x.getUTCDate()-(x.getUTCDay()+6)%7);return x.toISOString().slice(0,10)}
const divergence={asOf:catalog.asOf,snapshotRef,rules:DIVERGENCE_RULES,coverage:{total:results.filter(f=>f.leverage===1).length,catalogTotal:results.length,daily:0,weekly:0},daily:{bullish:[],bearish:[]},weekly:{bullish:[],bearish:[]}};
const week=weekKey(date),futureThisWeek=Object.keys(calendar.sessions).some(d=>d>date&&weekKey(d)===week),closedToday=session&&now>=new Date(session.close);
for(const f of results.filter(f=>f.leverage===1)){
 const detail=await read(path.join(stage,'funds',f.ticker+'.json')),daily=detail.prices.filter(p=>p[0]<date||(p[0]===date&&closedToday));const groups=new Map();for(const p of daily)groups.set(weekKey(p[0]),p);
 const weekly=[...groups].filter(([k])=>k<week||(k===week&&!futureThisWeek&&closedToday)).map(([,p])=>p);
 for(const [frame,bars]of [['daily',daily],['weekly',weekly]]){if(bars.length<24)continue;divergence.coverage[frame]++;const signals=findDivergences(bars,rsiSeries(bars.map(p=>p[1])),frame);for(const type of ['bullish','bearish']){const s=signals.filter(x=>x.type===type).at(-1);if(s)divergence[frame][type].push({ticker:f.ticker,name:f.name,...s,lastClose:bars.at(-1)[1],lastCloseDate:bars.at(-1)[0]})}}
}
for(const frame of ['daily','weekly'])for(const type of ['bullish','bearish'])divergence[frame][type].sort((a,b)=>b.confirmedDate.localeCompare(a.confirmedDate));
await writeFile(path.join(stage,'divergence.json'),JSON.stringify(divergence));await writeFile(path.join(stage,'catalog.json'),JSON.stringify(catalog));
await rm(root,{recursive:true,force:true});await rename(stage,root);console.log(JSON.stringify({count:results.length,asOf:catalog.asOf,quoteDate,failed,coverage:divergence.coverage}));
