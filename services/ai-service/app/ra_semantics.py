"""M12 conservative evidence extraction. All results remain unconfirmed candidates."""
import re
from app.r3_projection import digest,canonical

SYMPTOMS={'头晕':'DIZZINESS','出汗':'SWEATING','手抖':'TREMOR','乏力':'FATIGUE','站立不稳':'UNSTEADY'}
DRUGS=('二甲双胍','缬沙坦','阿卡波糖','氨氯地平','格列本脲','格列齐特')

def classify(quote):
    subject='OTHER' if re.search(r'家人|妈妈|爸爸|母亲|父亲|他|她|爷爷|奶奶',quote) else 'SELF'
    polarity='UNCERTAIN' if re.search(r'如果|假如|可能|也许|是否|会不会|吗|[?？]|不确定|好像|或者|还是',quote) else 'NEGATED' if re.search(r'没有|并无|未曾|不头晕|否认|无症状',quote) else 'AFFIRMED'
    return subject,polarity


def extract(raw):
    output=[]
    # Clause-level quote retains negation, subject and modality; code-point spans.
    for match in re.finditer(r'[^，,。；;！!\n]+',raw):
        quote=match.group().strip()
        if not quote:continue
        start=match.start()+len(match.group())-len(match.group().lstrip())
        subject,polarity=classify(quote)
        # Ambiguous carried subjects/modality are withheld across clauses, not guessed.
        whole_subject,whole_polarity=classify(raw)
        if whole_subject=='OTHER' and subject=='SELF' and not quote.startswith('我'):subject='UNKNOWN'
        if whole_polarity=='UNCERTAIN':polarity='UNCERTAIN'
        hint_match=re.search(r'\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)|\d{4}-\d\d-\d\d(?:至\d{4}-\d\d-\d\d)?|最近一周|昨天|今天|明天|晨起|饭后不久|饭后',quote)
        hint=hint_match.group() if hint_match else ''
        def add(kind,payload,pol=polarity):
            output.append(dict(kind=kind,payload=payload,quote=quote,subject=subject,polarity=pol,timeHint=hint,span=[start,start+len(quote)]))
        for name,code in SYMPTOMS.items():
            if name in quote:add('SYMPTOM',dict(code=code))
        if '无症状' in quote:add('NO_SYMPTOMS',dict(explicitNoSymptoms=True),'AFFIRMED' if polarity!='UNCERTAIN' and not re.search(r'不是|并非',quote) else 'UNCERTAIN')
        bg=re.search(r'血糖(?:是|为|测得|测量|：|:|\s)*([0-9]+(?:\.[0-9]+)?)\s*(mmol/L|毫摩尔/升)?',quote,re.I)
        if bg and not re.search(r'mg[/／]d[lL]|毫克',quote):
            value=float(bg[1])
            if .1<=value<=99:add('BG',dict(value=value,unit='mmol/L'))
        bp=re.search(r'血压(?:是|为|：|:|\s)*([0-9]{2,3})\s*[/／]\s*([0-9]{2,3})',quote)
        if bp and 30<=int(bp[1])<=300 and 20<=int(bp[2])<=200 and int(bp[1])>int(bp[2]):add('BP',dict(systolic=int(bp[1]),diastolic=int(bp[2]),unit='mmHg'))
        for meal,code in [('早餐','BREAKFAST'),('午餐','LUNCH'),('晚餐','DINNER'),('加餐','SNACK')]:
            if meal in quote:
                intake='SKIPPED' if re.search(r'没吃|未吃|没进食',quote) else 'INSUFFICIENT' if re.search(r'少|不足',quote) else 'NORMAL' if '正常' in quote else 'UNKNOWN'
                add('MEAL',dict(mealType=code,intakeLevel=intake))
        for drug in DRUGS:
            if drug in quote:
                execution='MAKEUP' if '补服' in quote else 'MISSED' if re.search(r'漏服|没服|忘记服|没有服',quote) else 'UNKNOWN' if re.search(r'不知道|不确定|记不清',quote) else 'TAKEN' if re.search(r'已服|服了|吃了',quote) else None
                if execution:add('ADHERENCE',dict(medicineName=drug,executionType=execution))
    # Contradictory mentions never become affirmative prefill.
    for c in output:
        if any(o['kind']==c['kind'] and o['subject']==c['subject'] and (o['polarity']!=c['polarity'] or (c['kind'] in ('BG','BP','ADHERENCE') and o['payload']!=c['payload'])) for o in output):c['conflict']=True
    return output


def validate_model(raw,body):
    if not isinstance(body,dict) or set(body)!={'candidates','contextTags'} or not isinstance(body['candidates'],list) or len(body['candidates'])>20 or body['contextTags']!=[]:raise ValueError('MODEL_SCHEMA')
    expected=extract(raw);validated=[]
    for row in body['candidates']:
        if not isinstance(row,dict) or set(row)!={'kind','payload','quote','subject','polarity','timeHint'}:raise ValueError('MODEL_SCHEMA')
        matches=[e for e in expected if all(canonical(e[k])==canonical(row[k]) for k in row)]
        # Repeated quote cannot be located without independent context; do not invent a span.
        if len(matches)!=1 or raw.count(row['quote'])!=1:raise ValueError('MODEL_EVIDENCE')
        validated.append(matches[0])
    # Omissions of supported evidence also trigger explicit whole-output fallback.
    if sorted(digest(x) for x in validated)!=sorted(digest(x) for x in expected):raise ValueError('MODEL_OMISSION')
    return validated


def context_tags(raw):
    tags=[]
    patterns={'NEGATION':r'没有|否认|无症状','OTHER_SUBJECT':r'家人|妈妈|爸爸|父亲|母亲|他|她','CONDITIONAL':r'如果|假如','QUESTION':r'是否|会不会|吗|[?？]','SEQUENCE':r'后来|然后|之后|之前','REPEATED':r'又|再次|反复'}
    for kind,pattern in patterns.items():
        for m in re.finditer(pattern,raw):tags.append(dict(kind=kind,quote=m[0],span=[m.start(),m.end()],basis='LOCAL_LITERAL_RULE',tagVersion='ra_tags_v1'))
    return sorted(tags,key=lambda t:(t['span'],t['kind']))
