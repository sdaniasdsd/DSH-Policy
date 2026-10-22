pub mod backup;
pub mod catalog;
pub mod catalog_update;
pub mod harness_home;
pub mod installed_dsh;
pub mod installer;
pub mod manager_state;
pub mod recovery;
pub mod transaction;

#[cfg(feature = "app")]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run DSH Policy Manager");
}

#[cfg(not(feature = "app"))]
pub fn run() {
    unreachable!("enable the app feature to run the Tauri application");
}
