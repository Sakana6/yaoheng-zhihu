"""M12 explicit local opt-in. No UI or default R1 launcher change."""
import os,runpy
from pathlib import Path
os.environ['RA_ENABLED']='true'
print('M12: semantic candidates and frozen context enabled; reusing M11 capture services.',flush=True)
runpy.run_path(str(Path(__file__).with_name('run_ra_m11.py')),run_name='__main__')
