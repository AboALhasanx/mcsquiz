import io, json
p = 'data/banks/01_Cyber_Security_Ch01_Quiz_Ch01_DrHuda_20MCQ.json'
d = json.load(io.open(p, encoding='utf-8'))
print(list(d.keys()))
for k, v in d.items():
    if k != 'questions':
        print(k, '=', repr(v)[:160])
