// Public market data only. No Site tokens, user data, or model calls.
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
const THRESHOLD=1_000_000_000;
const ROOT=path.resolve(process.env.MARKET_DATA_ROOT||'data');
const STAGE=path.resolve('.market-stage');
async function readJson(p){try{return JSON.parse(await readFile(p,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function save(p,d){await mkdir(path.dirname(p),{recursive:true});await writeFile(p,JSON.stringify(d))}
async function fund(env,t,cat){return readJson(path.join(ROOT,'funds',t+'.json'))}
async function put(env,key,data){const t=key.split('/').at(-1);if(!/^[A-Z0-9.-]+\.json$/.test(t))throw Error('Invalid ticker path');await save(path.join(STAGE,'funds',t),data)}
const iso=d=>d.toISOString().slice(0,10);
function nth(y,m,day,n){let d=new Date(Date.UTC(y,m-1,1));d.setUTCDate(1+(day-d.getUTCDay()+7)%7+(n-1)*7);return iso(d)}
function observed(y,m,day,newYear=false){const d=new Date(Date.UTC(y,m-1,day));if(d.getUTCDay()===0)d.setUTCDate(day+1);else if(d.getUTCDay()===6&&!newYear)d.setUTCDate(day-1);return iso(d)}
function easter(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;return new Date(Date.UTC(y,month-1,day))}
function sessionAt(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));const date=`${p.year}-${p.month}-${p.day}`,y=+p.year,d=new Date(date+'T12:00:00Z'),weekday=d.getUTCDay();const good=easter(y);good.setUTCDate(good.getUTCDate()-2);const memorial=new Date(Date.UTC(y,5,0));memorial.setUTCDate(memorial.getUTCDate()-(memorial.getUTCDay()+6)%7);const holidays=new Set([observed(y,1,1,true),nth(y,1,1,3),nth(y,2,1,3),iso(good),iso(memorial),observed(y,6,19),observed(y,7,4),nth(y,9,1,1),nth(y,11,4,4),observed(y,12,25)]);const thanks=new Date(nth(y,11,4,4)+'T12:00:00Z');thanks.setUTCDate(thanks.getUTCDate()+1);const early=!holidays.has(date)&&[iso(thanks),`${y}-07-03`,`${y}-12-24`].includes(date);const close=early?13*60:16*60,minute=+p.hour*60+ +p.minute;const tradingDay=weekday!==0&&weekday!==6&&!holidays.has(date);return{date,time:`${p.hour}:${p.minute}`,timezone:'America/New_York',open:tradingDay&&minute>=570&&minute<close,tradingDay,earlyClose:early,close:early?'13:00':'16:00',calendarSource:'https://www.nyse.com/markets/hours-calendars'};
}
export function collectionSlot(now=new Date()){
 const session=sessionAt(now),m=Number(session.time.slice(0,2))*60+Number(session.time.slice(3));
 const tomorrow=sessionAt(new Date(now.getTime()+86400000));let tradingDate=session.date,kind=null,start=null;
 const close=session.earlyClose?780:960;
 if(m>=1320){if(tomorrow.tradingDay){kind='overnight';start=1320;tradingDate=tomorrow.date}}
 else if(m>=120&&m<240){if(session.tradingDay){kind='overnight';start=120}}
 else if(session.tradingDay){
  if(m>=240&&m<570){kind='pre';start=Math.floor(m/60)*60}
  else if(m>=570&&m<close+30){kind='regular';start=570+Math.floor((m-570)/30)*30}
  else if(m>=1200&&m<1230){kind='after';start=1200}
  else if(m>=1080&&m<1110){kind='after';start=1080}
 }
 return {...session,tradingDate,kind,due:kind!==null,slot:kind===null?null:kind+'-'+String(start)};
}
const text=s=>s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const num=s=>{if(s==null)return null;const n=Number(String(s).replace(/[$,%]/g,''));return Number.isFinite(n)?n:null};
async function source(url){const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 IndexMultiplex personal research'},signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Source HTTP '+r.status+' '+new URL(url).hostname);return r.text()}
function rows(s){return [...s.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m=>text(m[1])))}
function overview(s){const rr=rows(s),stats=Object.fromEntries(rr.filter(r=>r.length===2)),info=Object.fromEntries([...s.matchAll(/<span class="block font-semibold">([\s\S]*?)<\/span>\s*<(?:span|a)[^>]*>([\s\S]*?)<\/(?:span|a)>/g)].map(m=>[text(m[1]),text(m[2])]));const site=s.match(/etf_website:"((?:\\.|[^"\\])*)"/);return{provider:info['ETF Provider']||info.Provider||null,category:info.Category||null,index:info['Index Tracked']||null,region:info.Region||null,exchange:info['Stock Exchange']||null,fee:num(stats['Expense Ratio']),holdingsCount:num(stats.Holdings),inception:stats['Inception Date']||null,dividend:stats.Dividend||null,exDividend:stats['Ex-Dividend Date']||null,frequency:stats['Payout Frequency']||null,website:site?JSON.parse('"'+site[1]+'"'):null,holdingsAsOf:s.match(/holdingsTable:\{count:\d+,updated:"([^"]+)"/)?.[1]||null,isActive:(()=>{const d=s.match(/description:"((?:\\.|[^"\\])*)"/);return d?/actively managed|active management|actively-managed/i.test(d[1]):null})(),recentDividends:rr.filter(r=>r.length===3&&/^[A-Z][a-z]{2} \d/.test(r[0])&&r[1].includes('$')).map(r=>({exDate:r[0],amount:num(r[1]),payDate:r[2]}))}}
function leverage(name,category){const s=name.toLowerCase(),m=s.match(/(-?[1234](?:\.\d+)?)\s*x\b/);if(m)return /short|bear|inverse/.test(s)?-Math.abs(+m[1]):+m[1];if(s.includes('ultrapro short'))return-3;if(s.includes('ultrapro'))return 3;if(s.includes('proshares')&&/ultrashort|ultra short/.test(s))return-2;if(s.includes('proshares ultra '))return 2;if((category||'').toLowerCase().includes('inverse'))return-1;return 1}
function classify(f,old){const ac={Equity:'주식','Fixed Income':'채권',Commodity:'원자재',Currency:'디지털자산·통화','Asset Allocation':'자산배분',Alternatives:'대체투자'},s=[f.name,f.index,f.category].join(' ').toLowerCase(),tags=[ac[f.assetClass]||f.assetClass,...(old?.tags||[]).filter(x=>!['레버리지','인버스'].includes(x))];for(const [tag,re]of [['S&P 500',/s&p ?500/],['나스닥',/nasdaq|qqq/],['배당',/dividend/],['성장주',/growth/],['가치주',/value/],['모멘텀',/momentum/],['퀄리티',/quality/],['현금흐름',/cash flow|cash cow/],['커버드콜·옵션',/covered call|option|premium income|derivative income/],['반도체',/semiconductor/],['기술주',/technology/],['국채',/treasury|government|t-bill/],['초단기채',/ultra.?short|0-3|cash management/],['장기채',/20\+|long.term|long.duration/],['회사채',/corporate/],['하이일드',/high.yield/],['금',/\bgold\b/],['은',/\bsilver\b/],['비트코인',/bitcoin/],['이더리움',/ether/],['해외주식',/international|ex.us|eafe/],['신흥국',/emerging/],['소형주',/small.cap|russell 2000/],['액티브',/active/]])if(re.test(s))tags.push(tag);if(f.isActive===true)tags.push('액티브');if(Math.abs(f.leverage)!==1)tags.push('레버리지');if(f.leverage<0)tags.push('인버스');return [...new Set(tags.filter(Boolean))]}
async function priceChart(t,full=false){const q=full?'period1=0&period2='+Math.floor(Date.now()/1000):'range=5d';const s=await source(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?${q}&interval=1d&events=div%2Csplits`),j=JSON.parse(s).chart.result?.[0];if(!j?.timestamp?.length||j.meta.dataGranularity!=='1d')throw Error('Daily chart unavailable');return j}
async function collect(env,entry,cat,job){const t=entry.ticker,prior=await fund(env,t,cat),base=`https://stockanalysis.com/etf/${t.toLowerCase()}/`;const needsMetadata=!prior||sessionAt(new Date(prior.metadataAsOf||prior.asOf)).date!==sessionAt().date;const [ov,hResult,initial]=await Promise.all([needsMetadata?source(base).then(overview):Promise.resolve({}),needsMetadata?source(base+'holdings/').then(s=>rows(s).filter(r=>r.length>=4&&/^\d+$/.test(r[0])).map(r=>({rank:+r[0],ticker:r[1]==='n/a'?null:r[1],name:r[2],weight:num(r[3])}))).then(items=>({items})).catch(e=>({error:e.message})):Promise.resolve({items:null}),priceChart(t,!prior)]);let chart=initial;const split=Object.values(chart.events?.splits||{}).some(s=>new Date(s.date*1000).toISOString().slice(0,10)>(prior?.priceDate||'0000'));if(prior&&split)chart=await priceChart(t,true);const prices=new Map(split?[]:prior?.prices||[]);chart.timestamp.forEach((stamp,i)=>{const p=chart.indicators.quote[0].close[i];if(Number.isFinite(p)&&p>0)prices.set(new Date(stamp*1000).toISOString().slice(0,10),Math.round(p*1e6)/1e6)});const ps=[...prices].sort((a,b)=>a[0].localeCompare(b[0]));if(ps.length<2)throw Error('Price history too short');const ds=new Map((prior?.dividends||[]).map(d=>[d.date,d]));for(const d of Object.values(chart.events?.dividends||{})){const date=new Date(d.date*1000).toISOString().slice(0,10);ds.set(date,{date,amount:d.amount})}for(const d of ov.recentDividends||[]){const date=new Date(d.exDate+' 12:00:00 UTC');if(!isNaN(date)&&d.amount!=null)ds.set(date.toISOString().slice(0,10),{date:date.toISOString().slice(0,10),amount:d.amount,source:'Stock Analysis'})}const now=new Date().toISOString();const data={...prior,...entry,...ov,prices:ps,price:ps.at(-1)[1],priceDate:ps.at(-1)[0],dailyChange:(ps.at(-1)[1]/ps.at(-2)[1]-1)*100,dailyDelta:ps.at(-1)[1]-ps.at(-2)[1],priceTime:chart.meta.regularMarketTime,currency:chart.meta.currency,dividends:[...ds.values()].sort((a,b)=>b.date.localeCompare(a.date)),holdings:hResult.items||prior?.holdings||[],holdingsSource:base+'holdings/',overviewSource:base,holdingsCollectedAt:hResult.items?now:prior?.holdingsCollectedAt||prior?.asOf,asOf:now,pricesAsOf:now,metadataAsOf:needsMetadata?now:prior.metadataAsOf||prior.asOf,errors:needsMetadata?(hResult.error?{holdings:hResult.error}:{}):(prior.errors||{}),dataVersion:job.id};data.leverage=leverage(data.name,data.category);data.tags=classify(data,prior);await put(env,`versions/${job.id}/${t}.json`,data);const summary={...data,holdingSearch:(data.holdings||[]).map(h=>({ticker:h.ticker,name:h.name,weight:h.weight}))};for(const k of ['prices','dividends','holdings','recentDividends','errors','website','inception','dividend','exDividend','frequency','holdingsAsOf'])delete summary[k];return summary}
async function collectIndices(){const specs=[['DOW','^DJI'],['NASDAQ','^IXIC'],['S&P 500','^GSPC']];const indices=await Promise.all(specs.map(async([name,symbol])=>{const j=JSON.parse(await source('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=1d&interval=5m&includePrePost=false')).chart.result?.[0];if(!j?.timestamp?.length)throw Error('Index history unavailable');const meta=j.meta,points=j.timestamp.map((t,i)=>[t,j.indicators.quote[0].close[i]]).filter(p=>Number.isFinite(p[1])&&p[1]>0),price=meta.regularMarketPrice??points.at(-1)?.[1],previousClose=meta.chartPreviousClose??meta.previousClose;if(!points.length||!Number.isFinite(price)||!Number.isFinite(previousClose)||previousClose<=0)throw Error('Index quote unavailable');const marketTime=meta.regularMarketTime||points.at(-1)[0];if(marketTime>=points.at(-1)[0])points.push([marketTime,price]);return{name,symbol,price,previousClose,change:price-previousClose,changePercent:(price/previousClose-1)*100,marketTime,points,currency:meta.currency,interval:'5m'}}));return{asOf:new Date().toISOString(),source:'Yahoo Finance',indices}}

async function extendedQuote(t,summary){
 const j=JSON.parse(await source('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(t)+'?range=1d&interval=5m&includePrePost=true')).chart.result?.[0];
 const ps=(j?.timestamp||[]).map((t,i)=>[t,j.indicators.quote[0].close[i]]).filter(p=>Number.isFinite(p[1])&&p[1]>0);
 const last=ps.at(-1);if(!last||last[0]<=(summary.priceTime||0))return;
 const previous=j.meta.chartPreviousClose??j.meta.previousClose;
 if(!Number.isFinite(previous)||previous<=0)throw Error('Previous close unavailable');
 Object.assign(summary,{price:last[1],priceTime:last[0],dailyDelta:last[1]-previous,dailyChange:(last[1]/previous-1)*100,quoteSession:'extended',quoteInterval:'5m'});
 const target=path.join(STAGE,'funds',t+'.json'),detail=await readJson(target);
 await save(target,{...detail,...summary,prices:detail.prices,dividends:detail.dividends,holdings:detail.holdings});
}
async function main(){
 const slot=collectionSlot(),manual=process.env.MANUAL_REFRESH==='true';
 const prior=await readJson(path.join(ROOT,'catalog.json'));
 if(!prior||prior.threshold!==THRESHOLD)throw Error('A valid public seed is required');
 const key=slot.tradingDate+':'+slot.slot;
 if(!manual&&(!slot.due||prior.completedSlot===key)){console.log(JSON.stringify({skipped:true,session:slot}));return}
 const refreshUniverse=prior.universeDate!==slot.tradingDate;
 const html=refreshUniverse?await source('https://stockanalysis.com/etf/?count=10000'):null,entries=refreshUniverse?[]:prior.funds.map(({ticker,name,assetClass,aum})=>({ticker,name,assetClass,aum}));
 for(const m of (html||'').matchAll(/\{s:"([^"]+)",n:"((?:\\.|[^"\\])*)",assetClass:"([^"]+)",aum:([\d.eE+-]+)\}/g)){
  const [,ticker,n,assetClass,aum]=m;if(+aum>=THRESHOLD&&!/\bETNs?\b/i.test(n)&&/^[A-Z0-9.-]{1,12}$/.test(ticker))entries.push({ticker,name:JSON.parse('"'+n+'"'),assetClass,aum:+aum});
 }
 if(entries.length<300||entries.length<prior.count*.7)throw Error('Incomplete source universe; previous snapshot retained');
 await rm(STAGE,{recursive:true,force:true});await mkdir(path.join(STAGE,'funds'),{recursive:true});
 const job={id:new Date().toISOString().replace(/[:.]/g,'-')},results=[],failures={};let next=0;
 async function worker(){while(next<entries.length){const entry=entries[next++];let done=false;for(let a=0;a<2;a++){try{const summary=await collect({},entry,prior,job);if(slot.kind!=='regular'){try{await extendedQuote(entry.ticker,summary)}catch(e){summary.extendedQuoteUnavailable=true}}delete summary.dataVersion;results.push(summary);done=true;break}catch(e){if(a===1)failures[entry.ticker]=String(e.message);else await new Promise(r=>setTimeout(r,1200))}}
  if(!done){const old=prior.funds.find(f=>f.ticker===entry.ticker),detail=await fund({},entry.ticker,prior);if(old&&detail){results.push({...old,aum:entry.aum});await save(path.join(STAGE,'funds',entry.ticker+'.json'),detail)}}
  if((next-1)%50===0)console.log(JSON.stringify({processed:next,total:entries.length,failed:Object.keys(failures).length}));
 }}
 await Promise.all(Array.from({length:6},worker));
 if(Object.keys(failures).length>entries.length*.1||results.length!==entries.length)throw Error('Incomplete refresh; previous snapshot retained');
 const indices=await collectIndices();const asOf=new Date().toISOString();
 results.sort((a,b)=>b.aum-a.aum);
 const catalog={...prior,asOf,threshold:THRESHOLD,count:results.length,funds:results,live:true,completedSlot:slot.due?key:prior.completedSlot,failedTickers:Object.keys(failures),errors:[],universeDate:slot.tradingDate,refreshCadence:'regular:30m; pre:1h; after:2; overnight:2',publicFeed:true,snapshotRef:process.env.SNAPSHOT_REF||null};
 await save(path.join(STAGE,'catalog.json'),catalog);await save(path.join(STAGE,'indices.json'),indices);
 await save(path.join(STAGE,'status.json'),{state:'completed',lastSuccessfulAt:asOf,count:results.length,failed:failures,session:slot,mode:'code-only-public-feed'});
 await rm(ROOT,{recursive:true,force:true});await rename(STAGE,ROOT);
 console.log(JSON.stringify({verified:true,count:results.length,asOf,failed:Object.keys(failures).length}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)main().catch(e=>{console.error(e.message);process.exitCode=1});
