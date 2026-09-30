"""Deterministic educational ranking, not clinical calibration."""
import math

KNOWLEDGE = (
    dict(id='synthetic-g', version='1', source='LOCAL_SYNTHETIC', chainType='G',
         drugClass='GLUCOSE_LOWERING', fields=['glucose','meals','symptoms'], text='核对进食、实际血糖测量和症状，资料缺失时保留未知。'),
    dict(id='synthetic-b', version='1', source='LOCAL_SYNTHETIC', chainType='B',
         drugClass='BP_LOWERING', fields=['bloodPressure','symptoms'], text='核对实际血压测量和不适发生时间，交由医生结合记录复核。'),
)


def ahp(matrix):
    """Positive reciprocal 3x3 matrix; reject inconsistent illustrative weights."""
    if len(matrix) != 3 or any(len(row) != 3 for row in matrix):
        raise ValueError('AHP requires a 3x3 matrix')
    for i in range(3):
        for j in range(3):
            value = matrix[i][j]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError('invalid AHP value')
            if not math.isclose(value * matrix[j][i], 1, rel_tol=1e-8):
                raise ValueError('AHP matrix must be reciprocal')
    weights = [1/3] * 3
    for _ in range(100):
        values = [sum(matrix[i][j] * weights[j] for j in range(3)) for i in range(3)]
        weights = [v / sum(values) for v in values]
    eigenvalue = sum(sum(matrix[i][j] * weights[j] for j in range(3))/weights[i] for i in range(3))/3
    cr = max(0, (eigenvalue-3)/2/.58)
    if cr > .1 or not math.isclose(sum(weights), 1):
        raise ValueError('AHP consistency failed')
    return dict(weights=[round(w, 8) for w in weights], consistencyRatio=round(cr, 8),
                matrix=matrix, source='SIMULATED_NOT_EXPERT_REVIEWED', usedForClinicalPriority=False)


def rank(chains, classes):
    for chain in chains:
        chain['citations'] = [dict(k) for k in KNOWLEDGE
                              if k['chainType'] == chain['chainType'] and k['drugClass'] in classes
                              and (not chain['missingFields'] or set(chain['missingFields']) & set(k['fields']))]
        chain['rankFactors'] = dict(signal=2 if chain['status']=='MATCHED' else 1 if chain['status']=='INSUFFICIENT' else 0,
                                    missingCount=len(chain['missingNodeIds']), recentAt=chain['referenceTime'])
    chains.sort(key=lambda c: (-c['rankFactors']['signal'], -c['rankFactors']['missingCount'],
                              -c['referenceEpoch'], c['chainId']))
    for index, chain in enumerate(chains):
        chain['rank'] = index+1
        del chain['referenceEpoch']
    return dict(version='r3_rank_v1', method='LEXICOGRAPHIC_SIGNAL_MISSING_RECENCY_ID',
                illustrativeAHP=ahp([[1,2,6],[.5,1,3],[1/6,1/3,1]]))
