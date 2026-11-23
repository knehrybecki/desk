// desk's own commands go through the ACL too (an app manifest), so only the
// capability in capabilities/default.json, granted to the "main" window, can
// call them. The link preview window loads untrusted pages and gets none.
const COMMANDS: &[&str] = &[
    "bootstrap",
    "prompt_ai_vpn",
    "set_prompt_ai_vpn",
    "set_super_keys",
    "prompt_ai_undo",
    "open_session",
    "kill_session",
    "pty_attach",
    "pty_write",
    "pty_resize",
    "pty_close",
    "save_layout",
    "tile_info",
    "git_branches",
    "project_files",
    "project_dir",
    "search_files",
    "grep_files",
    "read_project_text",
    "open_file_at",
    "check_file_editor",
    "reveal_path",
    "copy_file",
    "paste_files",
    "browser_name",
    "update_check",
    "update_install",
    "preview_file",
    "run_targets",
    "git_switch",
    "git_status_summary",
    "list_projects",
    "list_sessions",
    "thermal_status",
    "thermal_resume",
    "cpu_details",
    "fans_info",
    "fans_install",
    "fans_uninstall",
    "coffee_status",
    "coffee_set",
    "coffee_restore",
    "coffee_uninstall",
    "lock_desk",
    "unlock_desk",
    "is_locked",
    "dropdown_apply",
    "dropdown_leave",
    "open_preview",
    "preview_bounds",
    "preview_visible",
    "preview_close",
    "preview_nav",
    "read_text",
    "write_text",
    "open_external",
    "chat_dir",
    "usage",
    "list_agents",
    "create_project",
    "github_repos",
    "clone_project",
    "dropped_paths",
    "recent_conversations",
    "claude_accounts",
    "usage_models",
    "usage_details",
    "docker_overview",
    "docker_image_rm",
    "docker_restart",
    "upload_tools",
    "upload_suggestions",
    "upload_file_size",
    "upload_running",
    "compose_dirs",
    "quit_desk",
    "files_window_open",
    "files_window_hide",
    "files_window_destroy",
    "focus_main_window",
];

fn main() {
    let mut attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // tauri-build embeds the Common Controls manifest only in the app
        // binary; test binaries then fail to start (STATUS_ENTRYPOINT_NOT_FOUND).
        // Embed it in every binary instead.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
