"""UI03 synthetic HTTP regression; called by the existing isolated R1 runner."""
from datetime import datetime, timedelta, timezone
import copy
import uuid

def run_ui03(request, sql, db, token):
    assert db.startswith('yaoheng_synthetic_'), 'Synthetic database required'
    now = datetime.now(timezone(timedelta(hours=8)))
    today = now.date().isoformat()
    yesterday = (now.date() - timedelta(days=1)).isoformat()
    tomorrow = (now.date() + timedelta(days=1)).isoformat()
    prefix = '/patients/1'
    def call(path, method='GET', body=None, expected=200):
        return request(prefix + path, method, body, token, uuid.uuid4().hex if method != 'GET' else None, expected)
    drug = call('/medications', 'POST', dict(genericName='UI03合成历史药-' + uuid.uuid4().hex[:6], dose='1片', frequency='QD', administrationTime='晚间', startDate=yesterday))
    plan = call('/reminder-plans', 'POST', dict(title='UI03合成跨日反馈', reminderType='MEDICATION', frequency='ONCE', timezone='Asia/Shanghai', localTime='23:55', startDate=tomorrow, endDate=tomorrow, medicationIds=[drug['id']]))
    occurrence_id = plan['occurrenceIds'][0]
    # Only fixture clock setup uses SQL; all application saves and revisions use HTTP.
    sql(db, f"update reminder_item set planned_at='{yesterday} 15:55:00' where patient_id=1 and reminder_key='{occurrence_id}'")
    occurrence = next(o for o in call('/reminders?date=' + yesterday)['items'] if o['occurrenceId'] == occurrence_id)
    assert occurrence['feedbackRecordId'] is None
    timestamp = today + 'T00:05:00+08:00'
    facts = dict(medications=[dict(medicationId=drug['id'],executionType='UNKNOWN',occurredAt=timestamp)],symptoms=[],explicitNoSymptoms=None,glucose=[],bloodPressure=[],meals=[])
    body = dict(rawText='UI03合成跨日原文：执行情况尚未确认。',source='REMINDER',occurredAt=timestamp,occurrenceId=occurrence_id,followUpId=None,expectedVersion=occurrence['version'],confirmedFacts=facts,textFactsReviewed=True)
    saved = call('/feedback-records', 'POST', body)
    oid_record = next(o for o in call('/reminders?date=' + yesterday)['items'] if o['occurrenceId'] == occurrence_id)
    assert oid_record['feedbackRecordId'] == saved['recordId']
    assert saved['recordId'] not in [r['recordId'] for r in call('/daily-events?date=' + yesterday)['items']]
    assert saved['recordId'] in [r['recordId'] for r in call('/daily-events?date=' + today)['items']]
    revise = copy.deepcopy(body)
    revise.update(expectedVersion=1, changeReason='合成跨日确认', rawText='UI03合成跨日确认：已补服，原发生时间保持。')
    revise['confirmedFacts']['medications'][0]['executionType'] = 'MAKEUP'
    revised = call('/feedback-records/' + saved['recordId'] + '/revisions', 'POST', revise)
    call('/feedback-records/' + saved['recordId'] + '/revisions', 'POST', revise, 409)
    assert revised['version'] == 2 and revised['revisions'][0]['confirmedFacts']['medications'][0]['executionType'] == 'UNKNOWN'
    assert revised['confirmedFacts']['medications'][0]['occurredAt'] == saved['confirmedFacts']['medications'][0]['occurredAt']
    call('/medications/' + str(drug['id']), 'PATCH', dict(expectedVersion=1,dose='2片',status='STOPPED'))
    historical = next(o for o in call('/reminders?date=' + yesterday)['items'] if o['occurrenceId'] == occurrence_id)
    assert historical['medications'][0]['dose'] == '1片' and historical['medications'][0]['version'] == 1
    assert call('/feedback-records/' + historical['feedbackRecordId'])['version'] == 2
    assert next(m for m in call('/medications?history=true')['medications'] if m['id'] == drug['id'])['dose'] == '2片'
    print('PASS UI03 cross-day feedback lookup, immutable occurrence medication, latest revision, unknown/makeup, conflict and time preservation')
    return dict(recordId=saved['recordId'],occurrenceId=occurrence_id,medicationId=drug['id'],today=today,yesterday=yesterday)
