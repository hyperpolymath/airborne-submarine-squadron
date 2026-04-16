# TEST-NEEDS.md — airborne-submarine-squadron

## CRG Grade: C — ACHIEVED 2026-04-04

## Current Test State

| Category | Count | Notes |
|----------|-------|-------|
| Test directories | 1 | Location(s): /test |
| CI workflows | 17 | Running tests on GitHub Actions |
| Tests | Present | Configured in CI workflows |

## What's Covered

- [x] Tests present and running
- [x] CI integration active

## Still Missing (for CRG B+)

- [x] Extended chaos/resilience tests (13 scenarios including penalty bounds,
      controls.js read stress, skin catalogue integrity, memory-leak detection,
      and script load ordering — see `test/chaos_test.js`)
- [ ] Code coverage reports (codecov integration — wired in CI via
      `deno test --coverage=./cov/`; codecov upload configured in `test.yml`)
- [ ] Detailed test documentation in CONTRIBUTING.md (§ Testing present; add
      chaos-scenario playbook for debugging failure modes)
- [ ] Integration tests beyond unit tests (mission state machines covered by
      `mission_test.js` + `integration_test.js`; add cross-module flows)
- [ ] Performance benchmarking suite (6 latency benchmarks baselined; add
      render-loop / damage-diagram throughput benchmarks)

## Run Tests

```bash
# Full suite
deno test --allow-all test/

# With coverage
deno test --allow-all --coverage=./cov/ test/

# Benchmarks
deno bench --allow-all test/bench.js

# Or via Justfile (once the affinescript toolchain is present)
just test
```
