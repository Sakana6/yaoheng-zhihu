"""Install verified, opt-in SenseVoice ONNX resources; no model training or credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request

NAME='sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09'
URL='https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'+NAME+'.tar.bz2'
SHA='7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63'
MODEL_SHA='12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d'


def install(root):
    root=root.resolve();root.mkdir(parents=True,exist_ok=True)
    archive=root/(NAME+'.tar.bz2')
    if not archive.exists():
        temporary=root/(NAME+'.download')
        urllib.request.urlretrieve(URL,temporary)
        if hashlib.sha256(temporary.read_bytes()).hexdigest()!=SHA:raise RuntimeError('ASR_ARCHIVE_HASH_MISMATCH')
        temporary.replace(archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=SHA:raise RuntimeError('ASR_ARCHIVE_HASH_MISMATCH')
    with tarfile.open(archive) as package:package.extractall(root,filter='data')
    if hashlib.sha256((root/NAME/'model.int8.onnx').read_bytes()).hexdigest()!=MODEL_SHA:raise RuntimeError('ASR_MODEL_HASH_MISMATCH')
    print(json.dumps(dict(modelDirectory=str(root/NAME),archiveSha256=SHA,modelSha256=MODEL_SHA)))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--directory',type=Path,default=Path('.local-evidence/asr'));install(p.parse_args().directory)
