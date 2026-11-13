"""Tests for source schema v3 conversion, validation, and index generation.

Covers:
- bank_kind preservation (practice vs source)
- source metadata preservation on question items
- explicit UNGRADED source items (key_status: "disputed" with answer: null)
- rejection of guessed keys on disputed source items
- rejection of missing bilingual notes on disputed items
- rejection of null keys in practice banks
- rejection of unknown bank_kind
- index preservation of bank_kind
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import portal_schema as ps


def minimal_source():
    return {'schema_version': 2, 'bank_kind': 'source', 'quiz_id': 'Quiz_Ch01_S01_Source_MCQs',
            'topic': 'Source', 'topic_ar': 'المصدر', 'questions': [{
                'id': 'q1', 'question': 'Original?', 'question_ar': 'السؤال الأصلي؟',
                'options': ['A', 'B', 'C', 'D'], 'options_en': ['A', 'B', 'C', 'D'],
                'options_ar': ['أ', 'ب', 'ج', 'د'], 'answer': 'A', 'correct': 0,
                'explanation': 'Original reason.', 'explanation_ar': 'السبب الأصلي.',
                'source': {'id': '1.1', 'reference': 'Printed source', 'key_status': 'confirmed',
                           'path': 'source.md', 'line': 1, 'note': {'ar': 'ملاحظة', 'en': 'Note'}}}]}


def test_source_substring_is_not_an_implicit_exemption():
    bank = minimal_source()
    bank.pop('bank_kind')
    bank['quiz_id'] = 'Quiz_Ch01_T01_Resource_Management'
    assert ps.to_v3(bank)['bank_kind'] == 'practice'


def test_partial_disputed_key_is_not_silently_erased():
    bank = minimal_source()
    bank['questions'][0]['source']['key_status'] = 'disputed'
    bank['questions'][0]['correct'] = None
    assert ps.validate_v3(ps.to_v3(bank))


def test_source_provenance_anchors_survive_conversion():
    q = ps.to_v3(minimal_source())['questions'][0]
    assert q['source']['path'] == 'source.md' and q['source']['line'] == 1


def test_source_requires_real_bilingual_options():
    bank = ps.to_v3(minimal_source())
    bank['questions'][0]['options'][0]['ar'] = ''
    assert any('bilingual' in err for err in ps.validate_v3(bank))


def test_practice_bank_v3_default():
    v2_bank = {
        "schema_version": 2,
        "subject_id": "04_Advanced_Software_Eng",
        "subject_title": "Advanced Software Engineering",
        "semester": 1,
        "semester_label": "Semester 1",
        "quiz_id": "Quiz_Ch01_ModelA_Concepts",
        "topic": "Concepts - Model A",
        "topic_ar": "المفاهيم - النموذج أ",
        "instructor": "Dr. Ali",
        "instructor_ar": "د. علي",
        "questions": [
            {
                "id": "q1",
                "concept_id": "ase_ch01_process",
                "bloom_level": "Understand",
                "question": "What is a software process?",
                "question_ar": "ما هي العملية البرمجية؟",
                "options": ["A set of activities", "A tool", "A database", "A compiler"],
                "options_en": ["A set of activities", "A tool", "A database", "A compiler"],
                "options_ar": ["مجموعة أنشطة", "أداة", "قاعدة بيانات", "مترجم"],
                "answer": "A",
                "correct": 0,
                "explanation": "A process is a structured set of activities.",
                "explanation_ar": "العملية هي مجموعة منظمة من الأنشطة.",
            }
        ],
    }

    v3 = ps.to_v3(v2_bank)
    assert v3["schema_version"] == 3
    assert v3["bank_kind"] == "practice"
    assert v3["questions"][0]["bank_kind"] == "practice"
    assert v3["questions"][0]["answer"] == 0
    errs = ps.validate_v3(v3)
    assert errs == []


def test_practice_bank_null_key_fails():
    v3_practice = {
        "schema_version": 3,
        "bank_kind": "practice",
        "quiz_id": "Quiz_Ch01_ModelA_Concepts",
        "topic": {"en": "Concepts", "ar": "المفاهيم"},
        "questions": [
            {
                "id": "q1",
                "bank_kind": "practice",
                "stem": {"en": "Question text?", "ar": "نص السؤال؟"},
                "options": [{"en": "A", "ar": "أ"}, {"en": "B", "ar": "ب"}, {"en": "C", "ar": "ج"}, {"en": "D", "ar": "د"}],
                "answer": None,  # Practice bank must NOT have null answer
                "explanation": {"en": "Expl", "ar": "شرح"},
            }
        ],
    }
    errs = ps.validate_v3(v3_practice)
    assert any("answer out of range" in e for e in errs)


def test_source_bank_v3_confirmed_and_derived():
    v2_source = {
        "schema_version": 2,
        "bank_kind": "source",
        "subject_id": "04_Advanced_Software_Eng",
        "subject_title": "Advanced Software Engineering",
        "semester": 1,
        "semester_label": "Semester 1",
        "quiz_id": "Quiz_Ch01_S01_Source_MCQs",
        "topic": "Source MCQs - Batch 1",
        "topic_ar": "أسئلة المصدر - الدفعة 1",
        "instructor": "Dr. Ali",
        "instructor_ar": "د. علي",
        "questions": [
            {
                "id": "q1",
                "concept_id": "ase_source_ch01_q01",
                "bloom_level": "Remember",
                "bank_kind": "source",
                "source": {
                    "id": "Q1",
                    "reference": "Exam 2023 Q1",
                    "key_status": "confirmed",
                    "note": {"ar": "مفتاح رسمي معتمد", "en": "Official confirmed key"},
                },
                "question": "Which of the following is not a software attribute?",
                "question_ar": "أي مما يلي ليس من خصائص البرمجيات؟",
                "options": ["Maintainability", "Dependability", "Efficiency", "Marketability"],
                "options_en": ["Maintainability", "Dependability", "Efficiency", "Marketability"],
                "options_ar": ["قابلية الصيانة", "الاعتمادية", "الكفاءة", "قابلية التسويق"],
                "answer": "D",
                "correct": 3,
                "explanation": "Essential attributes do not include marketability.",
                "explanation_ar": "الخصائص الأساسية لا تشمل قابلية التسويق.",
            },
            {
                "id": "q2",
                "concept_id": "ase_source_ch01_q02",
                "bloom_level": "Understand",
                "bank_kind": "source",
                "source": {
                    "id": "Q2",
                    "reference": "Slide 15",
                    "key_status": "derived",
                    "note": {"ar": "مستنتج من تعريف النموذج الشلالي", "en": "Derived from waterfall definition"},
                },
                "question": "The waterfall model is an example of:",
                "question_ar": "نموذج الشلال هو مثال على:",
                "options": ["Plan-driven process", "Agile process", "Incremental process", "Throwaway prototype"],
                "options_en": ["Plan-driven process", "Agile process", "Incremental process", "Throwaway prototype"],
                "options_ar": ["عملية موجهة بالخطة", "عملية رشيقة", "عملية تزايدية", "نموذج أولي مؤقت"],
                "answer": "A",
                "correct": 0,
                "explanation": "Waterfall is plan-driven by definition.",
                "explanation_ar": "الشلال هو نموذج موجه بالخطة بطبيعته.",
            },
        ],
    }

    v3 = ps.to_v3(v2_source)
    assert v3["bank_kind"] == "source"
    assert len(v3["questions"]) == 2
    assert v3["questions"][0]["bank_kind"] == "source"
    assert v3["questions"][0]["source"]["key_status"] == "confirmed"
    assert v3["questions"][1]["source"]["key_status"] == "derived"
    assert v3["questions"][0]["answer"] == 3
    assert v3["questions"][1]["answer"] == 0

    errs = ps.validate_v3(v3)
    assert errs == []


def test_source_bank_disputed_ungraded_success():
    v2_disputed = {
        "schema_version": 2,
        "bank_kind": "source",
        "subject_id": "04_Advanced_Software_Eng",
        "subject_title": "Advanced Software Engineering",
        "semester": 1,
        "quiz_id": "Quiz_Ch01_S01_Source_MCQs",
        "topic": "Source Batch",
        "topic_ar": "دفعة المصدر",
        "questions": [
            {
                "id": "q1",
                "concept_id": "ase_source_ch01_q01",
                "bank_kind": "source",
                "source": {
                    "id": "Q1",
                    "reference": "Original Handout Q4",
                    "key_status": "disputed",
                    "note": {
                        "ar": "السؤال يحتمل إجابتين A و C بسبب غموض الصياغة الأصلية",
                        "en": "Question admits both A and C due to ambiguous source wording",
                    },
                },
                "question": "Ambiguous stem wording from source?",
                "question_ar": "نص السؤال الغامض من المصدر؟",
                "options": ["Choice A", "Choice B", "Choice C", "Choice D"],
                "options_en": ["Choice A", "Choice B", "Choice C", "Choice D"],
                "options_ar": ["خيار أ", "خيار ب", "خيار ج", "خيار د"],
                "answer": None,
                "correct": None,
                "explanation": "Both A and C could be valid depending on interpretation.",
                "explanation_ar": "كلا الخيارين أ و ج يمكن اعتبارهما صحيحين حسب التفسير.",
            }
        ],
    }

    v3 = ps.to_v3(v2_disputed)
    assert v3["bank_kind"] == "source"
    assert v3["questions"][0]["answer"] is None  # preserved as null!
    assert v3["questions"][0]["source"]["key_status"] == "disputed"

    errs = ps.validate_v3(v3)
    assert errs == []


def test_source_bank_disputed_with_guessed_key_fails():
    v3_bad_disputed = {
        "schema_version": 3,
        "bank_kind": "source",
        "quiz_id": "Quiz_Ch01_S01_Source_MCQs",
        "topic": {"en": "Source", "ar": "المصدر"},
        "questions": [
            {
                "id": "q1",
                "bank_kind": "source",
                "source": {
                    "id": "Q1",
                    "reference": "Ref",
                    "key_status": "disputed",
                    "note": {"ar": "شرح الغموض", "en": "Explaining ambiguity"},
                },
                "stem": {"en": "Ambiguous stem?", "ar": "نص غامض؟"},
                "options": [{"en": "A", "ar": "أ"}, {"en": "B", "ar": "ب"}, {"en": "C", "ar": "ج"}, {"en": "D", "ar": "د"}],
                "answer": 2,  # FORBIDDEN: Cannot guess key for disputed item!
                "explanation": {"en": "Expl", "ar": "شرح"},
            }
        ],
    }
    errs = ps.validate_v3(v3_bad_disputed)
    assert any("disputed source item must have answer: null" in e for e in errs)


def test_source_bank_disputed_missing_bilingual_note_fails():
    v3_missing_note = {
        "schema_version": 3,
        "bank_kind": "source",
        "quiz_id": "Quiz_Ch01_S01_Source_MCQs",
        "topic": {"en": "Source", "ar": "المصدر"},
        "questions": [
            {
                "id": "q1",
                "bank_kind": "source",
                "source": {
                    "id": "Q1",
                    "reference": "Ref",
                    "key_status": "disputed",
                    "note": {"ar": "", "en": "English only note"},  # Missing Arabic note
                },
                "stem": {"en": "Ambiguous stem?", "ar": "نص غامض؟"},
                "options": [{"en": "A", "ar": "أ"}, {"en": "B", "ar": "ب"}, {"en": "C", "ar": "ج"}, {"en": "D", "ar": "د"}],
                "answer": None,
                "explanation": {"en": "Expl", "ar": "شرح"},
            }
        ],
    }
    errs = ps.validate_v3(v3_missing_note)
    assert any("disputed source item requires nonempty bilingual source.note" in e for e in errs)


def test_unknown_bank_kind_fails():
    v3_unknown = {
        "schema_version": 3,
        "bank_kind": "custom_exam",
        "quiz_id": "Quiz_Ch01_Unknown",
        "topic": {"en": "Topic", "ar": "موضوع"},
        "questions": [
            {
                "id": "q1",
                "stem": {"en": "Stem?", "ar": "سؤال؟"},
                "options": [{"en": "A", "ar": "أ"}, {"en": "B", "ar": "ب"}, {"en": "C", "ar": "ج"}, {"en": "D", "ar": "د"}],
                "answer": 0,
                "explanation": {"en": "Expl", "ar": "شرح"},
            }
        ],
    }
    errs = ps.validate_v3(v3_unknown)
    assert any("invalid bank_kind" in e for e in errs)


def test_build_index_preserves_bank_kind():
    prev = {"version": 1, "subjects": []}
    banks = {
        "Quiz_Ch01_ModelA": {
            "quiz_id": "Quiz_Ch01_ModelA",
            "bank_kind": "practice",
            "subject_id": "04_Advanced_Software_Eng",
            "questions": [{}],
            "topic": {"en": "Practice A", "ar": "تدريب أ"},
        },
        "Quiz_Ch01_S01_Source_MCQs": {
            "quiz_id": "Quiz_Ch01_S01_Source_MCQs",
            "bank_kind": "source",
            "subject_id": "04_Advanced_Software_Eng",
            "questions": [{}, {}],
            "topic": {"en": "Source 1", "ar": "مصدر 1"},
        },
    }
    meta = {
        "Quiz_Ch01_ModelA": {"chapter_no": 1, "bank_kind": "practice"},
        "Quiz_Ch01_S01_Source_MCQs": {"chapter_no": 1, "bank_kind": "source"},
    }
    idx = ps.build_index(prev, banks, meta)
    chaps = idx["subjects"][0]["chapters"]
    assert len(chaps) == 2
    c_map = {c["quiz_id"]: c["bank_kind"] for c in chaps}
    assert c_map["Quiz_Ch01_ModelA"] == "practice"
    assert c_map["Quiz_Ch01_S01_Source_MCQs"] == "source"


if __name__ == '__main__':
    from common import suite, check, report
    suite('source_schema')
    for name, test in list(globals().items()):
        if name.startswith('test_') and callable(test):
            try:
                test()
                check(name, True)
            except Exception as exc:
                check(name, False, repr(exc))
    sys.exit(report())
