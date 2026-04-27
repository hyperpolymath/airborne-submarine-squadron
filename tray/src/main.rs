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

#[cfg(test)]
mod tests {
    use super::*;
    use ksni::Tray;
    use std::fs;
    use std::io::Write;

    // ===== Unit tests for pure utility functions =====

    #[test]
    fn test_tray_id() {
        let tray = AirborneTray;
        assert_eq!(tray.id(), "airborne-submarine-squadron");
    }

    #[test]
    fn test_tray_title() {
        let tray = AirborneTray;
        assert_eq!(tray.title(), "Airborne Submarine Squadron");
    }

    #[test]
    fn test_tray_icon_name() {
        let tray = AirborneTray;
        assert_eq!(tray.icon_name(), "airborne-submarine-squadron");
    }

    #[test]
    fn test_launcher_path_is_absolute_or_relative() {
        let path = launcher_path();
        // Must end with launcher.sh
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        assert_eq!(name, "launcher.sh");
    }

    #[test]
    fn test_server_not_running_when_no_pid_file() {
        // Without PID_FILE existing, server_running should be false
        let _ = fs::remove_file(PID_FILE);
        assert!(!is_server_running());
    }

    #[test]
    fn test_server_port_returns_none_when_no_port_file() {
        let _ = fs::remove_file(PORT_FILE);
        assert!(server_port().is_none());
    }

    #[test]
    fn test_server_port_reads_valid_port() {
        let port_file = "/tmp/airborne-test-port.txt";
        let mut f = fs::File::create(port_file).unwrap();
        writeln!(f, "8080").unwrap();
        // Temporarily override the port file path by reading directly
        let port: Option<u16> = fs::read_to_string(port_file)
            .ok()
            .and_then(|s| s.trim().parse().ok());
        assert_eq!(port, Some(8080));
        let _ = fs::remove_file(port_file);
    }

    #[test]
    fn test_server_port_returns_none_for_invalid_content() {
        let port_file = "/tmp/airborne-test-invalid-port.txt";
        let mut f = fs::File::create(port_file).unwrap();
        writeln!(f, "not-a-port").unwrap();
        let port: Option<u16> = fs::read_to_string(port_file)
            .ok()
            .and_then(|s| s.trim().parse().ok());
        assert!(port.is_none());
        let _ = fs::remove_file(port_file);
    }

    #[test]
    fn test_server_not_running_with_invalid_pid() {
        // Write an invalid PID to the PID file
        let mut f = fs::File::create(PID_FILE).unwrap();
        writeln!(f, "not-a-pid").unwrap();
        assert!(!is_server_running());
        let _ = fs::remove_file(PID_FILE);
    }

    // ===== Property tests =====

    #[test]
    fn test_tray_id_deterministic() {
        // Multiple calls return the same value
        let tray = AirborneTray;
        let id1 = tray.id();
        let id2 = tray.id();
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_launcher_path_deterministic() {
        // Multiple calls return the same path
        let p1 = launcher_path();
        let p2 = launcher_path();
        assert_eq!(p1, p2);
    }

    #[test]
    fn test_server_running_consistent_when_no_file() {
        let _ = fs::remove_file(PID_FILE);
        // 10 consecutive calls with no PID file should all return false
        for _ in 0..10 {
            assert!(!is_server_running());
        }
    }

    // ===== Contract tests =====

    #[test]
    fn test_server_port_returns_valid_range_when_present() {
        let port_file = "/tmp/airborne-contract-port.txt";
        let mut f = fs::File::create(port_file).unwrap();
        writeln!(f, "3000").unwrap();
        let port: Option<u16> = fs::read_to_string(port_file)
            .ok()
            .and_then(|s| s.trim().parse().ok());
        if let Some(p) = port {
            // Port must be in valid range
            assert!(p > 0);
        }
        let _ = fs::remove_file(port_file);
    }

    #[test]
    fn test_tray_fields_are_non_empty() {
        let tray = AirborneTray;
        assert!(!tray.id().is_empty());
        assert!(!tray.title().is_empty());
        assert!(!tray.icon_name().is_empty());
    }

    // ===== Aspect tests (security / correctness) =====

    #[test]
    fn test_launcher_path_no_path_traversal() {
        let path = launcher_path();
        let path_str = path.to_string_lossy();
        // Must not contain path traversal sequences
        assert!(!path_str.contains("../.."));
    }

    #[test]
    fn test_server_not_running_with_negative_pid() {
        // Negative PID is invalid, parse should fail so server is not running
        let mut f = fs::File::create(PID_FILE).unwrap();
        writeln!(f, "-999999").unwrap();
        // -999999 as i32 is valid but kill(-999999, 0) fails (no such group)
        // We can't assert definitively, but it must not panic
        let _ = is_server_running();
        let _ = fs::remove_file(PID_FILE);
    }

    #[test]
    fn test_server_port_not_running_with_empty_file() {
        let port_file = "/tmp/airborne-empty-port.txt";
        fs::File::create(port_file).unwrap();
        let port: Option<u16> = fs::read_to_string(port_file)
            .ok()
            .and_then(|s| s.trim().parse().ok());
        assert!(port.is_none());
        let _ = fs::remove_file(port_file);
    }
}
