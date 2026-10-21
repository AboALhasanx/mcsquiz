#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Give every bank a clean Arabic topic title (the finest unit in the hierarchy:
subject -> chapter -> topic) and mirror it in data/index.json.

The English `topic` field is left untouched: the pipeline tools
(normalize_banks.py / apply_translations.py) treat it as the canonical raw
label, and the UI falls back to a cleaned version of it when topic_ar is
missing.
"""
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TOPIC_AR = {
    "01_Cyber_Security_Ch01_Quiz_Ch01_DrHuda_20MCQ.json": "مقدمة في الأمن السيبراني",
    "01_Cyber_Security_Ch02_Quiz_Ch02_DrHuda_20MCQ.json": "مخاطر وتهديدات الأمن السيبراني",
    "01_Cyber_Security_Ch03_Quiz_01_Cybersecurity_Foundations.json": "أسس الأمن السيبراني: ثلاثية CIA وتقييم المخاطر",
    "01_Cyber_Security_Ch04_Quiz_02_Risk_Assessment.json": "مخاطر الأمن السيبراني: التهديدات وإجراءات الحماية وإدارة المخاطر",
    "02_English_Language_Ch01_Quiz_01_Grammar_and_Tenses.json": "نظام الأزمنة الإنجليزي: الأفعال الزمنية والتسجيل الأكاديمي",
    "03_Data_Mining_Ch01_Quiz_01_Introduction_to_Data_Mining.json": "مقدمة في التنقيب عن البيانات",
    "04_Advanced_Software_Eng_Ch01_Quiz_01_Software_Crisis.json": "أسس هندسة البرمجيات: فشل الباتريوت وتعقيد بروكس والأخلاقيات",
    "04_Advanced_Software_Eng_Ch02_Quiz_02_Patriot_Brooks.json": "انحراف الباتريوت والتعقيد الجوهري لبروكس",
    "05_Soft_Computing_Ch01_Quiz_01_Software_Crisis.json": "",
    "05_Soft_Computing_Ch01_Quiz_01_Soft_Computing_Foundations.json": "مقدمة في الحوسبة الناعمة: الأعصاب البيولوجية والمنطق الغامض",
    "05_Soft_Computing_Ch02_Quiz_02_Fuzzy_Logic_Systems.json": "أنظمة المنطق الغامض: المجموعات الغامضة وقوانين المجموعات الكلاسيكية والتمثيل",
}


def dump(path, data):
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def main():
    banks_dir = os.path.join(ROOT, "data", "banks")
    by_quiz = {}
    for name in sorted(os.listdir(banks_dir)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(banks_dir, name)
        with io.open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        ar = TOPIC_AR.get(name, "")
        if not ar:
            print("  skip (no mapping): " + name)
            continue
        if data.get("topic_ar") == ar:
            print("  unchanged: " + name)
        else:
            data["topic_ar"] = ar
            dump(path, data)
            print("  topic_ar set: " + name)
        by_quiz[data.get("quiz_id")] = ar

    index_path = os.path.join(ROOT, "data", "index.json")
    with io.open(index_path, encoding="utf-8") as fh:
        index = json.load(fh)
    changed = False
    for subject in index.get("subjects", []):
        for chapter in subject.get("chapters", []):
            ar = by_quiz.get(chapter.get("quiz_id"))
            if ar and chapter.get("topic_ar") != ar:
                chapter["topic_ar"] = ar
                changed = True
                print("  index topic_ar: " + chapter.get("quiz_id", "?"))
    if changed:
        index["version"] = int(index.get("version", 0)) + 1
        dump(index_path, index)
        print("  index.json updated (version %s)" % index["version"])


if __name__ == "__main__":
    main()
