use tauri::Manager;

pub mod brew;
pub mod catalog;
pub mod commands;
pub mod config;
pub mod discovery;
pub mod error;
pub mod operations;
mod process;
pub mod security;
pub mod services;
pub mod settings;
pub mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .manage(discovery::refresh::DiscoveryCoordinator::default())
        .manage(config::ConfigCoordinator::default())
        .manage(operations::OperationCoordinator::default())
        .manage(brew::actions::BrewActionCoordinator::default())
        .manage(services::actions::ServiceActionCoordinator::default())
        .manage(security::elevation::ElevationCoordinator::default())
        .manage(security::elevation_macos::MacOsElevationTransport)
        .setup(|app| {
            let settings_directory = app.path().app_config_dir()?;
            app.manage(settings::SettingsCoordinator::new(
                settings::SettingsStore::new(settings_directory),
            ));
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            let is_close_requested = matches!(event, tauri::WindowEvent::CloseRequested { .. });
            if !tray::should_hide_window_on_close(window.label(), is_close_requested) {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("failed to hide the main window: {error}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::catalog::list_managed_apps,
            commands::config::list_configs,
            commands::config::resolve_config_variants,
            commands::config::read_config,
            commands::config::diagnose_config,
            commands::config::validate_config,
            commands::config::preview_config_write,
            commands::config::preview_structured_config_write,
            commands::config::execute_config_write,
            commands::config::list_config_backups,
            commands::config::preview_restore_backup,
            commands::config::execute_restore_backup,
            commands::discovery::get_system_snapshot,
            commands::discovery::refresh_system_snapshot,
            commands::discovery::list_unmanaged_candidates,
            commands::discovery::export_sanitized_baseline,
            commands::brew::list_brew_packages,
            commands::brew::search_brew_packages,
            commands::brew::get_brew_package,
            commands::brew::preview_brew_action,
            commands::brew::execute_brew_action,
            commands::services::list_services,
            commands::services::get_service,
            commands::services::preview_service_action,
            commands::services::execute_service_action,
            commands::status::get_app_status,
            commands::elevation::get_helper_status,
            commands::elevation::register_helper,
            commands::elevation::unregister_helper,
            commands::elevation::e2e_fake_elevation_roundtrip,
            commands::operations::list_operations,
            commands::operations::get_operation,
            commands::operations::cancel_operation,
            commands::settings::get_preferences,
            commands::settings::update_preferences,
            commands::settings::reset_preferences
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
