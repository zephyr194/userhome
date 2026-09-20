use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::{
    elevation::{ElevationTransport, ElevationTransportError},
    elevation_protocol::{ElevationRequest, ElevationResponse},
};

const BRIDGE_NAME: &str = "libUserHomeHelperBridge.dylib";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HelperRegistrationState {
    Enabled,
    RequiresApproval,
    NotRegistered,
    NotFound,
    Unsupported,
    Unsigned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelperAvailability {
    pub supported: bool,
    pub signed: bool,
    pub state: HelperRegistrationState,
    pub available: bool,
    pub reason: String,
}

#[derive(Default)]
pub struct MacOsElevationTransport;

impl MacOsElevationTransport {
    pub fn status(&self) -> HelperAvailability {
        #[cfg(target_os = "macos")]
        {
            invoke_bridge("userhome_helper_status", &[])
                .ok()
                .and_then(|output| serde_json::from_slice(&output).ok())
                .unwrap_or_else(|| {
                    unavailable(
                        HelperRegistrationState::Unsigned,
                        "A signed in-process helper bridge is not available.",
                    )
                })
        }
        #[cfg(not(target_os = "macos"))]
        {
            unavailable(
                HelperRegistrationState::Unsupported,
                "Controlled elevation requires macOS 13 or newer.",
            )
        }
    }

    pub fn register(&self) -> Result<HelperAvailability, ElevationTransportError> {
        let output = invoke_bridge("userhome_helper_register", &[])?;
        serde_json::from_slice(&output).map_err(|_| ElevationTransportError::InvalidResponse)
    }

    pub fn unregister(&self) -> Result<HelperAvailability, ElevationTransportError> {
        let output = invoke_bridge("userhome_helper_unregister", &[])?;
        serde_json::from_slice(&output).map_err(|_| ElevationTransportError::InvalidResponse)
    }
}

impl ElevationTransport for MacOsElevationTransport {
    fn is_available(&self) -> bool {
        self.status().available
    }

    fn send(
        &self,
        request: &ElevationRequest,
        payload: &[u8],
    ) -> Result<ElevationResponse, ElevationTransportError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct BridgeEnvelope<'a> {
            request: &'a ElevationRequest,
            payload_hex: String,
        }

        let input = serde_json::to_vec(&BridgeEnvelope {
            request,
            payload_hex: encode_hex(payload),
        })
        .map_err(|_| ElevationTransportError::InvalidResponse)?;
        let output = invoke_bridge("userhome_helper_request", &input)?;
        if let Ok(error) = serde_json::from_slice::<BridgeError>(&output) {
            return Err(match error.bridge_error.as_str() {
                "TIMEOUT" => ElevationTransportError::Timeout,
                "DISCONNECTED" => ElevationTransportError::Disconnected,
                _ => ElevationTransportError::InvalidResponse,
            });
        }
        serde_json::from_slice(&output).map_err(|_| ElevationTransportError::InvalidResponse)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeError {
    bridge_error: String,
}

#[cfg(target_os = "macos")]
fn invoke_bridge(symbol: &str, input: &[u8]) -> Result<Vec<u8>, ElevationTransportError> {
    use std::{
        ffi::{CStr, CString, c_char, c_int, c_void},
        ptr,
    };

    type BridgeFunction = unsafe extern "C" fn(*const u8, usize) -> *mut c_char;
    type FreeFunction = unsafe extern "C" fn(*mut c_char);

    unsafe extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
        fn dlclose(handle: *mut c_void) -> c_int;
    }

    const RTLD_NOW: c_int = 2;
    let library_path = bridge_path().ok_or(ElevationTransportError::Unavailable)?;
    let library_path = CString::new(library_path.to_string_lossy().as_bytes())
        .map_err(|_| ElevationTransportError::Unavailable)?;
    let symbol = CString::new(symbol).map_err(|_| ElevationTransportError::InvalidResponse)?;
    let free_symbol = CString::new("userhome_helper_free").expect("static symbol contains no NUL");

    // The path and symbol names are compile-time constants resolved inside the signed app bundle.
    let handle = unsafe { dlopen(library_path.as_ptr(), RTLD_NOW) };
    if handle.is_null() {
        return Err(ElevationTransportError::Unavailable);
    }
    let result = (|| {
        let function = unsafe { dlsym(handle, symbol.as_ptr()) };
        let free = unsafe { dlsym(handle, free_symbol.as_ptr()) };
        if function.is_null() || free.is_null() {
            return Err(ElevationTransportError::Unavailable);
        }
        let function: BridgeFunction = unsafe { std::mem::transmute(function) };
        let free: FreeFunction = unsafe { std::mem::transmute(free) };
        let input_pointer = if input.is_empty() {
            ptr::null()
        } else {
            input.as_ptr()
        };
        let output = unsafe { function(input_pointer, input.len()) };
        if output.is_null() {
            return Err(ElevationTransportError::Disconnected);
        }
        let bytes = unsafe { CStr::from_ptr(output) }.to_bytes().to_vec();
        unsafe { free(output) };
        Ok(bytes)
    })();
    unsafe {
        dlclose(handle);
    }
    result
}

#[cfg(not(target_os = "macos"))]
fn invoke_bridge(_symbol: &str, _input: &[u8]) -> Result<Vec<u8>, ElevationTransportError> {
    Err(ElevationTransportError::Unavailable)
}

fn bridge_path() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    if macos.file_name()?.to_str()? != "MacOS" || contents.file_name()?.to_str()? != "Contents" {
        return None;
    }
    let bridge = contents.join("Resources").join(BRIDGE_NAME);
    bridge.is_file().then_some(bridge)
}

fn unavailable(state: HelperRegistrationState, reason: &str) -> HelperAvailability {
    HelperAvailability {
        supported: cfg!(target_os = "macos"),
        signed: false,
        state,
        available: false,
        reason: reason.to_owned(),
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut encoded, "{byte:02x}");
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsigned_build_cannot_claim_helper_availability() {
        let status = MacOsElevationTransport.status();
        assert!(!status.available);
        assert!(!status.signed);
    }
}
