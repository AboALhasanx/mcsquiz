#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Color audit script: finds all hardcoded color literals, classifies warm/yellow/orange/gold hues,
and groups them by file and CSS selector or code context.
"""
import re
import colorsys
from pathlib import Path

def hex_to_rgb(hex_str):
    hex_str = hex_str.lstrip('#')
    if len(hex_str) == 3:
        hex_str = ''.join([c*2 for c in hex_str])
    elif len(hex_str) == 4:
        hex_str = ''.join([c*2 for c in hex_str[:3]])
    elif len(hex_str) == 8:
        hex_str = hex_str[:6]
    r = int(hex_str[0:2], 16)
    g = int(hex_str[2:4], 16)
    b = int(hex_str[4:6], 16)
    return r, g, b

def rgb_to_hsl(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r/255.0, g/255.0, b/255.0)
    return h * 360, s * 100, l * 100

def parse_rgba(rgba_str):
    m = re.match(r'rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', rgba_str)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    return None

def main():
    root = Path('.')
    files_to_scan = list(root.glob('css/*.css')) + list(root.glob('js/*.js')) + [Path('index.html')]
    
    color_regex = re.compile(r'(#[0-9a-fA-F]{3,8}|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\))')
    
    findings = []
    
    for f in files_to_scan:
        content = f.read_text(encoding='utf-8', errors='ignore')
        lines = content.splitlines()
        for idx, line in enumerate(lines):
            # Skip comments if possible or scan all
            for match in color_regex.finditer(line):
                c_str = match.group(1).strip()
                # Determine RGB
                rgb = None
                if c_str.startswith('#'):
                    try:
                        rgb = hex_to_rgb(c_str)
                    except:
                        pass
                elif c_str.startswith('rgb'):
                    rgb = parse_rgba(c_str)
                
                if rgb:
                    h, s, l = rgb_to_hsl(*rgb)
                    # Check if in warm yellow/amber/orange/gold spectrum: Hue between 15 and 65, saturation > 15%, lightness between 15% and 90%
                    is_warm_accent = (15 <= h <= 65) and (s >= 15) and (15 <= l <= 92)
                    findings.append({
                        'file': str(f),
                        'line': idx + 1,
                        'text': line.strip(),
                        'color': c_str,
                        'rgb': rgb,
                        'h': round(h, 1),
                        's': round(s, 1),
                        'l': round(l, 1),
                        'is_warm_accent': is_warm_accent
                    })
                    
    warm_colors = [f for f in findings if f['is_warm_accent']]
    print(f"Total color literals found: {len(findings)}")
    print(f"Warm accent/yellow/orange/gold color literals found: {len(warm_colors)}\n")
    
    # Group by unique color value
    by_val = {}
    for w in warm_colors:
        c = w['color'].lower()
        by_val.setdefault(c, []).append(w)
        
    print("=== SUMMARY OF WARM / YELLOW / ORANGE / GOLD COLORS IN THE CODEBASE ===")
    for c, occurrences in sorted(by_val.items(), key=lambda x: len(x[1]), reverse=True):
        first = occurrences[0]
        # classify hue name
        h = first['h']
        if h < 25:
            family = "Red-Orange"
        elif h < 38:
            family = "Orange / Amber"
        elif h < 48:
            family = "Golden / Warm Brass"
        elif h < 55:
            family = "Yellow-Gold"
        else:
            family = "Yellow / Lime-Yellow"
        print(f"Color: {c:25} | H:{first['h']:4.1f}° S:{first['s']:4.1f}% L:{first['l']:4.1f}% | {family:20} | Count: {len(occurrences)}")
        for occ in occurrences[:3]:
            print(f"    -> {occ['file']}:{occ['line']} : {occ['text'][:90]}")
        if len(occurrences) > 3:
            print(f"       ... and {len(occurrences)-3} more")
        print()

if __name__ == '__main__':
    main()
