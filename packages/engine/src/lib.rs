//! Bounded declarative process evaluation.
mod contract;
mod drawing;
mod evaluator;
mod operations;
mod text;

use contract::{EngineError, ErrorCode, Request};
use evaluator::calculate;
use wasm_bindgen::prelude::*;

/// The only WASM entry point: bounded JSON in, calculated data and vector geometry out.
#[wasm_bindgen]
pub fn evaluate(json: &str) -> String {
    let result = if json.len() > 512_000 {
        Err(EngineError::new(
            ErrorCode::RequestTooLarge,
            "Engine request is too large.",
        ))
    } else {
        serde_json::from_str::<Request>(json)
            .map_err(|e| {
                EngineError::new(
                    ErrorCode::InvalidRequest,
                    format!("Invalid engine request: {e}"),
                )
            })
            .and_then(calculate)
    };
    match result {
        Ok(result) => serde_json::json!({"ok": true, "result": result}).to_string(),
        Err(error) => serde_json::json!({"ok": false, "error": error}).to_string(),
    }
}

#[cfg(test)]
mod tests;
