import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
b, p, e = common.new_page(pw, tour_done=True, telegram=None)
try:
    out = p.evaluate("""async () => {
      const sb = await window.PortalCloud.sb();
      const h = 'dbg977070';
      const r = await sb.rpc('portal_login', { p_handle: h, p_name: 'طالب' });
      const r2 = await sb.from('portal_users').select('id,handle').eq('handle', h);
      return { err: r.error && (r.error.message + ' | ' + r.error.code + ' | ' + r.error.details), data: r.data, rows: r2.data, rowsErr: r2.error && r2.error.message };
    }""")
    print(out)
    print('errors', e[:2])
finally:
    b.close()
