"""Replay frozen M12 artifacts locally; never invokes DeepSeek."""
import argparse,asyncio,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'services/ai-service'))
from app.ra_temporal import resolve
from app.r3_projection import digest
from app.ra_projection import project
class Frozen:
    def __init__(self,row):self.row=row
    async def complete(self,*_):return self.row['providerOutput'],self.row['providerMeta']
async def run(args):
    rows=json.loads(args.live.read_text(encoding='utf-8'))
    for row in rows:
        assert row['providerOutput'] is not None
        # History reads frozen results; never re-extract with a newer rules/prompt implementation.
        frozen=dict(row['output']);output_hash=frozen.pop('outputHash');assert digest(frozen)==output_hash
        for candidate in frozen['candidates']:
            a,b=candidate['span'];assert row['input']['rawText'][a:b]==candidate['quote']
            assert resolve(candidate['timeHint'],row['input']['referenceTime'],row['input']['timezone'])==candidate['anchor']
    result={'frozenCases':len(rows),'passed':True}
    if args.packet:
        packet=json.loads(args.packet.read_text(encoding='utf-8'));out=project(packet)
        if args.expected:assert out==json.loads(args.expected.read_text(encoding='utf-8'))
        result['projection']=out
    args.out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print('PASS offline frozen replay')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--live',type=Path,required=True);p.add_argument('--packet',type=Path);p.add_argument('--expected',type=Path);p.add_argument('--out',type=Path,required=True);asyncio.run(run(p.parse_args()))
