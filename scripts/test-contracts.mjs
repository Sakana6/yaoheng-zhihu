import { spawnSync } from 'node:child_process';
import path from 'node:path';
const python = process.env.CONTRACT_PYTHON ?? path.resolve('services/ai-service/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const result = spawnSync(python, ['scripts/test_contracts.py'], { stdio: 'inherit' });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
