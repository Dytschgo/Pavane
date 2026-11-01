#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = pavane_lib::run_provider_host() {
        std::process::exit(code);
    }
    pavane_lib::run()
}
