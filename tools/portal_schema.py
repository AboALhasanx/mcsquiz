#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Canonical Schema v3 for the portal banks (one bilingual shape, no aliases).

v2 (the vault's canonical shape and the older portal banks) used three names
for the same thing: `text` + `question` + `question_ar/question_en`,
`options` + `options_ar/options_en`, `explanation` + `explanation_ar/_en`.
That is why the banks drifted apart.

v3 keeps exactly one name per thing and makes the language pair explicit:

    topic:      { "ar": "...", "en": "..." }
    stem:       { "ar": "...", "en": "..." }
    options:    [ { "ar": "...", "en": "..." }, ... 4 ]
    answer:     0
    explanation:{ "ar": "...", "en": "..." }

Math is written as LaTeX between $...$ (inline) or $$...$$ (display) inside any
of those strings, so a question can mix Arabic prose, English terms and
formulas in one line. The portal renders it with KaTeX.

This module is the single place that knows how to read v2 and write v3; the
publish tool and the app's loader both use it.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

SCHEMA_VERSION = 3

AR_RE = re.compile(r"[\u0600-\u06FF]")
MATH_RE = re.compile(r"\$\$[\s\S]+?\$\$|\$[^$\n]+?\$")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def has_arabic(text) -> bool:
    return bool(AR_RE.search(str(text or "")))


def pick_ar(*candidates) -> str:
    """The first candidate that really is Arabic."""
    for c in candidates:
        if isinstance(c, str) and c.strip() and has_arabic(c):
            return c
    for c in candidates:
        if isinstance(c, str) and c.strip():
            return c
    return ""


def pick_en(*candidates) -> str:
    """The first candidate that really is not Arabic."""
    for c in candidates:
        if isinstance(c, str) and c.strip() and not has_arabic(c):
            return c
    for c in candidates:
        if isinstance(c, str) and c.strip():
            return c
    return ""


def pick_opts_ar(*arrays):
    for arr in arrays:
        if isinstance(arr, list) and arr and has_arabic(arr[0]):
            return list(arr)
    for arr in arrays:
        if isinstance(arr, list) and arr:
            return list(arr)
    return []


def pick_opts_en(*arrays):
    for arr in arrays:
        if isinstance(arr, list) and arr and not has_arabic(arr[0]):
            return list(arr)
    for arr in arrays:
        if isinstance(arr, list) and arr:
            return list(arr)
    return []


def has_math(text) -> bool:
    return bool(MATH_RE.search(str(text or "")))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# --------------------------------------------------------------------------- #
# conversion
# --------------------------------------------------------------------------- #
def to_v3(bank: dict) -> dict:
    """Read any known bank shape and return a clean v3 bank."""
    if not isinstance(bank, dict):
        raise ValueError("bank is not an object")
    en_only = str(bank.get("lang") or "").lower() == "en"
    bank_kind = bank.get("bank_kind", "practice")

    if bank.get("schema_version") == SCHEMA_VERSION and isinstance(bank.get("questions"), list):
        # still normalise the pairs, the file may have been hand-edited
        out = dict(bank)
        out["bank_kind"] = bank_kind
    else:
        out = {
            "schema_version": SCHEMA_VERSION,
            "bank_kind": bank_kind,
            "subject_id": bank.get("subject_id") or bank.get("subject") or "",
            "subject_title": bank.get("subject_title") or "",
            "semester": bank.get("semester", 1),
            "semester_label": bank.get("semester_label") or "",
            "quiz_id": bank.get("quiz_id") or "",
            "instructor": {
                "ar": bank.get("instructor_ar") or "",
                "en": bank.get("instructor") or "",
            },
            "questions": [],
        }
        out["topic"] = {
            "ar": pick_ar(bank.get("topic_ar"), bank.get("topic")),
            "en": pick_en(bank.get("topic"), bank.get("topic_en")),
        }
        for q in bank.get("questions") or []:
            out["questions"].append(_q_to_v3(q, en_only, default_bank_kind=bank_kind))

    # topic + instructor may be plain strings in a v3 file
    if isinstance(out.get("topic"), str):
        out["topic"] = {"ar": out["topic"], "en": ""}
    if isinstance(out.get("instructor"), str):
        out["instructor"] = {"ar": out["instructor"], "en": ""}

    out["schema_version"] = SCHEMA_VERSION
    out["bank_kind"] = bank_kind
    if bank.get("source_manifest"):
        out["source_manifest"] = bank["source_manifest"]
    out.setdefault("updated_at", now_iso())
    out["has_math"] = any(
        has_math(t) for q in out["questions"]
        for t in _all_text(q)
    )
    return out


def _q_to_v3(q: dict, en_only: bool = False, default_bank_kind: str = "practice") -> dict:
    if en_only:
        # Single-language bank: do not copy English into the Arabic slot.
        opts_ar = q.get("options_ar") if isinstance(q.get("options_ar"), list) else []
    else:
        opts_ar = pick_opts_ar(q.get("options_ar"), q.get("options"))
    opts_en = pick_opts_en(q.get("options_en"), q.get("options"))
    options = []
    for i in range(max(len(opts_ar), len(opts_en))):
        ar = opts_ar[i] if i < len(opts_ar) else ""
        en = opts_en[i] if i < len(opts_en) else ""
        options.append({"ar": ar, "en": en})
    while len(options) < 4:
        options.append({"ar": "", "en": ""})

    q_kind = q.get("bank_kind", default_bank_kind)

    source_raw = q.get("source")
    source_obj = None
    is_disputed = False
    if isinstance(source_raw, dict):
        k_status = source_raw.get("key_status")
        is_disputed = (k_status == "disputed")
        note_raw = source_raw.get("note") if isinstance(source_raw.get("note"), dict) else {}
        source_obj = dict(source_raw)
        source_obj.update({
            "id": str(source_raw.get("id") or "").strip(),
            "reference": str(source_raw.get("reference") or "").strip(),
            "key_status": k_status,
            "note": {
                "ar": str(note_raw.get("ar") or "").strip(),
                "en": str(note_raw.get("en") or "").strip(),
            },
        })
    elif q_kind == "source":
        source_obj = {
            "id": str(q.get("id") or "").strip(),
            "reference": "",
            "key_status": "confirmed",
            "note": {"ar": "", "en": ""},
        }

    raw_ans = q.get("answer")
    raw_corr = q.get("correct")

    if q_kind == "source" and is_disputed and raw_ans is None and raw_corr is None:
        correct = None
    else:
        if raw_ans in (None, "") or isinstance(raw_ans, bool) or isinstance(raw_corr, bool):
            correct = -1
        elif isinstance(raw_ans, str) and len(raw_ans) == 1 and raw_ans.upper() in "ABCD":
            correct = "ABCD".index(raw_ans.upper())
        else:
            correct = raw_corr
            if correct is None:
                correct = -1
        try:
            correct = int(correct)
        except (TypeError, ValueError):
            correct = -1

    res = {
        "id": q.get("id") or "",
        "concept_id": q.get("concept_id") or "",
        "bloom": q.get("bloom") or q.get("bloom_level") or "",
        "bank_kind": q_kind,
        "stem": {
            "ar": (q.get("question_ar") or "") if en_only else pick_ar(q.get("question_ar"), q.get("text"), q.get("question")),
            "en": pick_en(q.get("question_en"), q.get("text_en"), q.get("question")),
        },
        "options": options,
        "answer": correct,
        "explanation": {
            "ar": (q.get("explanation_ar") or "") if en_only else pick_ar(q.get("explanation_ar"), q.get("explanation")),
            "en": pick_en(q.get("explanation_en"), q.get("explanation")),
        },
    }
    if source_obj is not None:
        res["source"] = source_obj
    return res


def _all_text(q: dict):
    for key in ("ar", "en"):
        yield (q.get("stem") or {}).get(key, "")
        yield (q.get("explanation") or {}).get(key, "")
        for opt in q.get("options") or []:
            yield opt.get(key, "")


# --------------------------------------------------------------------------- #
# validation
# --------------------------------------------------------------------------- #
def validate_v3(bank: dict, check_publish: bool = False) -> list:
    """Return a list of problems (empty = good)."""
    errs = []
    if bank.get("schema_version") != SCHEMA_VERSION:
        errs.append("schema_version != %d" % SCHEMA_VERSION)
    if not bank.get("quiz_id"):
        errs.append("no quiz_id")
    bank_kind = bank.get("bank_kind", "practice")
    if bank_kind not in ("practice", "source"):
        errs.append("invalid bank_kind: %r (expected 'practice' or 'source')" % bank_kind)
    topic = bank.get("topic") or {}
    if not (topic.get("ar") or topic.get("en")):
        errs.append("no topic")
    questions = bank.get("questions") or []
    if not questions:
        errs.append("no questions")
    for q in questions:
        qid = q.get("id") or "?"
        if not q.get("id"):
            errs.append("question without id")
        q_kind = q.get("bank_kind", bank_kind)
        if q_kind not in ("practice", "source"):
            errs.append("%s:invalid bank_kind %r" % (qid, q_kind))
        if q_kind != bank_kind:
            errs.append("%s:question bank_kind mismatch" % qid)
        if bank_kind == "source":
            src = q.get("source")
            if not isinstance(src, dict):
                errs.append("%s:missing source metadata for source question" % qid)
            else:
                if not src.get("id"):
                    errs.append("%s:source metadata missing 'id'" % qid)
                if not src.get("reference"):
                    errs.append("%s:source metadata missing 'reference'" % qid)
                k_status = src.get("key_status")
                if k_status not in ("confirmed", "derived", "disputed"):
                    errs.append("%s:invalid source key_status %r" % (qid, k_status))
                note = src.get("note")
                if not isinstance(note, dict) or "ar" not in note or "en" not in note:
                    errs.append("%s:source metadata 'note' must have 'ar' and 'en'" % qid)

                if k_status == "disputed":
                    if "answer" not in q or q.get("answer") is not None:
                        errs.append("%s:disputed source item must have answer: null (ungraded), got %r" % (qid, q.get("answer")))
                    if not (isinstance(note, dict) and note.get("ar") and note.get("en")):
                        errs.append("%s:disputed source item requires nonempty bilingual source.note explaining ambiguity" % qid)
                else:
                    if type(q.get("answer")) is not int or not (0 <= q.get("answer", -1) <= 3):
                        errs.append("%s:confirmed/derived source item requires integer answer 0..3, got %r" % (qid, q.get("answer")))
        else:
            if type(q.get("answer")) is not int or not (0 <= q.get("answer", -1) <= 3):
                errs.append("%s:answer out of range" % qid)

        stem = q.get("stem") or {}
        if not (stem.get("ar") or stem.get("en")):
            errs.append("%s:no stem" % qid)
        if bank_kind == "source" and not (str(stem.get("ar") or "").strip() and str(stem.get("en") or "").strip()):
            errs.append("%s:source stem must be bilingual" % qid)
        opts = q.get("options") or []
        if len(opts) != 4:
            errs.append("%s:options=%d" % (qid, len(opts)))
        for i, o in enumerate(opts):
            if not (o.get("ar") or o.get("en")):
                errs.append("%s:option %d empty" % (qid, i))
            if bank_kind == "source" and not (str(o.get("ar") or "").strip() and str(o.get("en") or "").strip()):
                errs.append("%s:source option %d must be bilingual" % (qid, i))
        expl = q.get("explanation") or {}
        if not (expl.get("ar") or expl.get("en")):
            errs.append("%s:no explanation" % qid)
        if bank_kind == "source" and not (str(expl.get("ar") or "").strip() and str(expl.get("en") or "").strip()):
            errs.append("%s:source explanation must be bilingual" % qid)
        for text in _all_text(q):
            for m in MATH_RE.finditer(text or ""):
                src = m.group(0)
                if not check_math(src):
                    errs.append("%s:bad formula %s" % (qid, src[:40]))
    return errs


def check_math(src: str) -> bool:
    """Is the LaTeX inside $...$ / $$...$$ parseable? (best effort, no node)"""
    body = src.strip()
    if body.startswith("$$") and body.endswith("$$"):
        body = body[2:-2]
    elif body.startswith("$") and body.endswith("$"):
        body = body[1:-1]
    body = body.strip()
    if not body:
        return False
    # Arabic belongs outside the math (it would be rendered as symbols)
    if AR_RE.search(body):
        return False
    # balanced braces
    depth = 0
    for ch in body:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0:
                return False
    if depth != 0:
        return False
    # a real formula: a command, an operator, or sub/superscript
    # any LaTeX command or escaped symbol (\frac, \%, \Rightarrow ...)
    if re.search(r"\\|[\^_{}=+\-*/<>|]", body):
        return True
    # a bare variable or number is valid too ($A$, $80$, $x$)
    if re.fullmatch(r"[A-Za-z0-9.,%()\[\]\s]+", body) and len(body.split()) <= 3:
        return True
    return False


# --------------------------------------------------------------------------- #
# index
# --------------------------------------------------------------------------- #
def build_index(previous: dict, banks: dict, chapter_meta: dict) -> dict:
    """Rebuild data/index.json from the published banks.

    `banks` maps quiz_id -> the v3 bank (this may be one subject only; the
    subjects that were not published keep their previous chapters as they are).

    `chapter_meta` maps quiz_id -> {subject_id, subject_title, chapter_no, bank}
    """
    # start from what is already published, so a one-subject publish never
    # drops the other subjects
    subjects = {}
    for sub in previous.get("subjects", []):
        kept = dict(sub)
        kept["chapters"] = [ch for ch in sub.get("chapters", [])
                            if ch.get("quiz_id") not in banks]
        if kept["chapters"]:
            subjects[sub.get("subject_id")] = kept
    for quiz_id, bank in banks.items():
        meta = chapter_meta.get(quiz_id) or {}
        sid = meta.get("subject_id") or bank.get("subject_id") or "00"
        subj = subjects.setdefault(sid, {
            "subject_id": sid,
            "subject_title": meta.get("subject_title") or bank.get("subject_title") or sid,
            "chapters": [],
        })
        topic = bank.get("topic") or {}
        b_kind = meta.get("bank_kind") or bank.get("bank_kind") or "practice"
        subj["chapters"].append({
            "chapter_no": meta.get("chapter_no", 1),
            "quiz_id": quiz_id,
            "bank_kind": b_kind,
            "bank": meta.get("bank") or ("banks/%s.json" % quiz_id),
            "topic": topic,
            "count": len(bank.get("questions") or []),
            "version": int(bank.get("version") or 1),
            "updated_at": bank.get("updated_at") or now_iso(),
            "has_math": bool(bank.get("has_math")),
            "material_url": bank.get("material_url") or meta.get("material_url") or "",
        })
    for subj in subjects.values():
        subj["chapters"].sort(key=lambda c: c.get("chapter_no", 0))

    # the version only moves when the content really changed
    def signature(idx):
        parts = []
        for subj in idx.get("subjects", []):
            for ch in subj.get("chapters", []):
                parts.append((subj.get("subject_id"), ch.get("quiz_id"),
                              ch.get("version"), ch.get("count"),
                              ch.get("bank_kind", "practice")))
        return sorted(parts)

    changed = signature(previous) != signature({"subjects": list(subjects.values())})
    version = int(previous.get("version") or 0)
    if changed or not version:
        version += 1
    index = {
        "portal": previous.get("portal") or "MCQ Portal",
        "test_mode": bool(previous.get("test_mode")),
        "version": version,
        "updated_at": (now_iso() if changed else previous.get("updated_at") or now_iso()),
        "subjects": list(subjects.values()),
    }
    return index


def write_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
