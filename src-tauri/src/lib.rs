use tauri::{Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

use crate::tray::CloseRequestAction;

pub mod brew;
pub mod catalog;
pub mod commands;
pub mod config;
pub mod discovery;
pub mod environment;
pub mod error;
pub mod grants;
pub mod lifecycle;
pub mod operations;
pub mod process;
pub mod process_session;
pub mod security;
pub mod services;
pub mod settings;
pub mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The dialog plugin serves backend-initiated pickers only; the capability
    // file grants the frontend no dialog or fs permission.
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .menu(tray::application_menu)
        .on_menu_event(|app, event| tray::handle_menu_event(app, event.id().as_ref()))
        .manage(discovery::refresh::DiscoveryCoordinator::default())
        .manage(config::ConfigCoordinator::default())
        .manage(operations::OperationCoordinator::default())
        .manage(lifecycle::LifecycleCoordinator::default())
        .manage(grants::ResourceWriteCoordinator::default())
        .manage(environment::save::EnvironmentEditCoordinator::default())
        .manage(environment::zsh_edit::ZshEditCoordinator::default())
        .manage(brew::actions::BrewActionCoordinator::default())
        .manage(services::actions::ServiceActionCoordinator::default())
        .manage(services::create::ServiceCreateCoordinator::default())
        .manage(security::elevation::ElevationCoordinator::default())
        .manage(security::elevation_macos::MacOsElevationTransport)
        .setup(|app| {
            let settings_directory = app.path().app_config_dir()?;
            app.manage(grants::GrantCoordinator::new(
                grants::GrantStore::new(settings_directory.clone()),
                commands::grants::canonical_home(),
            ));
            let settings = settings::SettingsCoordinator::new(settings::SettingsStore::new(
                settings_directory,
            ));
            let preferences = settings
                .get()
                .map(|loaded| loaded.preferences().clone())
                .unwrap_or_else(|error| {
                    eprintln!("failed to load startup preferences: {error:?}");
                    settings::UserPreferences::default()
                });
            let discovery = app.state::<discovery::refresh::DiscoveryCoordinator>();
            discovery.set_timeout_preset(preferences.provider_timeout_preset());
            discovery.set_optional_discovery_roots(preferences.optional_discovery_roots());
            app.manage(settings);
            let window = WebviewWindowBuilder::new(
                app,
                tray::MAIN_WINDOW_LABEL,
                WebviewUrl::App("index.html".into()),
            )
            .title("UserHome")
            .inner_size(1120.0, 720.0)
            .min_inner_size(1120.0, 720.0)
            .center()
            .resizable(true)
            .maximizable(false)
            .decorations(true)
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true)
            .visible(preferences.open_window_on_launch())
            .build()?;
            // Normalize macOS overlay-window geometry after native creation.
            window.set_size(tauri::LogicalSize::new(1120.0, 720.0))?;
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            let is_close_requested = matches!(event, tauri::WindowEvent::CloseRequested { .. });
            match tray::close_request_action(
                window.app_handle(),
                window.label(),
                is_close_requested,
            ) {
                CloseRequestAction::Hide => {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Err(error) = window.hide() {
                            eprintln!("failed to hide the main window: {error}");
                        }
                    }
                }
                CloseRequestAction::Quit => lifecycle::request_quit(window.app_handle()),
                CloseRequestAction::Ignore => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::application_config::get_configuration_apps,
            commands::application_config::list_configuration_resources,
            commands::application_config::read_configuration_resource,
            commands::settings::get_discovery_exclusions,
            commands::settings::update_discovery_exclusions,
            commands::catalog::list_managed_apps,
            commands::catalog::query_managed_apps,
            commands::catalog::get_managed_app,
            commands::config::list_configs,
            commands::config::resolve_config_variants,
            commands::config::read_config,
            commands::config::get_config_schema,
            commands::config::diagnose_config,
            commands::config::validate_config,
            commands::config::preview_config_write,
            commands::config::preview_structured_config_write,
            commands::config::preview_schema_config_write,
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
            commands::services::list_launchd_services,
            commands::services::get_service,
            commands::services::preview_create_launchd_service,
            commands::services::execute_create_launchd_service,
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
            commands::settings::reset_preferences,
            commands::settings::get_diagnostics_report,
            commands::settings::export_diagnostics_report,
            commands::settings::get_backup_storage,
            commands::settings::preview_clear_backups,
            commands::settings::execute_clear_backups,
            commands::grants::list_grants,
            commands::grants::revoke_grant,
            commands::grants::get_grant_store_status,
            commands::grants::reset_grant_store,
            commands::grants::select_directory_grant,
            commands::grants::select_file_grant,
            commands::grants::select_save_location_grant,
            commands::environment::scan_environment_files,
            commands::environment::read_environment_file,
            commands::environment::reveal_environment_value,
            commands::environment::preview_environment_edit,
            commands::environment::preview_environment_create,
            commands::environment::execute_environment_edit,
            commands::environment::read_zsh_startup_files,
            commands::environment::reveal_zsh_value,
            commands::environment::read_zsh_edit_state,
            commands::environment::enable_zsh_edit,
            commands::environment::preview_zsh_edit,
            commands::environment::execute_zsh_edit,
            commands::resources::preview_resource_writes,
            commands::resources::execute_resource_write,
            commands::resources::get_resource_write_batch,
            commands::lifecycle::confirm_quit,
            commands::lifecycle::cancel_quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // A quit nobody routed through the lifecycle entry (a system quit, for
            // example) is held back and sent through it. Programmatic exits carry
            // a code and have already passed the entry.
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
                lifecycle::request_quit(app);
            }
        });
}
