"""End-to-end proof of a preset that is a SEQUENCE of plans (docs/features/plan-sequence.md), against one REAL sim agent (no mocks).

What: starts (or reuses) its own dashboard `next dev -p 3018` from this worktree, opens a fresh headless Chromium with robot `a` seeded, types a cell with
      `---` lines and clicks Run. Checks: only the first plan runs, then the bar waits (Next / Stop), Next runs the next plan as an ordinary run on the
      agent (its own run record), the last plan ends the sequence, a failing plan offers Retry / Skip / Stop (nothing goes on by itself), Skip leaves the
      next plan waiting for its own click, Stop forgets the sequence, a plain run clears a waiting sequence, and a cell without `---` is the old single run (no bar).
Env: A_URL (http://127.0.0.1:8021), PORT (3018), SHOTDIR. Needs: a sim robot idle at A_URL with the `wait` skill (`make run ROBOT=home PORT=8021 HOST=127.0.0.1`
      in symbolic_robot). Exit 0 only when every step passes.
Switch off: run by hand only.
"""
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

A_URL = os.environ.get("A_URL", "http://127.0.0.1:8021")
PORT = int(os.environ.get("PORT", "3018"))
DASH = f"http://localhost:{PORT}"
SHOTDIR = os.environ.get("SHOTDIR", os.path.join(tempfile.gettempdir(), "robotapp_e2e_sequence"))
FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
ROBOTS = [{"name": "a", "url": A_URL}]
SEED = ("if(!localStorage.getItem('__seeded')){localStorage.setItem('robotapp_robots',%s);localStorage.setItem('robotapp_active_robot','a');"
        "localStorage.setItem('__seeded','1')}" % json.dumps(json.dumps(ROBOTS)))
results = []


def runs():
    with urllib.request.urlopen(A_URL + "/runs", timeout=5) as r:
        return json.load(r)


def wait_for(fn, timeout, every=0.4):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if fn():
                return True
        except Exception:
            pass
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


def state(pg):
    bar = pg.locator('[data-testid="seq-bar"]')
    return bar.get_attribute("data-state") if bar.count() else None


def wait_state(pg, want, timeout=40):
    return wait_for(lambda: state(pg) == want, timeout)


def cell(pg, text):
    pg.locator("textarea").first.fill(text)


def shot(pg, name):
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTDIR, name))


def n_runs():
    return len(runs().get("runs", []))


def main():
    os.makedirs(SHOTDIR, exist_ok=True)
    started = None
    if not dash_up():
        started = subprocess.Popen(["npx", "next", "dev", "-p", str(PORT)], cwd=FRONTEND, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   start_new_session=True)
        if not wait_for(dash_up, 120, 1):
            step("0 dashboard up", False, "next dev did not answer in 120 s")
            return started
    if runs().get("active"):
        step("0 agent idle", False, f"active run before start: {runs().get('active')}")
        return started
    base = n_runs()
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True)
        try:
            ctx = br.new_context(viewport={"width": 1600, "height": 900})
            ctx.add_init_script(SEED)
            pg = ctx.new_page()
            pg.goto(DASH, wait_until="networkidle", timeout=120000)
            pg.wait_for_timeout(2500)
            run_btn = pg.locator('[data-testid="run-button"]')

            # 1 a cell with two --- lines: the button says how many plans; Run starts ONLY the first
            cell(pg, "wait::2\n---\nwait::2\n---\nwait::2")
            step("1 Run says (3 plans)", "3 plans" in (run_btn.text_content() or ""), run_btn.text_content() or "")
            run_btn.click()
            step("2 plan 1 runs, then the bar waits", wait_state(pg, "waiting") and "1 ✓" in (pg.locator('[data-testid="seq-bar"]').text_content() or ""),
                 f"state={state(pg)}")
            shot(pg, "seq_waiting.png")
            step("3 only one run on the agent, and it is idle", n_runs() - base == 1 and not runs().get("active"), f"runs +{n_runs() - base} active={runs().get('active')}")
            step("4 Next and Stop are shown, Retry is not", pg.locator('[data-testid="seq-next"]').count() == 1 and pg.locator('[data-testid="seq-stop"]').count() == 1
                 and pg.locator('[data-testid="seq-retry"]').count() == 0)

            # 2 Next runs plan 2 as an ordinary run; again for plan 3; the last plan ends the sequence
            pg.locator('[data-testid="seq-next"]').click()
            ok2 = wait_for(lambda: n_runs() - base == 2, 15) and wait_state(pg, "waiting")
            step("5 Next ran plan 2 as its own run, the bar waits again", ok2, f"runs +{n_runs() - base} state={state(pg)}")
            pg.locator('[data-testid="seq-next"]').click()
            ok3 = wait_state(pg, "done") and n_runs() - base == 3
            shot(pg, "seq_done.png")
            step("6 plan 3 was the last: 'Sequence done', no Next", ok3 and pg.locator('[data-testid="seq-next"]').count() == 0, f"state={state(pg)} runs +{n_runs() - base}")
            pg.locator('[data-testid="seq-stop"]').click()
            step("7 Close removes the bar", wait_for(lambda: state(pg) is None, 5))

            # 3 a failing plan (an unknown skill): Retry / Skip / Stop, never on by itself; Skip leaves plan 3 waiting
            base = n_runs()
            cell(pg, "wait::1\n---\nnosuchskill::1\n---\nwait::1")
            pg.locator('[data-testid="run-button"]').click()
            wait_state(pg, "waiting")
            pg.locator('[data-testid="seq-next"]').click()
            okf = wait_state(pg, "failed")
            shot(pg, "seq_failed.png")
            step("8 a failing plan: Retry, Skip and Stop; no Next", okf and pg.locator('[data-testid="seq-retry"]').count() == 1
                 and pg.locator('[data-testid="seq-skip"]').count() == 1 and pg.locator('[data-testid="seq-next"]').count() == 0, f"state={state(pg)}")
            before = n_runs()
            pg.wait_for_timeout(3000)
            step("9 nothing runs by itself after the failure", n_runs() == before and not runs().get("active"))
            pg.locator('[data-testid="seq-retry"]').click()
            step("10 Retry runs plan 2 again (a new run), and it fails again", wait_for(lambda: n_runs() == before + 1, 15) and wait_state(pg, "failed"), f"state={state(pg)}")
            pg.locator('[data-testid="seq-skip"]').click()
            step("11 Skip: plan 3 waits for its own click", state(pg) == "waiting" and "skipped" in (pg.locator('[data-testid="seq-bar"]').text_content() or ""),
                 f"state={state(pg)}")
            pg.locator('[data-testid="seq-next"]').click()
            step("12 Next runs plan 3: the sequence ends", wait_state(pg, "done"), f"state={state(pg)}")
            txt = pg.locator('[data-testid="seq-bar"]').text_content() or ""
            step("12b the skipped plan stays marked (⏭, '1 skipped'), it is not shown as done", "2 ⏭" in txt and "1 skipped" in txt, txt)
            pg.locator('[data-testid="seq-stop"]').click()

            # 4 Stop while waiting forgets the sequence; a cell without --- is the old single run
            cell(pg, "wait::1\n---\nwait::1")
            pg.locator('[data-testid="run-button"]').click()
            wait_state(pg, "waiting")
            pg.locator('[data-testid="seq-stop"]').click()
            step("13 Stop while waiting ends the sequence (no further run)", wait_for(lambda: state(pg) is None, 5) and not runs().get("active"))
            cell(pg, "wait::1")
            step("14 one plan: the button just says Run", (pg.locator('[data-testid="run-button"]').text_content() or "").strip() == "Run")
            pg.locator('[data-testid="run-button"]').click()
            pg.wait_for_timeout(2500)
            step("15 one plan: no bar after the run", state(pg) is None and not runs().get("active"), f"state={state(pg)}")
            shot(pg, "seq_end.png")

            # 5 a plain run ends a waiting sequence. (Cancel during a running plan is NOT driven here: the symbolic robot's `wait` returns at once, so no plan runs long
            #   enough to cancel; that path is covered by the unit tests: afterRun aborted -> idle, endRun, lostVerdict.)
            cell(pg, "wait::1\n---\nwait::1")
            pg.locator('[data-testid="run-button"]').click()
            wait_state(pg, "waiting")
            cell(pg, "wait::1")
            pg.locator('[data-testid="run-button"]').click()
            step("16 a plain run clears a waiting sequence", wait_for(lambda: state(pg) is None, 10) and wait_for(lambda: not runs().get("active"), 15), f"state={state(pg)}")
        finally:
            br.close()
    return started


if __name__ == "__main__":
    proc = None
    try:
        proc = main()
    finally:
        if proc is not None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:
                pass
    print(f"{sum(results)}/{len(results)} steps passed")
    sys.exit(0 if results and all(results) else 1)
