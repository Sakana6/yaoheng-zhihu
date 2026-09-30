"""Serial backend regressions plus all frontend/unit checks; writes no credentials."""
import hashlib, json, os, re, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.runtime-logs/r2-regression'
def run():
    OUT.mkdir(parents=True,exist_ok=True);results=[]
    def check(name,command,cwd=ROOT):
        print('START '+name,flush=True)
        completed=subprocess.run(command,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (OUT/(name+'.txt')).write_bytes(completed.stdout)
        results.append(dict(name=name,command=command,cwd=str(cwd),exitCode=completed.returncode))
        (OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
        print(('PASS ' if completed.returncode==0 else 'FAIL ')+name,flush=True)
        return completed.returncode==0
    check('backend-build',['mvn.cmd','-q','-f','services/backend/pom.xml','test-compile'])
    check('backend-classpath',['mvn.cmd','-q','-f','services/backend/pom.xml','dependency:build-classpath','-Dmdep.outputFile=target/classpath.txt'])
    cp=str(ROOT/'services/backend/target/test-classes')+os.pathsep+str(ROOT/'services/backend/target/classes')+os.pathsep+(ROOT/'services/backend/target/classpath.txt').read_text().strip()
    check('capture-boundary',['java','-cp',cp,'com.yaoheng.backend.CaptureBoundaryTest'])
    for test in sorted((ROOT/'scripts').glob('test-*.mjs')):check(test.stem,['node',str(test)])
    python=str(ROOT/'services/ai-service/.venv/Scripts/python.exe')
    check('ai-rules',[python,'-m','pytest','tests','-q'],ROOT/'services/ai-service')
    check('local-launcher',[sys.executable,'scripts/test_local_launcher.py'])
    check('mobile-build',['npm.cmd','run','build:mobile'])
    check('doctor-build',['npm.cmd','run','build:doctor'])
    check('r1-integration',[sys.executable,'scripts/test_r1_integration.py'])
    check('analysis-integration',[sys.executable,'scripts/test_analysis_integration.py'])
    check('capture-integration',[sys.executable,'scripts/test_capture_integration.py'])
    # The original page styles must remain byte-equivalent to the R1 audit baseline.
    styles=[]
    for name in ['HomeView.vue','ProfileView.vue','RecordView.vue','MedicationView.vue','RiskView.vue']:
        relative='apps/mobile-app/src/views/'+name
        if not (ROOT/relative).exists():continue
        old=subprocess.check_output(['git','show','6b75e9e:'+relative],cwd=ROOT).decode('utf-8')
        new=(ROOT/relative).read_text(encoding='utf-8')
        extract=lambda text:re.findall(r'<style[^>]*>([\s\S]*?)</style>',text)
        unchanged=extract(old)==extract(new);assert unchanged,name
        styles.append(dict(file=relative,originalStylesUnchanged=unchanged,sha256=hashlib.sha256(''.join(extract(new)).encode()).hexdigest()))
    (OUT/'ui-style-baseline.json').write_text(json.dumps(styles,indent=2),encoding='utf-8')
    print('PASS original page style blocks unchanged against 6b75e9e',flush=True)
    if any(x['exitCode'] for x in results):raise SystemExit('Some checks failed; inspect results.json')
    print('PASS all '+str(len(results))+' checks',flush=True)
if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=OUT)
    OUT=parser.parse_args().out.resolve();run()
