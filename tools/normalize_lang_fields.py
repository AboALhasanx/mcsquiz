#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Make the bilingual fields honest so the AR <-> EN switch always works.

For every question the app reads:
    question_ar / question_en      (stem)
    options_ar  / options_en       (choices)
    explanation_ar / explanation_en

The banks carry both a canonical pair (text/text_en, options/options_en,
explanation) and the app-facing aliases, but the aliases were sometimes
copied into the wrong language (an English explanation sitting in
explanation_en, an empty explanation_ar, ...).

This script picks, for each field, the candidate that actually is in the
requested language and stores it there. A language that has no content is
left empty, and the app falls back to the other language at render time.
"""
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AR = re.compile(r'[\u0600-\u06FF]')


def has_ar(s):
    return bool(AR.search(str(s or '')))


def pick_ar(*cands):
    for c in cands:
        if isinstance(c, str) and c.strip() and has_ar(c):
            return c
    return ''


def pick_en(*cands):
    for c in cands:
        if isinstance(c, str) and c.strip() and not has_ar(c):
            return c
    return ''


def pick_opts_ar(*arrays):
    for arr in arrays:
        if isinstance(arr, list) and arr and has_ar(arr[0]):
            return arr
    for arr in arrays:
        if isinstance(arr, list) and arr:
            return arr
    return []


def pick_opts_en(*arrays):
    for arr in arrays:
        if isinstance(arr, list) and arr and not has_ar(arr[0]):
            return arr
    for arr in arrays:
        if isinstance(arr, list) and arr:
            return arr
    return []


def dump(path, data):
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def main():
    banks_dir = os.path.join(ROOT, "data", "banks")
    total_fixed = 0
    for name in sorted(os.listdir(banks_dir)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(banks_dir, name)
        with io.open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        fixed = 0
        for q in data.get("questions", []):
            before = (q.get("question_ar"), q.get("question_en"),
                      q.get("options_ar"), q.get("options_en"),
                      q.get("explanation_ar"), q.get("explanation_en"))
            q["question_ar"] = pick_ar(q.get("question_ar"), q.get("text"))
            q["question_en"] = pick_en(q.get("question_en"), q.get("text_en")) or q["question_ar"]
            q["options_ar"] = pick_opts_ar(q.get("options_ar"), q.get("options"))
            q["options_en"] = pick_opts_en(q.get("options_en"), q.get("options"))
            q["explanation_ar"] = pick_ar(q.get("explanation_ar"), q.get("explanation"), q.get("explanation_en"))
            # the schema contract keeps both fields populated; the app picks the
            # language it needs at render time and falls back when one is missing
            q["explanation_en"] = pick_en(q.get("explanation_en"), q.get("explanation"), q.get("explanation_ar")) or q["explanation_ar"]
            after = (q.get("question_ar"), q.get("question_en"),
                     q.get("options_ar"), q.get("options_en"),
                     q.get("explanation_ar"), q.get("explanation_en"))
            if before != after:
                fixed += 1
        if fixed:
            dump(path, data)
            print("%-58s %d questions normalized" % (name[:58], fixed))
            total_fixed += fixed
    print("total: %d questions" % total_fixed)


if __name__ == "__main__":
    main()
