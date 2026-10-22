pub mod catalog;
pub mod catalog_update;
pub mod installed_dsh;
pub mod manager_state;

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
