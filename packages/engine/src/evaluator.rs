//! Resolve dependencies and isolate failures to their downstream steps.
use crate::contract::{
    EngineError, ErrorCode, Operation, Outcome, Request, ResultSet, MAX_INPUTS, MAX_NODES, VERSION,
};
use crate::operations::transform;
use std::collections::HashMap;

/// Depth-first calculation. `stack` holds the steps being resolved, so reaching one again
/// means every step from there to the top forms a cycle. Depth is bounded by `MAX_NODES`.
fn resolve<'a>(
    id: &'a str,
    operations: &HashMap<&'a str, &'a Operation>,
    outcomes: &mut HashMap<&'a str, Outcome>,
    stack: &mut Vec<&'a str>,
) {
    if outcomes.contains_key(id) {
        return;
    }
    if let Some(start) = stack.iter().position(|&step| step == id) {
        for &step in &stack[start..] {
            outcomes.entry(step).or_insert_with(|| {
                Outcome::failed(
                    step,
                    EngineError::new(
                        ErrorCode::Cycle,
                        "Calculated process steps must not form a cycle.",
                    ),
                )
            });
        }
        return;
    }
    let Some(&operation) = operations.get(id) else {
        return;
    };
    stack.push(id);
    for source in operation.sources() {
        if let Some((&source, _)) = operations.get_key_value(source) {
            resolve(source, operations, outcomes, stack);
        }
    }
    stack.pop();
    if outcomes.contains_key(id) {
        // Marked while resolving its sources: it is part of a cycle.
        return;
    }
    let mut inputs = Vec::new();
    let mut problem = None;
    for source in operation.sources() {
        match outcomes.get(source) {
            Some(Outcome::Ok(result)) => inputs.push((source, result.output.as_str())),
            Some(Outcome::Failed(_)) => {
                problem = Some(EngineError {
                    code: ErrorCode::UpstreamFailed,
                    message: format!("Depends on {source}, which could not be calculated."),
                    source: Some(source.into()),
                });
                break;
            }
            None => {
                problem = Some(EngineError {
                    code: ErrorCode::MissingSource,
                    message: format!("Missing process source: {source}"),
                    source: Some(source.into()),
                });
                break;
            }
        }
    }
    let outcome = match problem {
        Some(error) => Outcome::failed(id, error),
        None => match transform(id, operation, &inputs) {
            Ok(result) => Outcome::Ok(result),
            Err(error) => Outcome::failed(id, error),
        },
    };
    outcomes.insert(id, outcome);
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

/// Request-level problems reject everything; node-level problems are reported per node.
pub(crate) fn calculate(request: Request) -> Result<ResultSet, EngineError> {
    if request.version != VERSION {
        return Err(EngineError::new(
            ErrorCode::UnsupportedVersion,
            "Unsupported engine contract version.",
        ));
    }
    if request.nodes.len() > MAX_NODES {
        return Err(EngineError::new(
            ErrorCode::TooManyNodes,
            "A process is limited to 50 nodes.",
        ));
    }
    let mut operations = HashMap::new();
    for node in &request.nodes {
        if !valid_id(&node.id) {
            return Err(EngineError::new(
                ErrorCode::InvalidId,
                "Invalid process ID.",
            ));
        }
        let sources = node.process.sources();
        if sources.len() > MAX_INPUTS || sources.iter().any(|source| !valid_id(source)) {
            return Err(EngineError::new(
                ErrorCode::InvalidId,
                "Invalid process source ID.",
            ));
        }
        if operations.insert(node.id.as_str(), &node.process).is_some() {
            return Err(EngineError::new(
                ErrorCode::DuplicateId,
                "Process IDs must be unique.",
            ));
        }
    }
    let mut outcomes = HashMap::new();
    let mut stack = Vec::new();
    for node in &request.nodes {
        resolve(&node.id, &operations, &mut outcomes, &mut stack);
    }
    let nodes = request
        .nodes
        .iter()
        .filter_map(|node| outcomes.remove(node.id.as_str()))
        .collect();
    Ok(ResultSet {
        version: VERSION,
        nodes,
    })
}
