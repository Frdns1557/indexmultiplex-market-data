export const FX_SPECS=[{name:'미국 달러',code:'USD',symbol:'KRW=X',unit:1},{name:'일본 엔',code:'JPY',symbol:'JPYKRW=X',unit:100},{name:'유럽 유로',code:'EUR',symbol:'EURKRW=X',unit:1}];
export function parseFx(result,spec){
 const m=result?.meta;if(m?.currency!=='KRW'||m.symbol!==spec.symbol||m.instrumentType!=='CURRENCY')throw Error('Unexpected FX instrument');
 const raw=m.regularMarketPrice,previous=m.chartPreviousClose??m.previousClose;if(!(raw>0)||!(previous>0)||!Number.isFinite(raw)||!Number.isFinite(previous)||!Number.isFinite(m.regularMarketTime))throw Error('Invalid FX quote');
 const points=(result.timestamp||[]).map((t,i)=>[t,result.indicators?.quote?.[0]?.close?.[i]]).filter(([t,v])=>Number.isFinite(t)&&Number.isFinite(v)&&v>0&&t<=m.regularMarketTime).map(([t,v])=>[t,v*spec.unit]);
 if(points.length<2)throw Error('FX chart unavailable');if(m.regularMarketTime>=points.at(-1)[0])points.push([m.regularMarketTime,raw*spec.unit]);
 return {...spec,currency:'KRW',price:raw*spec.unit,previousClose:previous*spec.unit,change:(raw-previous)*spec.unit,changePercent:(raw/previous-1)*100,marketTime:m.regularMarketTime,points,interval:'5m'};
}
export async function collectFx(source){const quotes=await Promise.all(FX_SPECS.map(async spec=>{const j=JSON.parse(await source('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(spec.symbol)+'?range=1d&interval=5m'));return parseFx(j.chart?.result?.[0],spec)}));return {asOf:new Date().toISOString(),source:'Yahoo Finance',base:'KRW',reference:'provider previous close',quotes}}
