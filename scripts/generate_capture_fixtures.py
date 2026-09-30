"""Generate synthetic labels only; replay is pinned to exact bytes, never filename."""
from pathlib import Path
import hashlib, json
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
def generate():
    folder=ROOT/'packages/contracts/capture/fixtures'
    folder.mkdir(parents=True,exist_ok=True)
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',28)
    items=[]
    for name,text in [('metformin','合成回放样例：格华止 二甲双胍片 0.5g'),('valsartan','合成回放样例：代文 缬沙坦胶囊 80mg'),('unknown','合成回放样例：未知药品 XYZ 7mg')]:
        im=Image.new('RGB',(760,140),'white');ImageDraw.Draw(im).text((20,45),text,font=font,fill='black')
        path=folder/(name+'.png');im.save(path)
        items.append(dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(),text=text,confidence=1.0,confidenceMeaning='synthetic fixture certainty, not OCR accuracy',boxes=[dict(text=text,x=20,y=45,width=720,height=45)]))
    target=ROOT/'services/backend/src/main/resources/capture/ocr-replay-v1.json'
    target.write_text(json.dumps(dict(version='synthetic-ocr-replay-1',fixtures=items),ensure_ascii=False,indent=2),encoding='utf-8')
    print('Generated 3 synthetic hash-bound fixtures')
if __name__=='__main__':generate()
