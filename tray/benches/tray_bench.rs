// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
//
// Criterion benchmarks for airborne-tray utility functions.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use std::fs;
use std::io::Write;

fn bench_launcher_path(c: &mut Criterion) {
    c.bench_function("launcher_path", |b| {
        b.iter(|| {
            let exe = std::env::current_exe().unwrap_or_default();
            let path = exe
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.join("launcher.sh"))
                .unwrap_or_else(|| std::path::PathBuf::from("./launcher.sh"));
            black_box(path)
        })
    });
}

fn bench_is_server_running_no_file(c: &mut Criterion) {
    let pid_path = "/tmp/bench-airborne-server.pid";
    let _ = fs::remove_file(pid_path);
    c.bench_function("is_server_running_no_file", |b| {
        b.iter(|| {
            let result = std::path::Path::new(pid_path).exists();
            black_box(result)
        })
    });
}

fn bench_is_server_running_invalid_pid(c: &mut Criterion) {
    let pid_path = "/tmp/bench-airborne-server-invalid.pid";
    {
        let mut f = fs::File::create(pid_path).unwrap();
        writeln!(f, "not-a-pid").unwrap();
    }
    c.bench_function("is_server_running_invalid_pid", |b| {
        b.iter(|| {
            let result = fs::read_to_string(pid_path)
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok());
            black_box(result)
        })
    });
    let _ = fs::remove_file(pid_path);
}

fn bench_server_port_no_file(c: &mut Criterion) {
    let port_path = "/tmp/bench-airborne-server.port";
    let _ = fs::remove_file(port_path);
    c.bench_function("server_port_no_file", |b| {
        b.iter(|| {
            let result: Option<u16> = fs::read_to_string(port_path)
                .ok()
                .and_then(|s| s.trim().parse().ok());
            black_box(result)
        })
    });
}

fn bench_server_port_valid(c: &mut Criterion) {
    let port_path = "/tmp/bench-airborne-server-valid.port";
    {
        let mut f = fs::File::create(port_path).unwrap();
        writeln!(f, "8080").unwrap();
    }
    c.bench_function("server_port_valid", |b| {
        b.iter(|| {
            let result: Option<u16> = fs::read_to_string(port_path)
                .ok()
                .and_then(|s| s.trim().parse().ok());
            black_box(result)
        })
    });
    let _ = fs::remove_file(port_path);
}

criterion_group!(
    benches,
    bench_launcher_path,
    bench_is_server_running_no_file,
    bench_is_server_running_invalid_pid,
    bench_server_port_no_file,
    bench_server_port_valid,
);
criterion_main!(benches);
