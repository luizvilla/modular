#!/usr/bin/env python3
"""
ThingSet Text Mode auto-tester and data object parser.

Key behavior aligned with the spec (see tools/Text Mode _ ThingSet.html):
- Discovery uses FETCH with null: "?Path null" to list child names.
- Reads use GET: "?Path" or "?Parent/[...]"; scalar parsing supported.
- Updates use UPDATE: "=Parent {"leaf": value}" (supports 'w*' and 's*').
- Exec uses EXECUTE: "!Path".

Run:
  python tools/thingset_autotest.py [--port /dev/ttyACM0] [--baud 115200] [--apply] [--exec] [--verbose]

Without --apply, it only discovers and probes readable values.
With --apply, it nudges writable/settings by a small delta and restores.
"""

import argparse
import json
import math
import re
import sys
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

try:
    import serial  # type: ignore
    from serial.tools import list_ports  # type: ignore
except Exception as e:
    print("ERROR: pyserial is required. Install with: pip install pyserial", file=sys.stderr)
    raise


PROMPT_RE = re.compile(rb"([A-Za-z0-9_-]+):~\$ ")


@dataclass
class Node:
    path: str           # Full ThingSet path like /Config/Mode/wMode
    name: str           # Leaf name e.g. wMode
    is_group: bool      # True for group nodes
    kind: str           # 'w', 's', 'r', 'x', or '' (group)


@dataclass
class TestResult:
    path: str
    success: bool
    note: str = ""


class ThingSetShell:
    def __init__(self, ser: serial.Serial, verbose: bool = False, cmd_prefix: str = ""):
        self.ser = ser
        self.prompt = None  # type: Optional[bytes]
        self.verbose = verbose
        self.cmd_prefix = cmd_prefix  # e.g., "thingset " if needed
        try:
            self.ser.write_timeout = 0.5
        except Exception:
            pass

    def _dbg(self, msg: str):
        if self.verbose:
            print(f"[DBG] {msg}")

    def read_until_prompt(self, timeout: float = 2.0) -> bytes:
        self.ser.timeout = 0.05
        data = bytearray()
        start = time.time()
        last_rx = start
        while True:
            chunk = self.ser.read(4096)
            now = time.time()
            if chunk:
                data.extend(chunk)
                last_rx = now
                m = PROMPT_RE.search(data)
                if m:
                    self.prompt = m.group(0)
                    break
            # Break if no new data for 200ms or absolute timeout reached
            if now - last_rx > 0.2 or now - start > timeout:
                break
        return bytes(data)

    def send_cmd(self, cmd: str, read_timeout: float = 2.0) -> bytes:
        # Use CRLF to better match terminal behavior
        if not (cmd.endswith("\n") or cmd.endswith("\r")):
            cmd += "\r\n"
        full_cmd = (self.cmd_prefix + cmd)
        self._dbg(f"TX: {full_cmd.strip()}")
        self.ser.write(full_cmd.encode())
        self.ser.flush()
        # Read until next prompt appears
        buf = self.read_until_prompt(timeout=read_timeout)
        self._dbg(f"RX: {buf[-200:].decode(errors='ignore')}")
        return buf

    def enter_thingset(self) -> bool:
        # Nudge shell to print a prompt (best-effort; ignore write timeouts)
        try:
            try:
                self.ser.reset_input_buffer()
            except Exception:
                pass
            for _ in range(3):
                try:
                    self.ser.write(b"\r\n")
                    self.ser.flush()
                except Exception:
                    pass
                self.read_until_prompt(timeout=0.5)
                if self.prompt is not None:
                    break
        except Exception:
            pass
        # Try a few strategies: plain, then with selecting, then using 'thingset ' prefix
        def try_probe() -> bool:
            out = self.send_cmd("?", read_timeout=1.0)
            if self._extract_json(out.decode(errors="ignore")) is not None:
                return True
            out = self.send_cmd("ls /", read_timeout=1.0)
            if self._extract_json(out.decode(errors="ignore")) is not None:
                return True
            self.send_cmd("select thingset", read_timeout=1.0)
            out = self.send_cmd("?", read_timeout=1.0)
            return self._extract_json(out.decode(errors="ignore")) is not None

        # 1) Plain
        if try_probe():
            return True
        # 2) Retry using prefixed commands
        old_prefix = self.cmd_prefix
        self.cmd_prefix = "thingset "
        self._dbg("Switching to 'thingset ' command prefix")
        ok = try_probe()
        if not ok:
            # Restore and fail
            self.cmd_prefix = old_prefix
        return ok

    def _extract_json(self, text: str):
        # Strip any status prefix like ":85 " then parse JSON block
        # Find first '{' or '[' and parse till matching end
        start = None
        for i, ch in enumerate(text):
            if ch in '{[':
                start = i
                break
        if start is None:
            return None
        # Simple bracket matching to find end
        stack = []
        end = None
        for i in range(start, len(text)):
            c = text[i]
            if c == '{' or c == '[':
                stack.append(c)
            elif c == '}' or c == ']':
                if not stack:
                    break
                top = stack.pop()
                if (top == '{' and c != '}') or (top == '[' and c != ']'):
                    # malformed; give up
                    return None
                if not stack:
                    end = i + 1
                    break
        if end is None:
            return None
        blob = text[start:end]
        try:
            import json
            return json.loads(blob)
        except Exception:
            return None

    def _q_names(self, path: str):
        # Use ThingSet Text Mode FETCH with null to list child names
        # Examples: '?' (root summary), '?Bat null' (list items), '?/ null' (gateway nodes)
        if path in (None, "", "/"):
            q = "?"
        else:
            arg = path[1:] if path.startswith("/") else path
            q = f"?{arg} null"
        out = self.send_cmd(q)
        txt = out.decode(errors="ignore")
        js = self._extract_json(txt)
        # Some implementations might return an object instead of an array when not using 'null'.
        # We strictly expect an array here; otherwise return None to trigger alternative probing.
        return js if isinstance(js, list) else None

    def _q_fetch(self, path: str):
        # Fetch value(s) for given path using '?' Text Mode
        arg = path[1:] if path.startswith("/") else path
        out = self.send_cmd(f"?{arg}")
        txt = out.decode(errors="ignore")
        js = self._extract_json(txt)
        if js is not None:
            return js
        # Fallback parse for scalar after status code
        # Expected format: ':85 <token>'
        m = re.search(r":[0-9A-Fa-f]{2,}\s+(.*)", txt)
        if m:
            token = m.group(1).strip()
            # Remove any trailing prompt fragments
            token = token.splitlines()[0].strip()
            return token
        return None

    def list_nodes(self) -> List[Node]:
        # Recursively walk using JSON from '?'
        nodes: List[Node] = []
        visited = set()

        def join(p: str, name: str) -> str:
            if p == "/":
                return f"/{name}"
            return p.rstrip("/") + "/" + name

        def walk(path: str, depth: int = 0):
            if path in visited:
                return
            visited.add(path)
            # Query list of child names using '?<path> null'
            names = self._q_names(path)
            if isinstance(names, list):
                if path != "/":
                    nodes.append(Node(path=path, name=path.rsplit("/", 1)[-1], is_group=True, kind=""))
                for name in names:
                    name = str(name)
                    child_path = join(path, name)
                    # If leaf by naming convention, add and do not recurse further
                    if name and name[0] in ("w", "s", "r", "x"):
                        kind = name[0]
                        nodes.append(Node(path=child_path, name=name, is_group=False, kind=kind))
                    else:
                        # Recurse into subgroup or record container
                        walk(child_path, depth + 1)
                return
            # If names couldn't be listed (device may not support null discovery), try fetching
            fetched = self._q_fetch(path)
            if isinstance(fetched, dict):
                if path != "/":
                    nodes.append(Node(path=path, name=path.rsplit("/", 1)[-1], is_group=True, kind=""))
                for key in fetched.keys():
                    name = str(key)
                    child_path = join(path, name)
                    if name and name[0] in ("w", "s", "r", "x"):
                        kind = name[0]
                        nodes.append(Node(path=child_path, name=name, is_group=False, kind=kind))
                    else:
                        walk(child_path, depth + 1)
            elif isinstance(fetched, list):
                # Treat list elements as indices
                if path != "/":
                    nodes.append(Node(path=path, name=path.rsplit("/", 1)[-1], is_group=True, kind=""))
                for i, _ in enumerate(fetched):
                    name = str(i)
                    child_path = join(path, name)
                    walk(child_path, depth + 1)
            else:
                # Scalar or unknown -> treat as leaf
                name = path.rsplit("/", 1)[-1]
                kind = name[:1] if name else ""
                nodes.append(Node(path=path, name=name, is_group=False, kind=kind))

        # Start from root: ask for top-level names
        top = self._q_names("/")
        if isinstance(top, list):
            for key in top:
                walk("/" + str(key))
        else:
            # Fallback to fetching and expanding
            walk("/")

        # Deduplicate
        uniq = {}
        for n in nodes:
            uniq[(n.path, n.is_group)] = n
        return list(uniq.values())

    def get_value(self, path: str, timeout: float = 1.5) -> Tuple[bool, Optional[str]]:
        arg = path[1:] if path.startswith("/") else path
        out = self.send_cmd(f"?{arg}", read_timeout=timeout)
        txt = out.decode(errors="ignore")
        # Try JSON first
        js = self._extract_json(txt)
        if js is not None:
            if isinstance(js, dict) and js:
                # take the first value
                try:
                    val = next(iter(js.values()))
                except Exception:
                    val = js
            else:
                val = js
            return True, str(val)
        # Fallback: parse scalar after status code (e.g., ':85 12.9')
        m = re.search(r":[0-9A-Fa-f]{2,}\s+(.*)", txt)
        if m:
            token = m.group(1).strip()
            token = token.splitlines()[0].strip()
            return True, token if token else None
        return False, None

    def set_value(self, path: str, value: str, timeout: float = 2.0) -> Tuple[bool, str]:
        # Translate leaf path '/Group/sParam' into '=Group {\"sParam\":value}'
        p = path[1:] if path.startswith("/") else path
        if "/" in p:
            parent, leaf = p.rsplit("/", 1)
        else:
            parent, leaf = "", p
        # Build JSON via json.dumps to ensure correct quoting, then escape quotes for shell
        # Attempt to convert the provided value string to typed JSON value
        vtype, pyval = parse_scalar(value)
        json_obj = {leaf: pyval}
        payload_raw = json.dumps(json_obj, separators=(",", ":"))
        # Escape double quotes for the Zephyr shell parser
        payload_escaped = payload_raw.replace('"', '\\"')
        cmd = f"={parent or ''} {payload_escaped}".strip()
        out = self.send_cmd(cmd, read_timeout=timeout)
        txt = out.decode(errors="ignore")
        # Success indicated by status 0x84 (Changed) or 0x85 (Content)
        ok = bool(re.search(r":(84|85)(\s|$)", txt)) and ("A3" not in txt)
        return ok, txt

    def exec_node(self, path: str, timeout: float = 2.0) -> Tuple[bool, str]:
        arg = path[1:] if path.startswith("/") else path
        out = self.send_cmd(f"!{arg}", read_timeout=timeout)
        txt = out.decode(errors="ignore")
        ok = bool(re.search(r":(84|85)(\s|$)", txt)) and ("A3" not in txt)
        return ok, txt


def parse_scalar(val: str) -> Tuple[str, object]:
    v = val.strip()
    if v.lower() in ("true", "false"):
        return ("bool", v.lower() == "true")
    # Try int
    try:
        if v.startswith("0x"):
            return ("int", int(v, 16))
        return ("int", int(v))
    except Exception:
        pass
    # Try float
    try:
        return ("float", float(v))
    except Exception:
        pass
    # Fallback to string
    return ("str", v)


def pick_test_values(vtype: str, val: object, name: str) -> List[object]:
    if vtype == "bool":
        return [not bool(val)]
    if vtype == "int":
        cur = int(val)
        if cur == 0:
            return [1]
        # Small perturbation
        return [cur + 1]
    if vtype == "float":
        cur = float(val)
        if abs(cur) < 1e-9:
            return [0.1]
        # ±5% but keep non-negative if likely a magnitude (heuristic by name)
        delta = 0.05 * abs(cur)
        if any(s in name.lower() for s in ["duty", "freq", "hz", "ms", "gain", "offset", "phase"]):
            newv = cur + (delta if cur >= 0 else -delta)
        else:
            newv = cur + delta
        return [newv]
    # Strings not auto-tested
    return []


def approx_equal(expected: object, actual: object, vtype: str, decimals: int = 0) -> bool:
    try:
        if vtype == "float":
            # If precision is known, use an absolute tolerance based on it
            if decimals and decimals > 0:
                step = 10 ** (-decimals)
                return math.isclose(float(expected), float(actual), rel_tol=1e-4, abs_tol=0.6 * step)
            return math.isclose(float(expected), float(actual), rel_tol=5e-3, abs_tol=1e-6)
        if vtype == "int":
            return int(expected) == int(actual)
        if vtype == "bool":
            return bool(expected) == bool(actual)
        return str(expected) == str(actual)
    except Exception:
        return False


def count_decimals(text: Optional[str]) -> int:
    if not text:
        return 0
    s = text.strip()
    # Extract first token up to whitespace
    token = s.split()[0]
    if '.' in token:
        frac = token.split('.', 1)[1]
        # Trim any trailing non-digit characters
        frac = ''.join(ch for ch in frac if (ch.isdigit()))
        return len(frac)
    return 0


def print_summary(results: List[TestResult]):
    if not results:
        return
    title = "Settable Nodes Summary"
    width = max(24, max(len(r.path) for r in results) + 4)
    print("\n" + title)
    print("-" * (len(title)))
    # Header
    print(f"{'Status':7} {'Path':{width}} Note")
    print(f"{'-'*7} {'-'*width} {'-'*20}")
    for r in results:
        green = "\x1b[32m"
        red = "\x1b[31m"
        reset = "\x1b[0m"
        status_txt = '✔ PASS' if r.success else '✖ FAIL'
        status_col = f"{green}{status_txt}{reset}" if r.success else f"{red}{status_txt}{reset}"
        print(f"{status_col:7} {r.path:{width}} {r.note}")


def discover_device(explicit_port: Optional[str], baud: int, verbose: bool, use_thingset_prefix: bool) -> Optional[serial.Serial]:
    ports: List[str] = []
    if explicit_port:
        ports = [explicit_port]
    else:
        # Prefer USB CDC ports to avoid TTY enumerations that aren't usable
        all_ports = list_ports.comports()
        usb_like = [p.device for p in all_ports if any(tag in (p.device or "") for tag in ("ttyACM", "ttyUSB"))]
        ports = usb_like or [p.device for p in all_ports]
    if not ports:
        print("No serial ports found.")
        return None
    for dev in ports:
        ser = None
        ok = False
        try:
            ser = serial.Serial(dev, baudrate=baud, timeout=0.2, write_timeout=1.0, dsrdtr=False, rtscts=False, xonxoff=False)
            # Toggle DTR to wake CDC-ACM endpoints
            try:
                ser.setDTR(False)
                time.sleep(0.05)
                ser.setDTR(True)
            except Exception:
                pass
            try:
                ser.reset_input_buffer()
                ser.reset_output_buffer()
            except Exception:
                pass
            # Try to read any banner
            time.sleep(0.1)
            _ = ser.read(1024)

            sh = ThingSetShell(ser, verbose=verbose, cmd_prefix=("thingset " if use_thingset_prefix else ""))
            try:
                ok = sh.enter_thingset()
            except serial.SerialTimeoutException:
                ok = False
            if ok:
                print(f"Connected ThingSet shell on {dev}")
                return ser
        except Exception as e:
            if verbose:
                print(f"[DBG] open {dev} failed: {e}")
        finally:
            if not ok and ser and not ser.closed:
                try:
                    ser.close()
                except Exception:
                    pass
    print("No ThingSet shell found on available serial ports.")
    return None


def main():
    ap = argparse.ArgumentParser(description="ThingSet auto-tester: discover writable params and exercise them.")
    ap.add_argument("--port", help="Serial port (auto-discover if omitted)")
    ap.add_argument("--baud", type=int, default=115200, help="Baud rate (default 115200)")
    ap.add_argument("--apply", action="store_true", help="Actually write values (otherwise probe only)")
    ap.add_argument("--exec", dest="do_exec", action="store_true", help="Execute x* nodes where present")
    ap.add_argument("--verbose", action="store_true", help="Verbose I/O logging")
    ap.add_argument("--use-thingset-prefix", action="store_true", help="Prefix all commands with 'thingset '")
    args = ap.parse_args()

    ser = discover_device(args.port, args.baud, args.verbose, args.use_thingset_prefix)
    if not ser:
        sys.exit(2)

    sh = ThingSetShell(ser, verbose=args.verbose, cmd_prefix=("thingset " if args.use_thingset_prefix else ""))
    assert sh.enter_thingset()

    nodes = sh.list_nodes()
    # Collect by kind ('w' and 's' are writable/update-able)
    w_nodes = [n for n in nodes if (not n.is_group and n.kind in ('w', 's'))]
    x_nodes = [n for n in nodes if (not n.is_group and n.kind == 'x')]

    print(f"Discovered {len(nodes)} nodes: {len(w_nodes)} writable, {len(x_nodes)} exec")

    # Probe and optionally exercise writable nodes
    errs = 0
    results: List[TestResult] = []
    for n in w_nodes:
        ok, resp = sh.get_value(n.path)
        if not ok:
            print(f"[WARN] Cannot read {n.path}")
            results.append(TestResult(path=n.path, success=False, note="unreadable"))
            continue
        vtype, sval = parse_scalar(resp or "")
        # Determine precision from the device response text to avoid sending more digits
        decimals = count_decimals(resp)
        print(f"- {n.path} => {sval} ({vtype})")
        if not args.apply:
            results.append(TestResult(path=n.path, success=False, note="skipped (--apply missing)"))
            continue
        tests = pick_test_values(vtype, sval, n.name)
        if not tests:
            results.append(TestResult(path=n.path, success=False, note="no test value"))
            continue
        node_ok = False
        for tv in tests:
            if vtype == "float":
                # Quantize to device-reported precision
                q = round(float(tv), decimals) if decimals > 0 else float(tv)
                sval_out = f"{q:.{decimals}f}" if decimals > 0 else str(q)
            else:
                sval_out = str(tv).lower() if isinstance(tv, bool) else str(tv)
            ok, txt = sh.set_value(n.path, sval_out)
            if not ok:
                print(f"  [ERR] set {n.path} {sval_out} failed")
                errs += 1
                # keep trying other values if any
                continue
            # Read back and print
            rok, rresp = sh.get_value(n.path)
            print(f"  set -> {rresp}")
            if rok:
                r_vtype, r_val = parse_scalar(rresp or "")
                # Compare against the quantized value we actually sent
                exp = q if vtype == "float" else tv
                if approx_equal(exp, r_val, vtype, decimals=decimals):
                    node_ok = True
        # Restore original value if changed
        if args.apply and tests:
            if vtype == "float":
                # Prefer using the original response formatting if available
                if resp and count_decimals(resp) > 0:
                    # Use the original token as-is (safe; shell parses numbers)
                    orig = resp.strip().split()[0]
                else:
                    orig = str(sval)
            else:
                orig = str(sval).lower() if isinstance(sval, bool) else str(sval)
            ok, _ = sh.set_value(n.path, orig)
            if not ok:
                print(f"  [WARN] restore of {n.path} to {orig} may have failed")
        results.append(TestResult(path=n.path, success=node_ok, note=("" if node_ok else "mismatch or set failed")))

    # Optionally exercise exec nodes
    if args.do_exec and x_nodes:
        print("\nExecuting exec nodes (x*):")
        for n in x_nodes:
            ok, txt = sh.exec_node(n.path)
            print(f"- exec {n.path}: {'OK' if ok else 'ERR'}")

    # Print summary for settable nodes
    print_summary(results)

    ser.close()
    if errs:
        sys.exit(1)


if __name__ == "__main__":
    main()
