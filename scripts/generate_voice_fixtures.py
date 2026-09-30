"""Synthetic tone fixtures mapped explicitly to transcript scenarios, not recognition benchmarks."""
from pathlib import Path
import wave, math, struct, hashlib, json
ROOT=Path(__file__).resolve().parents[1]
def generate():
    folder=ROOT/'packages/contracts/capture/fixtures';folder.mkdir(parents=True,exist_ok=True)
    fixtures=[]
    for index,(name,text) in enumerate([('voice-negative','我今天没有吃药，请保留未知，核对后再记录。'),('voice-other','不是我，是家人以前发生过头晕。'),('voice-positive','合成回放：今天测量血糖为六。')]):
        path=folder/(name+'.wav')
        with wave.open(str(path),'wb') as output:
            output.setnchannels(1);output.setsampwidth(2);output.setframerate(8000)
            output.writeframes(b''.join(struct.pack('<h',int(1000*math.sin(2*math.pi*(440+index*110)*n/8000))) for n in range(1600)))
        fixtures.append(dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(),text=text,requiresConfirmation=True,fixtureType='synthetic tone; transcript scenario is explicitly assigned'))
    (ROOT/'services/backend/src/main/resources/capture/voice-replay-v1.json').write_text(json.dumps(dict(version='synthetic-voice-replay-1',fixtures=fixtures),ensure_ascii=False,indent=2),encoding='utf-8')
    print('Generated 3 explicit synthetic audio replay scenarios')
if __name__=='__main__':generate()
