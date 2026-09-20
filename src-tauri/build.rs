fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=helper/Package.swift");
        println!("cargo:rerun-if-changed=helper/Sources");
        println!("cargo:rerun-if-changed=helper/Bridge");
        println!("cargo:rerun-if-changed=helper/LaunchDaemons");
        println!("cargo:rerun-if-changed=scripts/build-helper.sh");
        println!("cargo:rerun-if-env-changed=USERHOME_HELPER_PREBUILT");
        if std::env::var_os("USERHOME_HELPER_PREBUILT").is_some() {
            for artifact in [
                "helper/dist/UserHomeHelper",
                "helper/dist/libUserHomeHelperBridge.dylib",
            ] {
                assert!(
                    std::path::Path::new(artifact).is_file(),
                    "prebuilt helper artifact is missing: {artifact}"
                );
            }
        } else {
            let status = std::process::Command::new("bash")
                .arg("scripts/build-helper.sh")
                .status()
                .expect("Bash and Swift are required to build the bundled privileged helper");
            assert!(status.success(), "failed to build the privileged helper");
        }
    }
    tauri_build::build()
}
