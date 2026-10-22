pub mod backup;
pub mod catalog;
pub mod catalog_update;
pub mod harness_home;
pub mod installed_dsh;
pub mod installer;
pub mod launcher;
pub mod manager_state;
pub mod profile_mode;
pub mod recovery;
pub mod transaction;

#[cfg(feature = "app")]
mod commands;

#[cfg(feature = "app")]
pub fn run() {
    use std::sync::Arc;
    use tauri::Manager;

    tauri::Builder::default()
        .setup(|app| {
            let local_data = app.path().app_local_data_dir()?;
            let services =
                commands::ManagerServices::new(local_data).map_err(std::io::Error::other)?;
            app.manage(Arc::new(services));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_manager_state,
            commands::list_releases,
            commands::list_backups,
            commands::get_activity,
            commands::recover_transition,
            commands::refresh_catalog,
            commands::choose_home,
            commands::set_mode,
            commands::install_release,
            commands::restore_backup,
            commands::launch_dsh,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run DSH Policy Manager");
}

#[cfg(not(feature = "app"))]
pub fn run() {
    unreachable!("enable the app feature to run the Tauri application");
}
