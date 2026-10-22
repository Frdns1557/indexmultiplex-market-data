import json,datetime,exchange_calendars as xc
from zoneinfo import ZoneInfo
now=datetime.datetime.now(ZoneInfo('Asia/Seoul'))
c=xc.get_calendar('XKRX',start=f'{now.year-2}-01-01',end=f'{now.year}-12-31')
s=c.schedule
print(json.dumps({'date':now.date().isoformat(),'now':now.isoformat(),'sessions':{str(d.date()):{'open':r['open'].isoformat(),'close':r['close'].isoformat()} for d,r in s.iterrows()}}))
