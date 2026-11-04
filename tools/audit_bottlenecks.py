import os, sys

sys.stdout.reconfigure(encoding='utf-8')

def scan_file(fname):
    with open(fname, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()

    findings = []
    for i, line in enumerate(lines):
        line_s = line.strip()
        # Look for loops
        if any(tok in line_s for tok in ['for (', 'for(', '.forEach(', 'while(', 'while (']):
            # Look at the next 30 lines inside this loop
            block = ''.join(lines[i:min(len(lines), i+35)])
            triggers = []
            if 'localStorage.' in block:
                triggers.append('localStorage in loop')
            if 'innerHTML +=' in block or 'innerHTML=' in block:
                triggers.append('innerHTML in loop')
            if 'icons()' in block or 'createIcons(' in block:
                triggers.append('icons() in loop')
            if 'renderCatalog(' in block or 'renderBell(' in block or 'renderStats(' in block:
                triggers.append('render call in loop')
            if 'getBoundingClientRect(' in block:
                triggers.append('layout read in loop')

            if triggers:
                findings.append((i+1, line_s[:70], triggers))

    return findings

for f in sorted(os.listdir('js')):
    if f.endswith('.js') and not f.endswith('.min.js'):
        fpath = os.path.join('js', f)
        res = scan_file(fpath)
        if res:
            print(f"\n=== {f} ({len(res)} loop bottlenecks) ===")
            for line_no, code, trigs in res:
                print(f"  Line {line_no:<5}: {', '.join(trigs)}")
                print(f"         {code}")
