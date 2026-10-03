//! Serialized contract types and limits shared by the engine modules.
use serde::{Deserialize, Serialize};

pub(crate) const VERSION: u8 = 3;
pub(crate) const MAX_NODES: usize = 50;
pub(crate) const MAX_LINES: usize = 100;
pub(crate) const MAX_TEXT: usize = 1000;
pub(crate) const MAX_INPUTS: usize = 10;
pub(crate) const MAX_FIELDS: usize = 20;
pub(crate) const MAX_SET: usize = 100;

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Operation {
    Source {
        text: String,
    },
    Pass {
        from: String,
    },
    Head {
        from: String,
        count: usize,
    },
    Tail {
        from: String,
        count: usize,
    },
    Sort {
        from: String,
        order: SortOrder,
        #[serde(default)]
        numeric: bool,
        #[serde(default, rename = "ignoreCase")]
        ignore_case: bool,
    },
    Filter {
        from: String,
        text: String,
        #[serde(default, rename = "ignoreCase")]
        ignore_case: bool,
        #[serde(default)]
        invert: bool,
    },
    Unique {
        from: String,
        #[serde(default, rename = "withCounts")]
        with_counts: bool,
    },
    Count {
        from: String,
    },
    Cut {
        from: String,
        fields: Vec<usize>,
        #[serde(default = "tab")]
        delimiter: String,
    },
    Translate {
        from: String,
        set1: String,
        set2: String,
    },
    Concat {
        from: Vec<String>,
    },
    Paste {
        from: Vec<String>,
        #[serde(default = "tab")]
        delimiter: String,
    },
}

fn tab() -> String {
    "\t".into()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SortOrder {
    Asc,
    Desc,
}

impl Operation {
    /// The steps whose output this one reads, in order. Empty only for sources.
    pub(crate) fn sources(&self) -> Vec<&str> {
        match self {
            Self::Source { .. } => Vec::new(),
            Self::Pass { from }
            | Self::Head { from, .. }
            | Self::Tail { from, .. }
            | Self::Sort { from, .. }
            | Self::Filter { from, .. }
            | Self::Unique { from, .. }
            | Self::Count { from }
            | Self::Cut { from, .. }
            | Self::Translate { from, .. } => vec![from],
            Self::Concat { from } | Self::Paste { from, .. } => {
                from.iter().map(String::as_str).collect()
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Node {
    pub(crate) id: String,
    pub(crate) process: Operation,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    pub(crate) version: u8,
    pub(crate) nodes: Vec<Node>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StepResult {
    pub(crate) id: String,
    pub(crate) input: String,
    pub(crate) output: String,
    pub(crate) input_rows: usize,
    pub(crate) output_rows: usize,
    /// For each output row, the input rows it was made from.
    pub(crate) origins: Vec<Vec<usize>>,
    /// Which step supplied each consecutive block of input rows.
    pub(crate) inputs: Vec<InputBlock>,
    pub(crate) drawing: Drawing,
}

#[derive(Clone, Serialize)]
pub(crate) struct InputBlock {
    pub(crate) id: String,
    pub(crate) rows: usize,
}

#[derive(Clone, Serialize)]
pub(crate) struct Drawing {
    pub(crate) height: usize,
    pub(crate) paths: Vec<Trace>,
}

#[derive(Clone, Serialize)]
pub(crate) struct Trace {
    pub(crate) d: String,
    pub(crate) kept: bool,
}

/// Stable identifiers so callers can react to a failure without parsing its message.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ErrorCode {
    RequestTooLarge,
    InvalidRequest,
    UnsupportedVersion,
    TooManyNodes,
    InvalidId,
    DuplicateId,
    MissingSource,
    Cycle,
    SampleTooLong,
    InputTooLong,
    TooManyLines,
    CountOutOfRange,
    FilterTooLong,
    InvalidArgument,
    OutputTooLong,
    UpstreamFailed,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct EngineError {
    pub(crate) code: ErrorCode,
    pub(crate) message: String,
    /// The step this one reads from, when the failure originates there.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
}

impl EngineError {
    pub(crate) fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidArgument, message)
    }
}

#[derive(Clone, Serialize)]
pub(crate) struct StepFailure {
    pub(crate) id: String,
    pub(crate) error: EngineError,
}

/// Each node succeeds or fails on its own; a failure only spreads to steps that read from it.
#[derive(Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum Outcome {
    Ok(StepResult),
    Failed(StepFailure),
}

impl Outcome {
    pub(crate) fn failed(id: &str, error: EngineError) -> Self {
        Self::Failed(StepFailure {
            id: id.into(),
            error,
        })
    }
}

#[derive(Serialize)]
pub(crate) struct ResultSet {
    pub(crate) version: u8,
    pub(crate) nodes: Vec<Outcome>,
}
