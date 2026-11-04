# capture_new_medal.py
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

with sync_playwright() as pw:
    browser = pw.chromium.connect_over_cdp(CDP_URL)
    context = browser.contexts[0]
    page = context.pages[0]
    page.bring_to_front()

    page.goto("http://127.0.0.1:8081/#/account")
    page.wait_for_selector("#profile-mastery-grid", timeout=10000)
    time.sleep(1)

    # Open AI mastery sheet
    page.evaluate("() => { window.PortalAchievements.showSubjectMasterySheet('06_Artificial_Intelligence'); }")
    time.sleep(1.2)
    capture_screen("tablet_new_medal_live.png")
    print("New medal captured.")
