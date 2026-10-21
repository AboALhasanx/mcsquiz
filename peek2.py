import io, json
for p in ['data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_DrHuda_20MCQ.json',
          'data/banks/04_Advanced_Software_Eng_Ch01_Quiz_01_Software_Crisis.json']:
    d = json.load(io.open(p, encoding='utf-8'))
    print('==', p)
    for k in ['topic','instructor','instructor_ar','subject','source_grounding','language_mode','chapter','chapter_no','semester_label','demo']:
        v = d.get(k)
        if v is not None:
            print('  ', k, '=', (str(v)[:200]))
