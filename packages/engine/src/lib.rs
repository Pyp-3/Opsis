//! Bounded declarative process evaluation.
mod contract;
mod drawing;
mod evaluator;
mod operations;
mod text;

use contract::{EngineError, ErrorCode, Request, ResultSet};
use evaluator::calculate;
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    Success { ok: bool, result: ResultSet },
    Failure { ok: bool, error: EngineError },
}

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
    let response = match result {
        Ok(result) => Response::Success { ok: true, result },
        Err(error) => Response::Failure { ok: false, error },
    };
    // Avoid copying text and geometry into an intermediate JSON Value tree.
    // These response types contain only JSON-compatible strings, integers and booleans.
    serde_json::to_string(&response).expect("engine responses are JSON-compatible")
}

#[cfg(test)]
mod tests;
