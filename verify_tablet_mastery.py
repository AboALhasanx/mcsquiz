# verify_tablet_mastery.py
# Real device verification of Subject Mastery Badges on Huawei JMS-W09 tablet over CDP.
import json
import os
import subprocess
import time
from playwright.sync_api import sync_playwright

CDP_URL = "http://127.0.0.1:9333"
ADB_PATH = r"C:\Users\gokoq\AppData\Local\FlutterWay\android-sdk\platform-tools\adb.exe"
ARTIFACT_DIR = r"C:\Users\gokoq\.gemini\antigravity\brain\c93cbeb3-3645-440b-9f04-ac4956782de6"

def capture_screen(filename):
    out_path = os.path.join(ARTIFACT_DIR, filename)
    data = subprocess.check_output([ADB_PATH, 'exec-out', 'screencap', '-p'])
    with open(out_path, 'wb') as f:
        f.write(data)
    print(f"Captured screen -> {out_path} ({len(data)} bytes)")
    return out_path

def main():
    print("Connecting to Chrome over CDP on tablet...")
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(CDP_URL)
        context = browser.contexts[0]
        
        # Find Portal page
        page = None
        for p in context.pages:
            url = p.url
            print(f"Discovered tab: {url}")
            if "8081" in url or "mcq-portal" in url or "localhost" in url:
                page = p
                break
        
        if not page:
            print("Opening new tab pointing to http://127.0.0.1:8081...")
            page = context.new_page()
            page.goto("http://127.0.0.1:8081/")
        
        page.bring_to_front()
        time.sleep(1)

        # 1. Setup mock mastery data for AI subject (4 quizzes) + English subject (partial)
        ai_quizzes = [
            'Quiz_Ch01_ModelA_AI_Foundations',
            'Quiz_Ch01_ModelB_AI_Foundations',
            'Quiz_Ch02_ModelA_Search_and_Learning',
            'Quiz_Ch02_ModelB_Search_and_Learning'
        ]
        
        setup_code = f"""() => {{
            {"; ".join([f"localStorage.setItem('portal_best_{qid}', JSON.stringify({{ pct: 95, frac: '19/20' }}));" for qid in ai_quizzes])}
            if (window.__portalState) {{
                window.__portalState.sound = false;
            }}
        }}"""
        page.evaluate(setup_code)
        print("Mastery test data seeded in tablet localStorage.")

        # 2. Navigate to Account view to inspect Subject Mastery Shelf
        page.goto("http://127.0.0.1:8081/#/account")
        page.wait_for_selector("#profile-mastery-grid", timeout=10000)
        time.sleep(1.5)
        capture_screen("tablet_mastery_shelf_live.png")

        # 3. Open Subject Mastery Details Sheet for AI
        page.evaluate("() => { window.PortalAchievements.showSubjectMasterySheet('06_Artificial_Intelligence'); }")
        time.sleep(1.2)
        capture_screen("tablet_mastery_sheet_live.png")

        # 4. Close Sheet and Navigate to Catalog to inspect Subject Chips
        page.evaluate("() => { window.PortalAchievements.closeBadgeSheet(); }")
        time.sleep(0.5)
        page.goto("http://127.0.0.1:8081/#/")
        page.wait_for_selector("#subject-filter-bar", timeout=10000)
        time.sleep(1.5)
        capture_screen("tablet_mastery_chips_live.png")

        print("Verification completed successfully on tablet.")

if __name__ == "__main__":
    main()
