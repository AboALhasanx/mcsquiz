# tests/test_search.py
# Phase 2: In-Portal Comprehensive Search Engine Tests.
# Tests Arabic normalization, tokenization, AND-matching, prefix matching, ranking weights, and result limits.
# Written RED-first: fails before js/search.js exists, passes after implementation.
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import check


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True)
    try:
        ev = page.evaluate

        # 1. Module presence
        has_module = ev("() => Boolean(window.PortalSearch)")
        check("PortalSearch module is registered on window", has_module)
        if not has_module:
            return

        # 2. Arabic & English text normalization
        # Tests: diacritics removal, tatweel removal, alef normalization, ya/alef maqsura, taa marbuta, numbers
        norm1 = ev("() => PortalSearch.normalize('السَّلَامُ عَلَيْكُمْ')")
        check("normalize strips Arabic tashkeel/diacritics", norm1 == "السلام عليكم")

        norm2 = ev("() => PortalSearch.normalize('مــــركــــز')")
        check("normalize strips Arabic tatweel/kashida", norm2 == "مركز")

        norm3 = ev("() => PortalSearch.normalize('أحمد وإبراهيم مع آمنة والٱستثمار')")
        check("normalize unifies Alef variants (أ إ آ ٱ -> ا)", norm3 == "احمد وابراهيم مع امنه والاستثمار")

        norm4 = ev("() => PortalSearch.normalize('مستشفى ومستشفي والتقنية والتقنيه')")
        check("normalize unifies ya/alef-maqsura (ى->ي) and taa marbuta (ة->ه)", norm4 == "مستشفي ومستشفي والتقنيه والتقنيه")

        norm5 = ev("() => PortalSearch.normalize('IPv٤ و ١٢٣٤٥')")
        check("normalize converts Eastern Arabic numerals to standard Latin digits", norm5 == "ipv4 و 12345")

        norm6 = ev("() => PortalSearch.normalize('Firewall & IDS / IPS')")
        check("normalize lowercases English text and trims spaces", norm6 == "firewall & ids / ips")

        # 3. Tokenizer
        tokens = ev("() => PortalSearch.tokenize('الأمن السيبراني: جدار الحماية (Firewall) 2026')")
        check("tokenize splits into clean distinct normalized words",
              "الامن" in tokens and "السيبراني" in tokens and "الحمايه" in tokens and "firewall" in tokens and "2026" in tokens)

        # 4. Mock Questions Indexing & Searching
        mock_banks = {
            "quiz_sec_01": {
                "topic": "مقدمة الأمن والشبكات",
                "questions": [
                    {
                        "id": "q1",
                        "stem": {"ar": "ما هو جدار الحماية في الشبكات؟", "en": "What is a network firewall?"},
                        "options": [
                            {"ar": "نظام أمني لمراقبة حركة المرور", "en": "Security system to monitor traffic"},
                            {"ar": "برنامج لتحرير النصوص", "en": "Text editor"},
                            {"ar": "أداة لتشغيل الفيديو", "en": "Video player"},
                            {"ar": "لوحة مفاتيح حاسوبية", "en": "Computer keyboard"}
                        ],
                        "correct": 0,
                        "explanation": {"ar": "جدار الحماية يتحكم في الحزم الداخلة والخارجة.", "en": "A firewall controls incoming and outgoing packets."}
                    },
                    {
                        "id": "q2",
                        "stem": {"ar": "كيف يعمل نظام كشف التسلل IDS؟", "en": "How does an Intrusion Detection System work?"},
                        "options": [
                            {"ar": "مراقبة الأنشطة المشبوهة وإرسال تنبيهات", "en": "Monitors suspicious activities and sends alerts"},
                            {"ar": "حذف جميع الملفات التالفة", "en": "Deletes corrupt files"},
                            {"ar": "تسريع اتصال الإنترنت", "en": "Boosts internet speed"},
                            {"ar": "ضغط البيانات وقواعد البيانات", "en": "Compresses database records"}
                        ],
                        "correct": 0,
                        "explanation": {"ar": "نظام IDS يكتشف التهديدات بدون حظر تلقائي.", "en": "IDS detects threats without active inline blocking."}
                    },
                    {
                        "id": "q3",
                        "stem": {"ar": "ما هي الفروقات بين خوارزميات التشفير المتماثل وغير المتماثل؟", "en": "What are symmetric and asymmetric encryption?"},
                        "options": [
                            {"ar": "استخدام مفتاح واحد مقابل زوج من المفاتيح", "en": "Single key vs pair of keys"},
                            {"ar": "سرعة المعالج فقط", "en": "Processor speed only"},
                            {"ar": "حجم الشاشة", "en": "Screen size"},
                            {"ar": "نوع كابل الشبكة", "en": "Network cable type"}
                        ],
                        "correct": 0,
                        "explanation": {"ar": "التشفير المتماثل أسرع ولكن يحتاج لتوزيع آمن للمفتاح.", "en": "Symmetric encryption is faster but requires key exchange."}
                    }
                ]
            }
        }
        mock_index = {
            "subjects": [
                {
                    "subject_id": "sec",
                    "subject_title": "أمن المعلومات",
                    "chapters": [
                        {"chapter_no": 1, "quiz_id": "quiz_sec_01", "topicLabel": "موضوع 1"}
                    ]
                }
            ]
        }

        # Build search index
        ev("""(args) => {
            PortalSearch.buildIndex(args.index, args.banks);
        }""", {"index": mock_index, "banks": mock_banks})

        is_indexed = ev("() => PortalSearch.isReady()")
        check("PortalSearch builds index successfully and is ready", is_indexed)

        # 5. Search by Arabic keyword (with diacritics / alef variations in query)
        res1 = ev("() => PortalSearch.query('جِدار الحِمايَة')")
        check("Search finds exact and normalized Arabic matches", len(res1) == 1 and res1[0]["q"]["id"] == "q1")

        # 6. Prefix matching: 'حماي' should match 'الحماية'
        res_prefix = ev("() => PortalSearch.query('حماي')")
        check("Search supports prefix matching for Arabic words", len(res_prefix) >= 1 and res_prefix[0]["q"]["id"] == "q1")

        # 7. English search
        res2 = ev("() => PortalSearch.query('firewall')")
        check("Search matches English terms cleanly", len(res2) == 1 and res2[0]["q"]["id"] == "q1")

        # 8. AND semantics: multiple terms must all match
        res_and = ev("() => PortalSearch.query('جدار مفاتيح')")
        check("AND semantics: returns empty if not all words match the question", len(res_and) == 0)

        res_and2 = ev("() => PortalSearch.query('جدار مرور')")
        check("AND semantics: matches when one word is in stem and another in option", len(res_and2) == 1 and res_and2[0]["q"]["id"] == "q1")

        # 9. Search ranking: concept > stem > option > explanation
        # Query 'نظام':
        # q2 has 'نظام' in stem ("نظام كشف التسلل")
        # q1 has 'نظام' only in option ("نظام أمني لمراقبة حركة المرور")
        res_rank = ev("() => PortalSearch.query('نظام')")
        check("Stem match ranks higher than option match", len(res_rank) >= 2 and res_rank[0]["q"]["id"] == "q2")

        # 10. Filter by subject
        res_sub = ev("() => PortalSearch.query('جدار', { subjectId: 'sec' })")
        res_sub_other = ev("() => PortalSearch.query('جدار', { subjectId: 'other' })")
        check("Subject filter restricts search results to chosen subject", len(res_sub) == 1 and len(res_sub_other) == 0)

        # 11. Results limit capping at 50
        # Build 60 synthetic items
        ev("""() => {
            const bigBanks = {
                'quiz_big': {
                    topic: 'بنك كبير',
                    questions: Array.from({ length: 60 }, (_, i) => ({
                        id: 'big_' + i,
                        stem: { ar: 'سؤال تجريبي مكرر رقم ' + i, en: 'Test question ' + i },
                        options: [{ ar: 'خيار أ', en: 'A' }, { ar: 'خيار ب', en: 'B' }],
                        correct: 0,
                        explanation: { ar: 'شرح اختباري', en: 'Test expl' }
                    }))
                }
            };
            const bigIndex = {
                subjects: [{
                    subject_id: 'big',
                    subject_title: 'مادة كبيرة',
                    chapters: [{ chapter_no: 1, quiz_id: 'quiz_big', topicLabel: 'موضوع 1' }]
                }]
            };
            PortalSearch.buildIndex(bigIndex, bigBanks);
        }""")
        res_capped = ev("() => PortalSearch.query('تجريبي')")
        check("Search results are capped at maximum 50 items", len(res_capped) == 50)

        # 12. Question origin metadata attached to results
        q0 = res_capped[0]
        check("Search result contains full origin metadata for launchSession",
              bool(q0.get("origin") and q0["origin"].get("subjectId") == "big" and q0["origin"].get("chapterNo") == 1))

    finally:
        browser.close()
        pw.stop()


if __name__ == "__main__":
    run()
