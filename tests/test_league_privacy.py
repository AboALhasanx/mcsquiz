"""Regression for fail-closed league visibility reads."""
import os
import subprocess
import sys
from common import check, report, suite

suite('league privacy')
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
result = subprocess.run(['node', os.path.join(root, 'tests', 'test_league_privacy.js')],
                        cwd=root, capture_output=True, text=True)
check('visibility read failures never publish a hidden player', result.returncode == 0,
      result.stdout + result.stderr)
sys.exit(report())
