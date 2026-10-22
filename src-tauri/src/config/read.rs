use std::{fs, path::Path};

use sha2::{Digest, Sha256};

use crate::error::AppError;

pub(crate) fn read_bounded(path: &Path, max_size: usize) -> Result<Vec<u8>, AppError> {
    let metadata = fs::metadata(path)
        .map_err(|_| AppError::not_found("Configuration document is unavailable."))?;
    if metadata.len() > max_size as u64 {
        return Err(AppError::validation_failed(
            "Configuration exceeds the catalog size limit.",
        ));
    }
    let bytes =
        fs::read(path).map_err(|_| AppError::permission_denied("Configuration cannot be read."))?;
    if bytes.len() > max_size {
        return Err(AppError::validation_failed(
            "Configuration exceeds the catalog size limit.",
        ));
    }
    Ok(bytes)
}

pub(crate) fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
