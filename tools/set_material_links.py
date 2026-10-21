#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Link every quiz to its material file in the "كروب الملازم" Telegram group.

The link is built from the vault's canonical catalog:

    00_STUDIO_HUB/telegram/catalog/<subject>.json  ->  ordered chapter message ids
    topic id per subject                             ->  the group's subject topic

    material_url = https://t.me/c/<chat>/<topic>/<message>

The app's chapter N maps to the Nth chapter post of that subject (the same
order the chapters were published in).

Run:  python tools/set_material_links.py [--check]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT = os.environ.get("MASTER_STUDIO", r"C:\Users\gokoq\Master-Studio")
CATALOG = os.path.join(VAULT, "00_STUDIO_HUB", "telegram", "catalog")
CHAT = "3710711332"

# app subject_id -> (catalog file, topic id)
SUBJECTS = {
    "01_Cyber_Security": ("01-Cyber-Security.json", 84),
    "02_English_Language": ("02-English-Language.json", 85),
    "03_Data_Mining": ("03-Data-Mining.json", 86),
    "04_Advanced_Software_Eng": ("04-Advanced-Software-Eng.json", 87),
    "05_Soft_Computing": ("05-Soft-Computing.json", 88),
}


def load(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def dump(path, data):
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def chapter_messages(catalog_file):
    """Ordered message ids of the published chapter posts."""
    path = os.path.join(CATALOG, catalog_file)
    if not os.path.exists(path):
        return []
    return list(load(path).get("chapters") or [])


def main():
    check = "--check" in sys.argv
    index_path = os.path.join(ROOT, "data", "index.json")
    index = load(index_path)

    links = {}
    for subject in index.get("subjects", []):
        sid = subject.get("subject_id")
        if sid not in SUBJECTS:
            continue
        catalog_file, topic = SUBJECTS[sid]
        ids = chapter_messages(catalog_file)
        for chapter in sorted(subject.get("chapters", []), key=lambda c: c.get("chapter_no", 0)):
            no = chapter.get("chapter_no", 0)
            if no - 1 < len(ids):
                links[chapter.get("quiz_id")] = "https://t.me/c/%s/%s/%s" % (CHAT, topic, ids[no - 1])

    if check:
        for quiz_id, url in links.items():
            print(quiz_id, "->", url)
        return

    changed = 0
    for subject in index.get("subjects", []):
        for chapter in subject.get("chapters", []):
            url = links.get(chapter.get("quiz_id"))
            if url and chapter.get("material_url") != url:
                chapter["material_url"] = url
                changed += 1
    if changed:
        index["version"] = int(index.get("version", 0)) + 1
        dump(index_path, index)
        print("index.json: %d chapters linked (version %s)" % (changed, index["version"]))

    banks_dir = os.path.join(ROOT, "data", "banks")
    for name in sorted(os.listdir(banks_dir)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(banks_dir, name)
        data = load(path)
        url = links.get(data.get("quiz_id"))
        if not url:
            continue
        if data.get("material_url") != url:
            data["material_url"] = url
            dump(path, data)
            print("linked: %s" % name)


if __name__ == "__main__":
    main()
