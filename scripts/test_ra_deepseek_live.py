"""Explicit opt-in LIVE acceptance. Only synthetic images/text; never prints credentials."""
import argparse
import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'services/ai-service'))
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from app.providers.deepseek import DeepSeek, ProviderError
from app.ra_capture import ImageInput, recognize


def fixtures(folder):
    folder.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 46)
    cases = [('metformin','二甲双胍'),('valsartan','缬沙坦'),('acarbose','阿卡波糖'),
             ('amlodipine','氨氯地平'),('glibenclamide','格列本脲'),('gliclazide','格列齐特'),
             ('rotated','二甲双胍'),('blurred','缬沙坦'),('multiple','二甲双胍 阿卡波糖'),
             ('unknown','合成未知药XYZ'),('nonmedicine','今天是星期三')]
    out = []
    for name, text in cases:
        image = Image.new('RGB', (1100, 330), 'white')
        draw = ImageDraw.Draw(image); draw.text((40, 65), text, font=font, fill='black')
        draw.text((40, 180), '合成演示图片', font=font, fill='gray')
        if name == 'rotated': image = image.rotate(5, fillcolor='white')
        if name == 'blurred': image = image.filter(ImageFilter.GaussianBlur(1))
        path = folder/(name+'.png'); image.save(path)
        out.append((path, text, name not in ('unknown','nonmedicine')))
    bad = folder/'invalid.png'; bad.write_bytes(b'not-image'); out.append((bad, '', False))
    return out


async def run(args):
    if args.credential_stdin:
        # Raw pipe input, not command arguments or a credential file.
        os.environ['DEEPSEEK_API_KEY'] = __import__('getpass').getpass('DeepSeek key (hidden): ') if sys.stdin.isatty() else sys.stdin.readline().strip()
    if not os.getenv('DEEPSEEK_API_KEY'):
        print('SKIP: DEEPSEEK_API_KEY missing; LIVE gate is NOT passed')
        return 2
    os.environ['RA_LLM_ENABLED'] = 'true'
    os.environ['RA_LLM_BUDGET_PATH'] = str(ROOT/'.local-evidence/ra-live-budget.sqlite3')
    args.out.mkdir(parents=True, exist_ok=True)
    engine = DeepSeek(); results = []
    try:
        t = time.monotonic()
        try:
            value, meta = await engine.complete('live_text_'+uuid.uuid4().hex,
                'Copy the entire user message verbatim into the string field text. Return a json object with only text; do not summarize or translate.', '合成测试：早餐吃得少。')
            results.append(dict(name='text-smoke', success=value.get('text') == '合成测试：早餐吃得少。', seconds=round(time.monotonic()-t,3), result=value, **meta))
        except ProviderError as e:
            results.append(dict(name='text-smoke', success=False, error=e.code))
        for path, expected, positive in ([] if args.text_only else fixtures(args.out/'fixtures')):
            t = time.monotonic()
            try:
                result = await recognize(ImageInput(requestId='live_'+uuid.uuid4().hex,
                    imageBase64=base64.b64encode(path.read_bytes()).decode()), engine)
                ok = (all(part in result['text'] for part in expected.split()) if positive else result['requiresConfirmation'])
                results.append(dict(name=path.stem, success=ok, seconds=round(time.monotonic()-t,3), result=result))
            except ProviderError as e:
                results.append(dict(name=path.stem, success=path.stem=='invalid' and e.code=='INVALID_IMAGE', error=e.code))
            (args.out/'live-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
            # Authentication errors cannot be repaired by sending more paid requests.
            if results[-1].get('error') in ('AUTH_REJECTED_401','AUTH_REJECTED_403','BALANCE_UNAVAILABLE','AUTH_UNAVAILABLE'): break
    finally:
        await engine.close()
        os.environ.pop('DEEPSEEK_API_KEY', None)
        (args.out/'live-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    passed = results[0]['success'] if args.text_only else len(results)==13 and results[0]['success'] and sum(x['success'] for x in results[1:7])>=5 and results[-1]['success']
    print(json.dumps({'livePassed':passed,'cases':len(results),'successful':sum(x['success'] for x in results)}))
    return 0 if passed else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--credential-stdin', action='store_true'); parser.add_argument('--text-only', action='store_true')
    raise SystemExit(asyncio.run(run(parser.parse_args())))
