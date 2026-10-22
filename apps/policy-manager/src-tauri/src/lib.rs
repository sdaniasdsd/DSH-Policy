pub mod catalog;
pub mod catalog_update;

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
