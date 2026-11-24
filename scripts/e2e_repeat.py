"""End-to-end proof of the repeat policy (ask / stop / continue) in the dashboard, against two REAL sim agents (no mocks).

What: starts (or reuses) its own dashboard `next dev -p 3027` from this worktree, opens a fresh headless Chromium with robots a / b seeded,
      then drives the UI with structured commands (no LLM): a short succeeding `wait::3` and a fast failing one (FAIL_CMD).
      1 default policy is ask; 2 ask after a success, Continue runs again, Stop ends; 3 ask after a failure; 4 policy stop ends at the first
      failure with no ask; 5 policy continue runs back to back; 6 ask on a, b stays usable and a is marked, answer a later; 7 Cancel never asks;
      8 the old checkbox key migrates (1 -> continue, 0 -> stop). Agents are read over REST only to check (GET /runs).
Why: a repeat loop used to continue only on success (or always, by a checkbox); the owner wants to be asked after every run (2026-11-24).
Env: A_URL (http://127.0.0.1:8021), B_URL (http://127.0.0.1:8022), PORT (3027), FAIL_CMD, SHOTDIR (folder of e2e_start.png, e2e_ask.png, e2e_end.png).
Needs: sim robots a and b idle, `wait` skill on both. Exit 0 only when every step passes.
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
PORT = int(os.environ.get("PORT", "3027"))
DASH = f"http://localhost:{PORT}"
SHOTDIR = os.environ.get("SHOTDIR", "/tmp/claude-1000/-media-keti-workdir-remote-dir-robotapp/48d51ba1-c910-4ee6-a30d-081f51a33057/scratchpad/repeat")
FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
OK_CMD = "wait::3"                                        # succeeds after 3 s
FAIL_CMD = os.environ.get("FAIL_CMD", "wait::notanumber")  # a bad input: must fail within seconds (probed, see step 0)
ROBOTS = [{"name": "a", "url": A_URL}, {"name": "b", "url": B_URL}]
BASE = "localStorage.setItem('robotapp_robots',%s);localStorage.setItem('robotapp_active_robot','a');" % json.dumps(json.dumps(ROBOTS))
SEED = "if(!localStorage.getItem('__seeded')){" + BASE + "localStorage.setItem('__seeded','1')}"
results = []


def runs(url):
    with urllib.request.urlopen(url + "/runs", timeout=5) as r:
        return json.load(r)


def active(url):
    try:
        return runs(url).get("active")
    except Exception:
        return "unreachable"


def run_ids(url):
    return {r["run_id"] for r in runs(url).get("runs", [])}


def outcomes(url, before):
    return [r.get("outcome") for r in runs(url).get("runs", []) if r["run_id"] not in before]


def cancel_agent(url):
    try:
        req = urllib.request.Request(url + "/agent/cancel", data=b"{}", method="POST", headers={"content-type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print(f"note: cancel of {url} failed: {e}", flush=True)


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


def option_text(pg, robot):
    return pg.locator(f'[data-testid="fleet-switch"] option[value="robot:{robot}"]').text_content() or ""


def shot(pg, name):
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTDIR, name))


def open_page(br, seed=SEED):
    ctx = br.new_context(viewport={"width": 1600, "height": 900})
    ctx.add_init_script(seed)
    pg = ctx.new_page()
    pg.goto(DASH, wait_until="networkidle", timeout=120000)
    pg.wait_for_timeout(2500)
    return ctx, pg


def set_repeat(pg, mode, n=3):
    pg.locator('select:has(option[value="once"])').first.select_option(mode)
    if mode == "n":
        pg.locator('input[title="Number of executions"]').fill(str(n))
    pg.wait_for_timeout(300)


def set_policy(pg, policy):
    pg.select_option('[data-testid="repeat-policy"]', value=policy)
    pg.wait_for_timeout(300)


def run_cmd(pg, cmd):
    pg.locator("textarea").first.fill(cmd)
    pg.get_by_role("button", name="Run", exact=True).click()


def ask(pg):
    return pg.locator('[data-testid="repeat-ask"]')


def idle(url):
    return not active(url)


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
            ctx, pg = open_page(br)
            # 0: the failing command really fails fast on the sim (probed through the dashboard's own run path)
            b0 = run_ids(A_URL)
            set_repeat(pg, "once")
            run_cmd(pg, FAIL_CMD)
            done = wait_for(lambda: idle(A_URL) and outcomes(A_URL, b0), 30)
            oc = outcomes(A_URL, b0)
            step("0 FAIL_CMD fails fast", done and all(o != "success" for o in oc), f"cmd={FAIL_CMD!r} outcomes={oc}")
            pg.wait_for_timeout(1500)

            set_repeat(pg, "n", 3)
            pol = pg.locator('[data-testid="repeat-policy"]')
            shot(pg, "e2e_start.png")
            step("1 default policy is ask", pol.count() == 1 and pol.input_value() == "ask", f"value={pol.input_value() if pol.count() else None}")

            # 2: ask after a success; Continue -> run 2; Stop -> loop ends
            b = run_ids(A_URL)
            run_cmd(pg, OK_CMD)
            asked = wait_for(lambda: ask(pg).count() == 1, 30)
            n1 = len(run_ids(A_URL) - b)
            quiet = idle(A_URL)
            pg.wait_for_timeout(5500)
            no_second = len(run_ids(A_URL) - b) == 1 and idle(A_URL)
            txt = ask(pg).text_content() if ask(pg).count() else ""
            shot(pg, "e2e_ask.png")
            pg.locator('[data-testid="repeat-continue"]').click()
            second = wait_for(lambda: len(run_ids(A_URL) - b) == 2, 15)
            asked2 = wait_for(lambda: ask(pg).count() == 1 and idle(A_URL), 30)
            pg.locator('[data-testid="repeat-stop"]').click()
            pg.wait_for_timeout(5500)
            ended = ask(pg).count() == 0 and len(run_ids(A_URL) - b) == 2 and idle(A_URL)
            step("2 ask after success, Continue runs again, Stop ends",
                 asked and n1 == 1 and quiet and no_second and "succeeded" in txt and second and asked2 and ended,
                 f"asked={asked} runs_at_ask={n1} idle={quiet} no_second_5s={no_second} text={txt!r} second={second} asked2={asked2} ended={ended}")

            # 3: ask after a failure
            b = run_ids(A_URL)
            run_cmd(pg, FAIL_CMD)
            asked = wait_for(lambda: ask(pg).count() == 1, 30)
            txt = ask(pg).text_content() if ask(pg).count() else ""
            if asked:
                pg.locator('[data-testid="repeat-stop"]').click()
            pg.wait_for_timeout(5500)
            step("3 ask after a failure, Stop ends", asked and "failed" in txt and ask(pg).count() == 0 and len(run_ids(A_URL) - b) == 1,
                 f"asked={asked} text={txt!r} runs={len(run_ids(A_URL) - b)}")

            # 4: policy stop + failure: no ask, loop ends
            set_policy(pg, "stop")
            b = run_ids(A_URL)
            run_cmd(pg, FAIL_CMD)
            wait_for(lambda: len(run_ids(A_URL) - b) >= 1 and idle(A_URL), 30)
            pg.wait_for_timeout(5500)
            step("4 policy stop: ends at the first failure, no ask", ask(pg).count() == 0 and len(run_ids(A_URL) - b) == 1,
                 f"ask={ask(pg).count()} runs={len(run_ids(A_URL) - b)}")

            # 5: policy continue + success: three runs back to back, no ask
            set_policy(pg, "continue")
            b = run_ids(A_URL)
            run_cmd(pg, OK_CMD)
            saw_ask = False
            t0 = time.time()
            while time.time() - t0 < 40 and not (len(run_ids(A_URL) - b) >= 3 and idle(A_URL)):
                saw_ask = saw_ask or ask(pg).count() > 0
                time.sleep(0.4)
            pg.wait_for_timeout(2000)
            n = len(run_ids(A_URL) - b)
            step("5 policy continue: 3 runs, no ask", n == 3 and not saw_ask and ask(pg).count() == 0, f"runs={n} saw_ask={saw_ask}")

            # 6: ask on a, switch to b: b usable, a marked, b can run; answer a afterwards
            set_policy(pg, "ask")
            b = run_ids(A_URL)
            run_cmd(pg, OK_CMD)
            asked = wait_for(lambda: ask(pg).count() == 1, 30)
            pg.select_option('[data-testid="fleet-switch"]', value="robot:b")
            pg.wait_for_timeout(1500)
            run_btn = pg.get_by_role("button", name="Run", exact=True)
            marked = "◆" in option_text(pg, "a")
            no_ask_b = ask(pg).count() == 0
            usable = run_btn.count() == 1 and run_btn.is_enabled()
            bb = run_ids(B_URL)
            set_repeat(pg, "once")
            run_cmd(pg, OK_CMD)
            b_ran = wait_for(lambda: len(run_ids(B_URL) - bb) == 1 and idle(B_URL), 30)
            pg.select_option('[data-testid="fleet-switch"]', value="robot:a")
            pg.wait_for_timeout(1500)
            still = ask(pg).count() == 1 and idle(A_URL)
            if still:
                pg.locator('[data-testid="repeat-stop"]').click()
            pg.wait_for_timeout(1500)
            step("6 ask on a does not block b; a marked asks; answered after switching back",
                 asked and marked and no_ask_b and usable and b_ran and still and ask(pg).count() == 0 and len(run_ids(A_URL) - b) == 1,
                 f"asked={asked} marked={marked} option={option_text(pg, 'a')!r} no_ask_b={no_ask_b} usable={usable} b_ran={b_ran} still={still}")
            set_repeat(pg, "n", 3)

            # 7: user Cancel during a run never asks
            b = run_ids(A_URL)
            run_cmd(pg, "wait::20")
            started_run = wait_for(lambda: bool(active(A_URL)), 20)
            pg.get_by_role("button", name="Cancel", exact=True).click()
            stopped = wait_for(lambda: idle(A_URL), 30)
            pg.wait_for_timeout(5500)
            step("7 Cancel never asks, no further run", started_run and stopped and ask(pg).count() == 0 and len(run_ids(A_URL) - b) == 1,
                 f"started={started_run} stopped={stopped} ask={ask(pg).count()} runs={len(run_ids(A_URL) - b)}")
            shot(pg, "e2e_end.png")
            ctx.close()

            # 8: migration of the old checkbox key (fresh contexts, no new key)
            got = {}
            for old, want in (("1", "continue"), ("0", "stop")):
                c2, p2 = open_page(br, BASE + "if(!localStorage.getItem('__seeded')){localStorage.setItem('robotapp_repeat_continue_on_error','%s');"
                                   "localStorage.setItem('__seeded','1')}" % old)
                set_repeat(p2, "n", 3)
                got[old] = p2.locator('[data-testid="repeat-policy"]').input_value()
                c2.close()
            step("8 old key migrates (1 -> continue, 0 -> stop)", got == {"1": "continue", "0": "stop"}, f"got={got}")
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
        ok_idle = wait_for(lambda: not active(A_URL) and not active(B_URL), 30)
        step("9 both agents idle", ok_idle, f"a={active(A_URL)} b={active(B_URL)}")
        if proc is not None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)          # only the dashboard this script started
            except Exception:
                pass
    print(f"== e2e repeat: {results.count(False)} FAIL of {len(results)}", flush=True)
    sys.exit(0 if results and all(results) else 1)
