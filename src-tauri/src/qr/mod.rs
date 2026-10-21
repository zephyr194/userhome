mod encode;

pub use encode::{
    ErrorCorrection, Layout, MIN_MODULE_PX, PixelSize, QUIET_ZONE_MODULES, QrError, QrImage,
    encode_png,
};

#[cfg(test)]
mod tests;
