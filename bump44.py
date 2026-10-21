import io
for p, a, b in [
    ('C:/Users/gokoq/mcq-portal/sw.js', 'mcq-portal-v43', 'mcq-portal-v44'),
    ('C:/Users/gokoq/mcq-portal/js/app.js', "SHELL_VERSION = 'v43'", "SHELL_VERSION = 'v44'"),
]:
    s = io.open(p, encoding='utf-8').read().replace(a, b)
    io.open(p, 'w', encoding='utf-8').write(s)
print('v44')
