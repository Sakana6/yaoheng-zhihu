"""Versioned candidate interpretation; no inference calls during replay."""
from datetime import datetime,timedelta,timezone
import re
from zoneinfo import ZoneInfo

VERSION='ra_temporal_v1'
def resolve(hint,reference,zone='Asia/Shanghai'):
    if zone!='Asia/Shanghai':raise ValueError('TIMEZONE_UNSUPPORTED')
    ref=datetime.fromisoformat(reference.replace('Z','+00:00'))
    if ref.utcoffset() is None:raise ValueError('OFFSET_REQUIRED')
    local=ref.astimezone(ZoneInfo(zone))
    out=dict(temporalVersion=VERSION,precision='UNKNOWN',start=None,end=None,basis='UNRESOLVED',timeHint=hint,future=False)
    try:
        if re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)',hint):
            start=datetime.fromisoformat(hint.replace('Z','+00:00'));end=start;precision='POINT';basis='EXPLICIT_OFFSET'
        elif hint in ('今天','昨天','明天') or re.fullmatch(r'\d{4}-\d\d-\d\d(?:至\d{4}-\d\d-\d\d)?',hint):
            if hint in ('今天','昨天','明天'):
                start=local.replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days={'今天':0,'昨天':-1,'明天':1}[hint]);end=start+timedelta(days=1)
            else:
                parts=hint.split('至');start=datetime.fromisoformat(parts[0]).replace(tzinfo=ZoneInfo(zone));end=datetime.fromisoformat(parts[-1]).replace(tzinfo=ZoneInfo(zone))+timedelta(days=1)
            if end<=start:return out
            precision='INTERVAL';basis='CALENDAR_DAY_HALF_OPEN'
        elif hint=='最近一周':start=ref-timedelta(days=7);end=ref;precision='INTERVAL';basis='COARSE_LAST_7_DAYS'
        else:return out
        out.update(precision=precision,start=start.astimezone(timezone.utc).isoformat(),end=end.astimezone(timezone.utc).isoformat(),basis=basis,future=start>ref)
    except ValueError:return out
    return out


def relation(a,b):
    """Only disjoint known bounds prove order. Touching bounds are not simultaneity."""
    if a['precision']=='UNKNOWN' or b['precision']=='UNKNOWN':return 'UNKNOWN'
    if datetime.fromisoformat(a['end'])<datetime.fromisoformat(b['start']):return 'BEFORE'
    if datetime.fromisoformat(b['end'])<datetime.fromisoformat(a['start']):return 'AFTER'
    return 'POSSIBLE_OVERLAP'
