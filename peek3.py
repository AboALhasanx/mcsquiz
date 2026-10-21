import io, json, glob
for p in sorted(glob.glob('data/banks/*.json')):
    d = json.load(io.open(p, encoding='utf-8'))
    print('==', p.split('/')[-1])
    for k in ['topic','topic_ar','chapter','chapter_no','instructor_ar','semester_label','difficulty','_difficulty_distribution','questions']:
        v = d.get(k)
        if k == 'questions':
            v = len(v)
        if v is not None:
            print('   ', k, '=', str(v)[:220])
