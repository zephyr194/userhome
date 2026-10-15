use userhome_lib::tray::{TrayAction, menu_action, should_hide_window_on_close};

#[test]
fn tray_menu_only_maps_allowed_actions() {
    assert_eq!(menu_action("userhome.tray.open"), TrayAction::Open);
    assert_eq!(menu_action("userhome.tray.refresh"), TrayAction::Refresh);
    assert_eq!(menu_action("userhome.tray.quit"), TrayAction::Quit);
    assert_eq!(menu_action("userhome.tray.status"), TrayAction::Ignore);
    assert_eq!(menu_action("quit"), TrayAction::Ignore);
    assert_eq!(menu_action("install"), TrayAction::Ignore);
}

#[test]
fn tray_and_application_menu_quit_map_to_the_same_action() {
    // Both ids resolve to `TrayAction::Quit`, which `handle_action` sends to the
    // one `lifecycle::request_quit` entry (as does quit-on-close in `lib.rs`).
    assert_eq!(menu_action("userhome.tray.quit"), TrayAction::Quit);
    assert_eq!(menu_action("userhome.app.quit"), TrayAction::Quit);
}

#[test]
fn tray_close_policy_only_hides_the_main_window() {
    assert!(should_hide_window_on_close("main", true));
    assert!(!should_hide_window_on_close("settings", true));
    assert!(!should_hide_window_on_close("main", false));
}
