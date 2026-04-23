# DEMS Security PoC

Automated, read-only proof-of-concept demonstrating the critical
information-disclosure findings from
[`../SECURITY_AUDIT_2026-04-22.md`](../SECURITY_AUDIT_2026-04-22.md).

## Scope

| Finding | Severity | Check |
|---------|----------|-------|
| C-01    | critical | Check-in code leaked via `GET /api/events/:id` |
| C-02    | critical | Draft/archived/cancelled events leaked via `?status=` |
| M-05    | medium   | Public comments endpoint |
| INFO    | info     | Server fingerprint |

Only `GET` requests are issued. No mutation, no credentials, no rate-limit
evasion, no data exfiltration beyond what is printed locally.

## Requirements

- Python 3.9+
- `pip install requests`

## Usage

```bash
# Simple run against a local dev server
python3 dems_poc.py --target http://localhost:3000

# Machine-readable report
python3 dems_poc.py --target https://dems.example.com --json report.json

# Verbose trace for debugging the PoC itself
python3 dems_poc.py --target http://localhost:3000 -vv

# Skip TLS verification in lab environments (never in production)
python3 dems_poc.py --target https://staging.internal --no-verify-tls

# Run only a subset of checks
python3 dems_poc.py --target http://localhost:3000 --only checkin,drafts
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | no vulnerabilities confirmed (informational findings ignored) |
| 1    | at least one vulnerability confirmed |
| 2    | usage / runtime error (bad args, network failure before any probe succeeded) |

## Validating a fix

1. Apply the proposed remediation from the audit.
2. Restart DEMS.
3. Re-run `python3 dems_poc.py --target <url>`.
4. Expect C-01 / C-02 / M-05 to report `(not confirmed)` and the exit code
   to be `0`.

## Rules of engagement

- Only run against systems you own or are explicitly authorised to test.
- The script is intended for pre-production / staging verification of
  patches; production traffic is generally allowed because the calls are
  idempotent, but the rate-limiter on `/api/` will kick in at 200
  requests / 15 min, so schedule accordingly.
- Do **not** publish JSON reports externally; they contain check-in codes
  and draft-event titles extracted from the target.
