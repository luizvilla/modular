#!/usr/bin/env python3
"""
Build ThingSet JSON trees for power converters over a serial link.

This mirrors the behaviour of the CAN-based discovery (`js/scan.js` + `js/query_nodes.js`),
but talks to the ThingSet shell over UART using text mode commands. The script connects to
an available serial port, walks the ThingSet hierarchy, attempts to resolve numeric data
item IDs, and writes `thingset/node_XX_tree.json` plus updates `thingset/nodes.json`.

Example:
    python thingset_autotest/serial_tree_builder.py --port /dev/ttyACM0 --baud 115200
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

if __package__ is None:  # pragma: no cover - direct execution from file
    sys.path.append(os.path.dirname(__file__))
    from thingset_autotest import ThingSetShell, discover_device, parse_scalar  # type: ignore
else:  # pragma: no cover - execution as module
    from . import ThingSetShell, discover_device, parse_scalar


def _normalize_path(path: str) -> str:
    if path in ("", "/"):
        return ""
    return path.strip("/")


def _parent_path(path: str) -> str:
    if path in ("", "/"):
        return "/"
    stripped = path.strip("/")
    if not stripped or "/" not in stripped:
        return "/"
    return "/" + stripped.rsplit("/", 1)[0]


def _path_depth(path: str) -> int:
    if path in ("", "/"):
        return 0
    return len([seg for seg in path.strip("/").split("/") if seg])


def _format_id(num: Optional[int]) -> Optional[str]:
    if num is None:
        return None
    try:
        return f"0x{int(num):X}"
    except Exception:
        return None


def _parse_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):  # bool is subclass of int
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        return None
    if isinstance(value, str):
        txt = value.strip()
        if not txt:
            return None
        try:
            return int(txt, 0)
        except Exception:
            return None
    return None


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    # Fallback to string representation for unsupported types
    return str(value)


@dataclass
class Entry:
    node_id: Optional[int]
    scalar: Optional[Any]
    sequence: Optional[List[Any]]
    values: Dict[str, Any]


class ThingSetTreeBuilder:
    def __init__(self, shell: ThingSetShell, verbose: bool = False):
        self.shell = shell
        self.verbose = verbose
        self._entry_cache: Dict[str, Entry] = {}
        self._id_cache: Dict[str, Optional[int]] = {}
        self._child_map: Dict[str, Set[str]] = {}
        self._nodes = self.shell.list_nodes()
        for node in self._nodes:
            parent = _parent_path(node.path)
            self._child_map.setdefault(parent, set()).add(node.name)

    def _dbg(self, msg: str) -> None:
        if self.verbose:
            print(f"[tree] {msg}")

    def _fetch_id_via_fetch(self, path: str) -> Optional[int]:
        if path in self._id_cache:
            return self._id_cache[path]
        if path in ("", "/"):
            self._id_cache[path] = 0
            return 0
        norm = _normalize_path(path)
        if not norm:
            self._id_cache[path] = 0
            return 0
        payload = json.dumps([norm])
        for selector in ("0x16", "22"):
            try:
                out = self.shell.send_cmd(f"fetch {selector} {payload}", read_timeout=1.5)
                js = self.shell._extract_json(out.decode(errors="ignore"))  # type: ignore[attr-defined]
            except Exception:
                js = None
            if isinstance(js, list) and js:
                candidate = js[0]
                num = _parse_int(candidate)
                if num is not None:
                    self._id_cache[path] = num
                    return num
        self._id_cache[path] = None
        return None

    def _inspect(self, path: str) -> Entry:
        if path in self._entry_cache:
            return self._entry_cache[path]
        node_id: Optional[int] = None
        scalar: Optional[Any] = None
        sequence: Optional[List[Any]] = None
        values: Dict[str, Any] = {}
        data: Any = None
        try:
            data = self.shell._q_fetch(path)  # type: ignore[attr-defined]
        except Exception:
            data = None
        if isinstance(data, dict):
            tmp = dict(data)
            node_id = _parse_int(tmp.pop("_id", None))
            values = tmp
        elif isinstance(data, list):
            sequence = data
        elif data is not None:
            scalar = data
        if scalar is None and sequence is None and not values:
            ok, txt = self.shell.get_value(path)
            if ok and txt is not None:
                _, parsed = parse_scalar(txt)
                scalar = parsed
        if node_id is None:
            node_id = self._fetch_id_via_fetch(path)
        entry = Entry(node_id=node_id, scalar=scalar, sequence=sequence, values=values)
        self._entry_cache[path] = entry
        return entry

    def _group_values(self, path: str, entry: Entry) -> Dict[str, Any]:
        if not entry.values:
            return {}
        child_names = self._child_map.get(path, set())
        out: Dict[str, Any] = {}
        for key, val in entry.values.items():
            if key.startswith("_"):
                continue
            if key in child_names:
                continue
            out[str(key)] = _sanitize(val)
        return out

    def _create_group(self, path: str) -> Dict[str, Any]:
        entry = self._inspect(path)
        node: Dict[str, Any] = {}
        node_id = entry.node_id if entry.node_id is not None else (0 if path in ("", "/") else None)
        node["id"] = _format_id(node_id)
        norm = _normalize_path(path)
        if norm:
            node["path"] = norm
        values = self._group_values(path, entry)
        node["values"] = values if values else {}
        node["children"] = {}
        if entry.scalar is not None and not self._child_map.get(path):
            node["value"] = _sanitize(entry.scalar)
        elif entry.sequence is not None and not self._child_map.get(path):
            node["value"] = _sanitize(entry.sequence)
        return node

    def _create_leaf(self, path: str) -> Dict[str, Any]:
        entry = self._inspect(path)
        node: Dict[str, Any] = {}
        node["id"] = _format_id(entry.node_id)
        node["path"] = _normalize_path(path)
        value: Any = None
        if entry.scalar is not None:
            value = entry.scalar
        elif entry.sequence is not None:
            value = entry.sequence
        elif entry.values:
            if "value" in entry.values and len(entry.values) == 1:
                value = entry.values["value"]
            else:
                filtered = {k: v for k, v in entry.values.items() if not str(k).startswith("_")}
                value = filtered if filtered else None
        node["value"] = _sanitize(value)
        return node

    def build(self) -> Dict[str, Any]:
        tree_root = self._create_group("/")
        tree_map: Dict[str, Dict[str, Any]] = {"/": tree_root}
        nodes_sorted = sorted(self._nodes, key=lambda n: (_path_depth(n.path), 0 if n.is_group else 1))
        for node in nodes_sorted:
            parent = _parent_path(node.path)
            parent_obj = tree_map.get(parent)
            if parent_obj is None:
                parent_obj = self._create_group(parent)
                tree_map[parent] = parent_obj
                grand = _parent_path(parent)
                if grand in tree_map:
                    grand_obj = tree_map[grand]
                    grand_obj.setdefault("children", {})[parent.strip("/").split("/")[-1]] = parent_obj
            if node.is_group:
                group_obj = self._create_group(node.path)
                parent_obj.setdefault("children", {})[node.name] = group_obj
                tree_map[node.path] = group_obj
            else:
                leaf_obj = self._create_leaf(node.path)
                parent_obj.setdefault("children", {})[node.name] = leaf_obj
                tree_map[node.path] = leaf_obj
        return tree_root

    def cached_entry(self, path: str) -> Entry:
        return self._inspect(path)


def _update_nodes_mapping(addr: int, node_uid: str, base_dir: Path) -> None:
    out_dir = base_dir / "thingset"
    out_dir.mkdir(parents=True, exist_ok=True)
    mapping_path = out_dir / "nodes.json"
    data: Dict[str, Any] = {}
    if mapping_path.exists():
        try:
            data = json.loads(mapping_path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    data[str(addr)] = node_uid
    ordered = {k: data[k] for k in sorted(data.keys(), key=lambda x: int(x, 10)) if k.isdigit()}
    for k, v in data.items():
        if not k.isdigit():
            ordered[k] = v
    mapping_path.write_text(json.dumps(ordered, indent=2), encoding="utf-8")


def _resolve_node_uid(builder: ThingSetTreeBuilder) -> Optional[str]:
    entry = builder.cached_entry("/pNodeID")
    if entry.scalar is not None:
        return str(entry.scalar)
    if entry.values:
        val = entry.values.get("value") or entry.values.get("pNodeID")
        if val is not None:
            return str(val)
    return None


def _resolve_node_name(builder: ThingSetTreeBuilder) -> Optional[str]:
    entry = builder.cached_entry("/pNodeName")
    if entry.scalar is not None:
        return str(entry.scalar)
    if entry.values:
        val = entry.values.get("value") or entry.values.get("pNodeName")
        if val is not None:
            return str(val)
    return None


def _resolve_node_addr(builder: ThingSetTreeBuilder) -> Optional[int]:
    entry = builder.cached_entry("/Networking/pCANNodeAddr")
    candidate: Optional[int] = None
    if entry.scalar is not None:
        candidate = _parse_int(entry.scalar)
    if candidate is None and entry.values:
        for key in ("value", "pCANNodeAddr"):
            val = entry.values.get(key)
            if val is not None:
                candidate = _parse_int(val)
                if candidate is not None:
                    break
    return candidate


def main(argv: Optional[Iterable[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Build ThingSet JSON tree via serial shell")
    ap.add_argument("--port", help="Serial port (auto-discover if omitted)")
    ap.add_argument("--baud", type=int, default=115200, help="Baud rate (default 115200)")
    ap.add_argument("--address", type=lambda x: int(x, 0), help="Override CAN node address (hex or dec)")
    ap.add_argument("--out-dir", default=".", help="Base directory for thingset output (default: current working dir)")
    ap.add_argument("--verbose", action="store_true", help="Verbose logging")
    ap.add_argument("--use-thingset-prefix", action="store_true", help="Prefix commands with 'thingset '")
    args = ap.parse_args(list(argv) if argv is not None else None)

    ser = discover_device(args.port, args.baud, args.verbose, args.use_thingset_prefix)
    if ser is None:
        print("Failed to connect to ThingSet shell", file=sys.stderr)
        return 2

    try:
        shell = ThingSetShell(ser, verbose=args.verbose, cmd_prefix=("thingset " if args.use_thingset_prefix else ""))
        if not shell.enter_thingset():
            print("ThingSet prompt not detected", file=sys.stderr)
            return 3
        builder = ThingSetTreeBuilder(shell, verbose=args.verbose)
        root = builder.build()

        node_uid = _resolve_node_uid(builder)
        node_name = _resolve_node_name(builder)
        node_addr = args.address if args.address is not None else _resolve_node_addr(builder)

        if node_uid is None:
            print("Warning: Unable to read /pNodeID; using 'UNKNOWN'", file=sys.stderr)
            node_uid = "UNKNOWN"
        if node_addr is None:
            print("Error: Unable to determine CAN node address (use --address)", file=sys.stderr)
            return 4

        addr_hex = f"0x{node_addr:02X}"
        if node_name:
            print(f"Device: {node_name} ({node_uid}) @ {addr_hex}")
        else:
            print(f"Device UID {node_uid} @ {addr_hex}")

        base_dir = Path(args.out_dir).resolve()
        thingset_dir = base_dir / "thingset"
        thingset_dir.mkdir(parents=True, exist_ok=True)
        out_path = thingset_dir / f"node_{node_addr:02X}_tree.json"
        payload = {
            "node_uid": node_uid,
            "address": addr_hex,
            "root": root,
        }
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"Wrote {out_path.relative_to(base_dir)}")

        _update_nodes_mapping(node_addr, node_uid, base_dir)
    finally:
        try:
            ser.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
