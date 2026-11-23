"""End-to-end proof of per-robot sessions in the dashboard, against two REAL sim agents (no mocks).

What: starts (or reuses) its own dashboard `next dev -p 3017` from this worktree, opens a fresh headless Chromium with robots a / b seeded,
      then drives the UI: a runs a long structured command, the person picks b, b is free and a is marked running, b runs a short command,
      Cancel while viewing b leaves a running, picking a and Cancel stops a, then 5b: a is renamed in the robot editor during a run, still marked running, Cancel stops it. Agents are read over REST only to check (GET /runs).
Why: Cancel used to go to "the robot picked now" and the controls stayed locked after a switch (owner, 2026-11-24).
Env: A_URL (http://127.0.0.1:8021), B_URL (http://127.0.0.1:8022), PORT (3017), SHOTDIR (folder of e2e_start.png, e2e_step2.png, e2e_step3.png, e2e_end.png).
Needs: sim robots a and b idle, `wait` skill on both (structured `wait::<seconds>`). Exit 0 only when every step passes.
Switch off: run by hand only.
"""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

A_URL = os.environ.get("A_URL", "http://127.0.0.1:8021")
B_URL = os.environ.get("B_URL", "http://127.0.0.1:8022")
PORT = int(os.environ.get("PORT", "3017"))
DASH = f"http://localhost:{PORT}"
SHOTDIR = os.environ.get("SHOTDIR", "/tmp/claude-1000/-media-keti-workdir-remote-dir-robotapp/48d51ba1-c910-4ee6-a30d-081f51a33057/scratchpad/sessions")
FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
LONG_CMD, SHORT_CMD = "wait::90", "wait::12"          # a's run outlives every step; b's run is short but still running when Cancel is pressed
ROBOTS = [{"name": "a", "url": A_URL}, {"name": "b", "url": B_URL}]
SEED = ("if(!localStorage.getItem('__seeded')){localStorage.setItem('robotapp_robots',%s);localStorage.setItem('robotapp_active_robot','a');"
        "localStorage.setItem('__seeded','1')}" % json.dumps(json.dumps(ROBOTS)))
results = []


def runs(url):
    with urllib.request.urlopen(url + "/runs", timeout=5) as r:
        return json.load(r)


def active(url):
    try:
        return runs(url).get("active")
    except Exception:
        return "unreachable"


def cancel_agent(url):
    try:
        req = urllib.request.Request(url + "/agent/cancel", data=b"{}", method="POST", headers={"content-type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print(f"note: cancel of {url} failed: {e}", flush=True)


def wait_for(fn, timeout, every=0.5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if fn():
            return True
        time.sleep(every)
    return False


def step(name, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} step {name}{' :: ' + detail if detail and not ok else ''}", flush=True)


def dash_up():
    try:
        urllib.request.urlopen(DASH, timeout=3).read(1)
        return True
    except Exception:
        return False


def option_text(pg, robot):
    return pg.locator(f'[data-testid="fleet-switch"] option[value="robot:{robot}"]').text_content() or ""


def shot(pg, name, open_list=False):
    """Screenshot; open_list shows the robot list (a native <select> popup is not drawn headless, so it is expanded as a list box)."""
    sel = pg.locator('[data-testid="fleet-switch"]')
    if open_list:
        sel.evaluate("e => { e.dataset.size = e.size; e.size = Math.max(e.options.length, 3) }")
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTDIR, name))
    if open_list:
        sel.evaluate("e => { e.size = Number(e.dataset.size) || 0 }")


def run_cmd(pg, cmd):
    ta = pg.locator("textarea").first
    ta.fill(cmd)
    pg.get_by_role("button", name="Run", exact=True).click()


def main():
    started = None
    if not dash_up():
        started = subprocess.Popen(["npx", "next", "dev", "-p", str(PORT)], cwd=FRONTEND, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   start_new_session=True)
        if not wait_for(dash_up, 120, 1):
            step("0 dashboard up", False, "next dev did not answer in 120 s")
            return started
    pre = [active(A_URL), active(B_URL)]
    if any(pre):
        step("0 agents idle", False, f"a / b active before start: {pre}")
        return started
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True)
        try:
            ctx = br.new_context(viewport={"width": 1600, "height": 900})
            ctx.add_init_script(SEED)
            pg = ctx.new_page()
            pg.goto(DASH, wait_until="networkidle", timeout=120000)
            pg.wait_for_timeout(2500)
            sw = pg.locator('[data-testid="fleet-switch"]')
            if sw.input_value() != "robot:a":
                pg.select_option('[data-testid="fleet-switch"]', value="robot:a")
                pg.wait_for_timeout(1500)
            run_cmd(pg, LONG_CMD)
            ok1 = wait_for(lambda: bool(active(A_URL)), 20) and "running" in option_text(pg, "a")
            shot(pg, "e2e_start.png")
            step("1 robot a runs", ok1, f"a active={active(A_URL)} option={option_text(pg, 'a')!r}")

            pg.select_option('[data-testid="fleet-switch"]', value="robot:b")
            pg.wait_for_timeout(1500)
            run_btn = pg.get_by_role("button", name="Run", exact=True)
            shot(pg, "e2e_step2.png", open_list=True)        # the key moment: b is shown and free (Run usable) while a is marked running
            step("2 b free, a marked running", run_btn.count() == 1 and run_btn.is_enabled() and "running" in option_text(pg, "a")
                 and "running" not in option_text(pg, "b"), f"run buttons={run_btn.count()} a={option_text(pg, 'a')!r} b={option_text(pg, 'b')!r}")

            run_cmd(pg, SHORT_CMD)
            b_ok = wait_for(lambda: bool(active(B_URL)), 20)
            pg.wait_for_timeout(500)
            shot(pg, "e2e_step3.png", open_list=True)
            print(f"PASS option_marks a={option_text(pg, 'a')} b={option_text(pg, 'b')}", flush=True)
            step("3 both agents active, b shown", b_ok and bool(active(A_URL)) and "running" in option_text(pg, "b")
                 and pg.get_by_role("button", name="Run", exact=True).count() == 0,
                 f"a={active(A_URL)} b={active(B_URL)} b_option={option_text(pg, 'b')!r}")

            a_id = active(A_URL)
            pg.get_by_role("button", name="Cancel", exact=True).click()
            b_stopped = wait_for(lambda: not active(B_URL), 30)
            step("4 Cancel on b leaves a running", b_stopped and active(A_URL) == a_id and a_id is not None,
                 f"a={active(A_URL)} (was {a_id}) b={active(B_URL)}")

            pg.select_option('[data-testid="fleet-switch"]', value="robot:a")
            pg.wait_for_timeout(1500)
            pg.get_by_role("button", name="Cancel", exact=True).click()
            step("5 Cancel on a stops a", wait_for(lambda: not active(A_URL), 30), f"a={active(A_URL)}")
            shot(pg, "e2e_end.png")

            # 5b: rename the robot while its run is live (through the dashboard's own robot editor: the edit button, the name field, Save)
            run_cmd(pg, LONG_CMD)
            re_run = wait_for(lambda: bool(active(A_URL)), 20) and "running" in option_text(pg, "a")
            # the sidebar header overlaps the small edit button for a real mouse click, so the click is dispatched on the element
            pg.get_by_role("button", name="Edit the selected robot or fleet").evaluate("e => e.click()")
            pg.get_by_placeholder("Name (e.g. kcare_lab, kcare_demo)").fill("a_renamed")
            pg.get_by_placeholder("http://192.168.1.10:8001").press("Enter")   # Enter in the url field = Save (other "Save" buttons exist on the page)
            pg.wait_for_timeout(1500)
            marked = wait_for(lambda: "running" in option_text(pg, "a_renamed"), 10)
            shot(pg, "e2e_step5b.png", open_list=True)
            cancel_btn = pg.get_by_role("button", name="Cancel", exact=True)
            if cancel_btn.count() == 1:
                cancel_btn.click()
            stopped = wait_for(lambda: not active(A_URL), 30)
            idle_mark = wait_for(lambda: bool(option_text(pg, "a_renamed")) and "running" not in option_text(pg, "a_renamed"), 15)
            run_again = pg.get_by_role("button", name="Run", exact=True)
            step("5b rename while running: still running, Cancel stops it, idle, Run again",
                 re_run and marked and stopped and idle_mark and run_again.count() == 1 and run_again.is_enabled(),
                 f"run_started={re_run} marked={marked} stopped={stopped} idle_mark={idle_mark} option={option_text(pg, 'a_renamed')!r} runs={run_again.count()}")
        finally:
            br.close()
    return started


if __name__ == "__main__":
    proc = None
    try:
        proc = main()
    except Exception as e:                                   # a UI error is a failed step, not a crash without cleanup
        step(f"error {type(e).__name__}", False, str(e)[:1500])
    finally:
        for u in (A_URL, B_URL):
            cancel_agent(u)
        idle = wait_for(lambda: not active(A_URL) and not active(B_URL), 30)
        step("6 both agents idle", idle, f"a={active(A_URL)} b={active(B_URL)}")
        if proc is not None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)          # only the dashboard this script started
            except Exception:
                pass
    print(f"== e2e sessions: {results.count(False)} FAIL of {len(results)}", flush=True)
    sys.exit(0 if results and all(results) else 1)
