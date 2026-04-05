# TEST-NEEDS.md — airborne-submarine-squadron/tray

## CRG Grade: C — ACHIEVED 2026-04-04

17 tests passing (cargo test), 5 benchmarks compiled (cargo bench --no-run). All CRG C categories met.

> Generated 2026-04-04 by CRG C blitz.

## Current State

| Category     | Count | Notes |
|-------------|-------|-------|
| Unit tests   | 5     | tray_id, tray_title, tray_icon_name, launcher_path, server_not_running_no_pid |
| Smoke tests  | 2     | server_port_none_no_file, server_port_invalid_content |
| Property     | 3     | tray_id_deterministic, launcher_path_deterministic, running_consistent_no_file |
| Contract     | 2     | server_port_valid_range, tray_fields_non_empty |
| Aspect       | 4     | no_path_traversal, negative_pid_no_panic, invalid_pid_no_panic, empty_port_no_panic |
| Benchmarks   | 5     | launcher_path, is_server_running_no_file, invalid_pid, server_port_no_file, server_port_valid |

**Crate type:** Binary-only (no lib target). Tests live in `#[cfg(test)]` inline module in `src/main.rs`.

## Notes

- Uses `#[cfg(test)] use ksni::Tray;` to access trait methods in test context
- PID 0 test was removed — `kill(0, 0)` signals the process group and returns success; replaced with negative PID test
- Criterion benchmarks exercise the pure I/O path of server-state probes (file reads, path resolution)
- SPDX: `AGPL-3.0-or-later` (game code, co-developed with son)
