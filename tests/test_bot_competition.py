"""Simulation checks for the virtual opponent engine."""
import os
import subprocess
import sys
from common import check, report, suite

suite('bot competition')
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
result = subprocess.run(['node', os.path.join(root, 'tests', 'test_bot_competition.js')],
                        cwd=root, capture_output=True, text=True)

for line in result.stdout.splitlines():
    if line.startswith('PASS '):
        check(line[5:], True)

check('opponent simulation passed', result.returncode == 0, result.stdout + result.stderr)
sys.exit(report())
