// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
//
// System tray icon for Airborne Submarine Squadron.
// Uses ksni (KDE StatusNotifierItem) for native Wayland tray support.

use std::path::{Path, PathBuf};
use std::process::Command;

use ksni::blocking::TrayMethods;
use ksni::menu::StandardItem;

const PID_FILE: &str = "/tmp/airborne-server.pid";
const PORT_FILE: &str = "/tmp/airborne-server.port";

/// Resolve the launcher.sh path relative to this binary's location.
fn launcher_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    // Binary is at tray/target/release/airborne-tray
    // Launcher is at ../../launcher.sh (relative to tray/)
    exe.parent() // target/release/
        .and_then(|p| p.parent()) // target/
        .and_then(|p| p.parent()) // tray/
        .and_then(|p| p.parent()) // airborne-submarine-squadron/
        .map(|p| p.join("launcher.sh"))
        .unwrap_or_else(|| PathBuf::from("./launcher.sh"))
}

/// Check whether the game server is currently running.
fn is_server_running() -> bool {
    let pid_path = Path::new(PID_FILE);
    if !pid_path.exists() {
        return false;
    }
    if let Ok(pid_str) = std::fs::read_to_string(pid_path) {
        if let Ok(pid) = pid_str.trim().parse::<i32>() {
            // Check if process exists via kill -0
            unsafe { libc::kill(pid, 0) == 0 }
        } else {
            false
        }
    } else {
        false
    }
}

/// Read the current server port, if running.
fn server_port() -> Option<u16> {
    std::fs::read_to_string(PORT_FILE)
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

/// The tray icon definition.
#[derive(Debug)]
struct AirborneTray;

impl ksni::Tray for AirborneTray {
    fn id(&self) -> String {
        "airborne-submarine-squadron".to_string()
    }

    fn title(&self) -> String {
        "Airborne Submarine Squadron".to_string()
    }

    fn icon_name(&self) -> String {
        "airborne-submarine-squadron".to_string()
    }

    fn tool_tip(&self) -> ksni::ToolTip {
        let status = if is_server_running() {
            format!("Server running on port {}", server_port().unwrap_or(0))
        } else {
            "Server stopped".to_string()
        };
        ksni::ToolTip {
            icon_name: "airborne-submarine-squadron".to_string(),
            title: "Airborne Submarine Squadron".to_string(),
            description: status,
            icon_pixmap: Vec::new(),
        }
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        let running = is_server_running();
        let status_label = if running {
            format!(
                "Server: running (port {})",
                server_port().unwrap_or(0)
            )
        } else {
            "Server: stopped".to_string()
        };

        vec![
            StandardItem {
                label: "Launch in Browser".to_string(),
                activate: Box::new(|_| {
                    let launcher = launcher_path();
                    let _ = Command::new(&launcher).arg("--browser").spawn();
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Launch CLI Mode".to_string(),
                activate: Box::new(|_| {
                    let launcher = launcher_path();
                    // Open a terminal for CLI mode
                    let _ = Command::new("konsole")
                        .arg("-e")
                        .arg(&launcher)
                        .arg("--cli")
                        .spawn()
                        .or_else(|_| {
                            Command::new("xterm")
                                .arg("-e")
                                .arg(&launcher)
                                .arg("--cli")
                                .spawn()
                        });
                }),
                ..Default::default()
            }
            .into(),
            ksni::MenuItem::Separator,
            StandardItem {
                label: status_label,
                enabled: false,
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "Stop Server".to_string(),
                enabled: running,
                activate: Box::new(|_| {
                    let launcher = launcher_path();
                    let _ = Command::new(&launcher).arg("--stop").output();
                }),
                ..Default::default()
            }
            .into(),
            ksni::MenuItem::Separator,
            StandardItem {
                label: "Quit".to_string(),
                icon_name: "application-exit".to_string(),
                activate: Box::new(|_| {
                    // Stop server if running, then exit
                    let launcher = launcher_path();
                    let _ = Command::new(&launcher).arg("--stop").output();
                    std::process::exit(0);
                }),
                ..Default::default()
            }
            .into(),
        ]
    }
}

fn main() {
    let _handle = AirborneTray.spawn().expect("failed to initialise system tray");
    // Block forever — tray runs in background thread
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}
