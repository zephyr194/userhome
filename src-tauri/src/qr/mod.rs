mod encode;
mod icon;

pub use encode::{
    ErrorCorrection, Layout, MIN_MODULE_PX, PixelSize, QUIET_ZONE_MODULES, QrError, QrImage,
    encode_png, encode_png_with_icon,
};
pub use icon::{IconError, IconFormat, MAX_ICON_BYTES, decode_icon, thumbnail_png};

#[cfg(test)]
mod tests;
