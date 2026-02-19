use std::panic;

use wasm_bindgen::prelude::*;

/// Initialize the WASM module. Sets up a panic hook that logs to the browser
/// console so that Rust panics produce readable stack traces in DevTools.
#[wasm_bindgen]
pub fn init() {
    panic::set_hook(Box::new(console_error_panic_hook));
}

/// Return the crate version string (matches Cargo.toml).
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Verify a RISC Zero receipt in the browser.
///
/// # Arguments
/// * `receipt_bytes` - bincode-serialized `risc0_zkvm::Receipt`
/// * `image_id_hex`  - 64-char hex string of the guest image ID (32 bytes)
///
/// # Returns
/// `true` if the STARK proof verifies against the given image ID, `false`
/// otherwise (including on any deserialization or verification error).
#[wasm_bindgen]
pub fn verify_receipt(receipt_bytes: &[u8], image_id_hex: &str) -> bool {
    // Catch any panic from the verifier and convert to `false`.
    match panic::catch_unwind(|| verify_receipt_inner(receipt_bytes, image_id_hex)) {
        Ok(result) => result,
        Err(_) => {
            log("verify_receipt: caught panic during verification");
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn verify_receipt_inner(receipt_bytes: &[u8], image_id_hex: &str) -> bool {
    // Decode the image ID from hex to [u32; 8].
    let image_id = match decode_image_id(image_id_hex) {
        Some(id) => id,
        None => {
            log("verify_receipt: invalid image_id_hex");
            return false;
        }
    };

    // Deserialize the receipt from bincode.
    let receipt: risc0_zkvm::Receipt = match bincode::deserialize(receipt_bytes) {
        Ok(r) => r,
        Err(e) => {
            log(&format!("verify_receipt: deserialization failed: {e}"));
            return false;
        }
    };

    // Verify the STARK proof.
    match receipt.verify(image_id) {
        Ok(()) => true,
        Err(e) => {
            log(&format!("verify_receipt: verification failed: {e}"));
            false
        }
    }
}

/// Decode a 64-character hex string into the `[u32; 8]` image ID format that
/// `risc0_zkvm::Receipt::verify` expects.
fn decode_image_id(hex_str: &str) -> Option<[u32; 8]> {
    if hex_str.len() != 64 {
        return None;
    }

    let bytes: Vec<u8> = (0..32)
        .map(|i| u8::from_str_radix(&hex_str[2 * i..2 * i + 2], 16))
        .collect::<Result<Vec<_>, _>>()
        .ok()?;

    let mut id = [0u32; 8];
    for (i, chunk) in bytes.chunks_exact(4).enumerate() {
        id[i] = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
    }
    Some(id)
}

/// Minimal panic hook that writes the panic message to the browser console.
fn console_error_panic_hook(info: &panic::PanicHookInfo) {
    let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    };

    let location = info
        .location()
        .map(|l| format!(" at {}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_default();

    log(&format!("risc0-wasm-verifier panic: {msg}{location}"));
}

/// Log a message to the browser console via `web_sys`.
fn log(msg: &str) {
    web_sys::console::warn_1(&JsValue::from_str(msg));
}
