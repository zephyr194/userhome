use tauri::{
    AppHandle, Emitter, Manager, Wry,
    menu::{Menu, MenuBuilder, MenuItem, SubmenuBuilder},
    tray::TrayIconBuilder,
};

use crate::{
    discovery::refresh::DiscoverySnapshot,
    services::inventory::{ServiceState, ServiceSummary},
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "userhome";
const OPEN_MENU_ID: &str = "userhome.tray.open";
const REFRESH_MENU_ID: &str = "userhome.tray.refresh";
const APPLICATIONS_MENU_ID: &str = "userhome.tray.applications";
const SERVICES_MENU_ID: &str = "userhome.tray.services";
const QUIT_MENU_ID: &str = "userhome.tray.quit";
const SETTINGS_MENU_ID: &str = "userhome.app.settings";
const APP_REFRESH_MENU_ID: &str = "userhome.app.refresh";
const HIDE_MENU_ID: &str = "userhome.app.hide";
const SHOW_MENU_ID: &str = "userhome.app.show";
const APP_QUIT_MENU_ID: &str = "userhome.app.quit";
const SETTINGS_REQUESTED_EVENT: &str = "userhome://settings-requested";
const REFRESH_REQUESTED_EVENT: &str = "userhome://refresh-requested";
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../../icons/tray-template.png");

struct TraySummary {
    applications: MenuItem<Wry>,
    services: MenuItem<Wry>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TrayAction {
    Open,
    Settings,
    Refresh,
    Hide,
    Quit,
    Ignore,
}

pub fn menu_action(menu_id: &str) -> TrayAction {
    match menu_id {
        OPEN_MENU_ID => TrayAction::Open,
        SETTINGS_MENU_ID => TrayAction::Settings,
        REFRESH_MENU_ID | APP_REFRESH_MENU_ID => TrayAction::Refresh,
        HIDE_MENU_ID => TrayAction::Hide,
        SHOW_MENU_ID => TrayAction::Open,
        QUIT_MENU_ID | APP_QUIT_MENU_ID => TrayAction::Quit,
        _ => TrayAction::Ignore,
    }
}

pub fn should_hide_window_on_close(window_label: &str, is_close_requested: bool) -> bool {
    window_label == MAIN_WINDOW_LABEL && is_close_requested
}

pub fn application_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let settings = MenuItem::with_id(
        app,
        SETTINGS_MENU_ID,
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let refresh = MenuItem::with_id(
        app,
        APP_REFRESH_MENU_ID,
        "Refresh",
        true,
        Some("CmdOrCtrl+R"),
    )?;
    let hide = MenuItem::with_id(
        app,
        HIDE_MENU_ID,
        "Hide UserHome",
        true,
        Some("CmdOrCtrl+H"),
    )?;
    let show = MenuItem::with_id(app, SHOW_MENU_ID, "Show UserHome", true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        APP_QUIT_MENU_ID,
        "Quit UserHome",
        true,
        Some("CmdOrCtrl+Q"),
    )?;

    let application = SubmenuBuilder::new(app, "UserHome")
        .item(&settings)
        .separator()
        .item(&hide)
        .item(&show)
        .separator()
        .item(&quit)
        .build()?;
    let view = SubmenuBuilder::new(app, "View").item(&refresh).build()?;

    MenuBuilder::new(app).item(&application).item(&view).build()
}

pub fn handle_menu_event(app: &AppHandle, menu_id: &str) {
    handle_action(app, menu_action(menu_id));
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let applications = MenuItem::with_id(
        app,
        APPLICATIONS_MENU_ID,
        application_summary_label(None),
        false,
        None::<&str>,
    )?;
    let services = MenuItem::with_id(
        app,
        SERVICES_MENU_ID,
        service_summary_label(None),
        false,
        None::<&str>,
    )?;
    let menu = MenuBuilder::new(app)
        .text(OPEN_MENU_ID, "Open UserHome")
        .text(REFRESH_MENU_ID, "Refresh")
        .separator()
        .item(&applications)
        .item(&services)
        .separator()
        .text(QUIT_MENU_ID, "Quit UserHome")
        .build()?;

    let tray_icon = tauri::image::Image::from_bytes(TRAY_ICON_BYTES)?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("UserHome")
        .icon(tray_icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| handle_action(app, menu_action(event.id().as_ref())));

    tray.build(app)?;
    app.manage(TraySummary {
        applications,
        services,
    });
    Ok(())
}

pub fn update_application_summary(app: &AppHandle, snapshot: &DiscoverySnapshot) {
    let summary = app.state::<TraySummary>();
    if let Err(error) = summary
        .applications
        .set_text(application_summary_label(snapshot.application_counts()))
    {
        eprintln!("failed to update the tray application summary: {error}");
    }
}

pub fn update_service_summary(app: &AppHandle, services: Result<&[ServiceSummary], ()>) {
    let summary = app.state::<TraySummary>();
    let counts = services.ok().map(|services| {
        (
            services
                .iter()
                .filter(|service| service.state() == ServiceState::Started)
                .count(),
            services.len(),
        )
    });
    if let Err(error) = summary.services.set_text(service_summary_label(counts)) {
        eprintln!("failed to update the tray service summary: {error}");
    }
}

fn application_summary_label(counts: Option<(usize, usize, bool)>) -> String {
    match counts {
        Some((detected, total, partial)) => format!(
            "Applications: {detected}/{total} detected{}",
            if partial { " (partial)" } else { "" }
        ),
        None => "Applications: unavailable".to_owned(),
    }
}

fn service_summary_label(counts: Option<(usize, usize)>) -> String {
    match counts {
        Some((running, total)) => format!("Services: {running}/{total} running"),
        None => "Services: not loaded".to_owned(),
    }
}

fn handle_action(app: &tauri::AppHandle, action: TrayAction) {
    match action {
        TrayAction::Open => {
            show_main_window(app);
        }
        TrayAction::Settings => {
            show_main_window(app);
            emit_command(app, SETTINGS_REQUESTED_EVENT, "settings");
        }
        TrayAction::Refresh => {
            emit_command(app, REFRESH_REQUESTED_EVENT, "refresh");
        }
        TrayAction::Hide => {
            let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
                eprintln!("failed to hide the main window: window not found");
                return;
            };
            if let Err(error) = window.hide() {
                eprintln!("failed to hide the main window: {error}");
            }
        }
        TrayAction::Quit => app.exit(0),
        TrayAction::Ignore => {}
    }
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        eprintln!("failed to show the main window: window not found");
        return;
    };

    if let Err(error) = window.show() {
        eprintln!("failed to show the main window: {error}");
        return;
    }
    if let Err(error) = window.unminimize() {
        eprintln!("failed to restore the main window: {error}");
        return;
    }
    if let Err(error) = window.set_focus() {
        eprintln!("failed to focus the main window: {error}");
    }
}

fn emit_command(app: &AppHandle, event_name: &str, command_name: &str) {
    if let Err(error) = app.emit(event_name, ()) {
        eprintln!("failed to emit the {command_name} request: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{application_summary_label, service_summary_label};

    #[test]
    fn tray_summaries_are_read_only_status_labels() {
        assert_eq!(
            application_summary_label(Some((4, 6, true))),
            "Applications: 4/6 detected (partial)"
        );
        assert_eq!(service_summary_label(Some((1, 3))), "Services: 1/3 running");
        assert_eq!(service_summary_label(None), "Services: not loaded");
    }
}
