# unregister_sw_tablet.py
import time
from playwright.sync_api import sync_playwright

CDP_URL = "http://127.0.0.1:9333"

with sync_playwright() as pw:
    browser = pw.chromium.connect_over_cdp(CDP_URL)
    context = browser.contexts[0]
    page = context.pages[0]
    page.bring_to_front()

    # Unregister SW and delete caches
    res = page.evaluate("""async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (let r of regs) {
            await r.unregister();
        }
        const keys = await caches.keys();
        for (let k of keys) {
            await caches.delete(k);
        }
        return { unregistered: regs.length, cachesDeleted: keys.length };
    }""")
    print("Service workers & caches cleared:", res)

    # Force hard reload
    page.reload(wait_until="networkidle")
    time.sleep(1.5)

    icon_name = page.evaluate("() => window.PortalAchievements.getSubjectMeta('06_Artificial_Intelligence').icon")
    print(f"After hard reload, loaded AI icon in tablet memory: {icon_name}")
