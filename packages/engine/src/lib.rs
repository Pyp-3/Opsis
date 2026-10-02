use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

const VERSION: u8 = 2;
const MAX_NODES: usize = 50;
const MAX_LINES: usize = 100;

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Operation {
    Source { text: String },
    Pass { from: String },
    Head { from: String, count: usize },
    Tail { from: String, count: usize },
    Sort { from: String, order: SortOrder },
    Filter { from: String, text: String },
    Unique { from: String },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SortOrder {
    Asc,
    Desc,
}

impl Operation {
    fn source(&self) -> Option<&str> {
        match self {
            Self::Source { .. } => None,
            Self::Pass { from }
            | Self::Head { from, .. }
            | Self::Tail { from, .. }
            | Self::Sort { from, .. }
            | Self::Filter { from, .. }
            | Self::Unique { from } => Some(from),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Node {
    id: String,
    process: Operation,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u8,
    nodes: Vec<Node>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StepResult {
    id: String,
    input: String,
    output: String,
    input_rows: usize,
    output_rows: usize,
    retained: Vec<usize>,
    drawing: Drawing,
}

#[derive(Clone, Serialize)]
struct Drawing {
    height: usize,
    paths: Vec<Trace>,
}

#[derive(Clone, Serialize)]
struct Trace {
    d: String,
    kept: bool,
}

/// Stable identifiers so callers can react to a failure without parsing its message.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ErrorCode {
    RequestTooLarge,
    InvalidRequest,
    UnsupportedVersion,
    TooManyNodes,
    InvalidId,
    DuplicateId,
    MissingSource,
    Cycle,
    SampleTooLong,
    TooManyLines,
    CountOutOfRange,
    FilterTooLong,
    OutputTooLong,
    UpstreamFailed,
}

#[derive(Clone, Debug, Serialize)]
struct EngineError {
    code: ErrorCode,
    message: String,
    /// The step this one reads from, when the failure originates there.
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

impl EngineError {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }
}

#[derive(Clone, Serialize)]
struct StepFailure {
    id: String,
    error: EngineError,
}

/// Each node succeeds or fails on its own; a failure only spreads to steps that read from it.
#[derive(Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Outcome {
    Ok(StepResult),
    Failed(StepFailure),
}

impl Outcome {
    fn failed(id: &str, error: EngineError) -> Self {
        Self::Failed(StepFailure {
            id: id.into(),
            error,
        })
    }
}

#[derive(Serialize)]
struct ResultSet {
    version: u8,
    nodes: Vec<Outcome>,
}

/// A line's text without its single terminator (LF or CRLF).
fn body(line: &str) -> &str {
    match line.strip_suffix('\n') {
        Some(line) => line.strip_suffix('\r').unwrap_or(line),
        None => line,
    }
}

/// The terminator a line already has, if any.
fn ending(line: &str) -> &str {
    &line[body(line).len()..]
}

/// Geometry for a row's journey. Stable inputs produce exactly the same vector paths.
fn drawing(rows: usize, retained: &[usize]) -> Drawing {
    let height = rows.max(retained.len()).max(1) * 10 + 8;
    let paths = (0..rows)
        .map(|index| {
            let y = 9 + index * 10;
            match retained.iter().position(|&kept| kept == index) {
                Some(target) => {
                    let end = 9 + target * 10;
                    Trace {
                        d: format!("M 6 {y} C 42 {y} 78 {end} 114 {end}"),
                        kept: true,
                    }
                }
                None => Trace {
                    d: format!("M 6 {y} L 48 {y}"),
                    kept: false,
                },
            }
        })
        .collect();
    Drawing { height, paths }
}

fn transform(id: &str, operation: &Operation, input: String) -> Result<StepResult, EngineError> {
    let lines: Vec<&str> = input.split_inclusive('\n').collect();
    if lines.len() > MAX_LINES {
        return Err(EngineError::new(
            ErrorCode::TooManyLines,
            "Sample data is limited to 100 lines.",
        ));
    }
    let mut retained: Vec<usize> = (0..lines.len()).collect();
    match operation {
        Operation::Head { count, .. } | Operation::Tail { count, .. } if *count > MAX_LINES => {
            return Err(EngineError::new(
                ErrorCode::CountOutOfRange,
                "Line count must be between 0 and 100.",
            ));
        }
        Operation::Head { count, .. } => retained.truncate(*count),
        Operation::Tail { count, .. } => {
            retained.drain(..lines.len().saturating_sub(*count));
        }
        Operation::Sort { order, .. } => {
            retained.sort_by(|&a, &b| body(lines[a]).cmp(body(lines[b])));
            if matches!(order, SortOrder::Desc) {
                retained.reverse();
            }
        }
        Operation::Filter { text, .. } => {
            if text.encode_utf16().count() > 200 {
                return Err(EngineError::new(
                    ErrorCode::FilterTooLong,
                    "Filter text is too long.",
                ));
            }
            retained.retain(|&index| body(lines[index]).contains(text));
        }
        Operation::Unique { .. } => {
            // Like uniq: collapse adjacent equal lines; do not silently sort or deduplicate globally.
            retained.retain(|&index| index == 0 || body(lines[index]) != body(lines[index - 1]));
        }
        Operation::Source { .. } | Operation::Pass { .. } => {}
    }
    let output: String = if matches!(operation, Operation::Sort { .. }) {
        // Moved lines keep their own terminators; an unterminated final line borrows the
        // input's first terminator so it cannot merge with the line placed after it. A
        // trailing CR would read as part of an LF terminator, so it always gets CRLF.
        let fallback = lines
            .iter()
            .map(|line| ending(line))
            .find(|e| !e.is_empty())
            .unwrap_or("\n");
        retained
            .iter()
            .map(|&index| match lines[index] {
                line if !ending(line).is_empty() => line.to_string(),
                line if line.ends_with('\r') => format!("{line}\r\n"),
                line => format!("{line}{fallback}"),
            })
            .collect()
    } else {
        retained.iter().map(|&index| lines[index]).collect()
    };
    if output.encode_utf16().count() > 1000 {
        return Err(EngineError::new(
            ErrorCode::OutputTooLong,
            "Calculated output is limited to 1000 characters. Shorten the sample.",
        ));
    }
    let input_rows = lines.len();
    let output_rows = retained.len();
    let drawing = drawing(input_rows, &retained);
    Ok(StepResult {
        id: id.into(),
        input,
        output,
        input_rows,
        output_rows,
        retained,
        drawing,
    })
}

fn evaluate_source(id: &str, operation: &Operation, text: &str) -> Outcome {
    if text.encode_utf16().count() > 1000 || text.len() > 4000 {
        return Outcome::failed(
            id,
            EngineError::new(ErrorCode::SampleTooLong, "Sample data is too long."),
        );
    }
    match transform(id, operation, text.into()) {
        Ok(result) => Outcome::Ok(result),
        Err(error) => Outcome::failed(id, error),
    }
}

/// Walk `start`'s chain of sources until reaching a calculated step, a source, a missing
/// reference or a cycle, then calculate the chain from its root back to `start`.
/// Every operation has at most one source, so each chain is a simple path.
fn resolve<'a>(
    start: &'a str,
    operations: &HashMap<&'a str, &'a Operation>,
    outcomes: &mut HashMap<&'a str, Outcome>,
) {
    let mut path: Vec<&'a str> = Vec::new();
    let mut current = start;
    while !outcomes.contains_key(current) {
        if let Some(index) = path.iter().position(|&id| id == current) {
            for &id in &path[index..] {
                outcomes.insert(
                    id,
                    Outcome::failed(
                        id,
                        EngineError::new(
                            ErrorCode::Cycle,
                            "Calculated process steps must not form a cycle.",
                        ),
                    ),
                );
            }
            path.truncate(index);
            break;
        }
        let Some(operation) = operations.get(current) else {
            break;
        };
        match operation.source() {
            None => {
                path.push(current);
                break;
            }
            Some(source) if !operations.contains_key(source) => {
                outcomes.insert(
                    current,
                    Outcome::failed(
                        current,
                        EngineError {
                            code: ErrorCode::MissingSource,
                            message: format!("Missing process source: {source}"),
                            source: Some(source.into()),
                        },
                    ),
                );
                break;
            }
            Some(source) => {
                path.push(current);
                current = source;
            }
        }
    }
    for &id in path.iter().rev() {
        let Some(&operation) = operations.get(id) else {
            continue;
        };
        let outcome = if let Operation::Source { text } = operation {
            evaluate_source(id, operation, text)
        } else {
            let source = operation.source().unwrap_or_default();
            match outcomes.get(source) {
                Some(Outcome::Ok(input)) => match transform(id, operation, input.output.clone()) {
                    Ok(result) => Outcome::Ok(result),
                    Err(error) => Outcome::failed(id, error),
                },
                _ => Outcome::failed(
                    id,
                    EngineError {
                        code: ErrorCode::UpstreamFailed,
                        message: format!("Depends on {source}, which could not be calculated."),
                        source: Some(source.into()),
                    },
                ),
            }
        };
        outcomes.insert(id, outcome);
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

/// Request-level problems reject everything; node-level problems are reported per node.
fn calculate(request: Request) -> Result<ResultSet, EngineError> {
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
        if node
            .process
            .source()
            .is_some_and(|source| !valid_id(source))
        {
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
    for node in &request.nodes {
        resolve(&node.id, &operations, &mut outcomes);
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
mod tests {
    use super::*;
    use proptest::prelude::*;
    use serde_json::{json, Value};

    fn run(nodes: Value) -> Value {
        serde_json::from_str(&evaluate(
            &json!({"version": 2, "nodes": nodes}).to_string(),
        ))
        .unwrap()
    }

    #[test]
    fn calculates_dependencies_in_any_order_and_preserves_bytes() {
        let result = run(json!([
            {"id": "head", "process": {"op": "head", "from": "cat", "count": 2}},
            {"id": "source", "process": {"op": "source", "text": "alex\r\nblair\r\ncasey"}},
            {"id": "cat", "process": {"op": "pass", "from": "source"}}
        ]));
        assert_eq!(result["result"]["nodes"][0]["status"], "ok");
        assert_eq!(result["result"]["nodes"][0]["output"], "alex\r\nblair\r\n");
        assert_eq!(result["result"]["nodes"][0]["inputRows"], 3);
        assert_eq!(
            result["result"]["nodes"][2]["output"],
            "alex\r\nblair\r\ncasey"
        );
        assert_eq!(result["result"]["nodes"][0]["retained"], json!([0, 1]));
        assert_eq!(
            result["result"]["nodes"][0]["drawing"]["paths"][2]["kept"],
            false
        );
    }

    #[test]
    fn handles_empty_short_zero_and_unterminated_inputs() {
        for (text, count, expected) in [
            ("", 10, ""),
            ("one", 10, "one"),
            ("\n\n", 1, "\n"),
            ("a\nb\n", 0, ""),
        ] {
            let result = run(json!([
                {"id": "s", "process": {"op": "source", "text": text}},
                {"id": "h", "process": {"op": "head", "from": "s", "count": count}}
            ]));
            assert_eq!(result["result"]["nodes"][1]["output"], expected);
        }
    }

    #[test]
    fn calculates_sort_filter_tail_and_adjacent_unique_with_row_provenance() {
        let result = run(json!([
            {"id": "s", "process": {"op": "source", "text": "beta\nalpha\nalpha\nbeta\ngamma"}},
            {"id": "u", "process": {"op": "unique", "from": "s"}},
            {"id": "sorted", "process": {"op": "sort", "from": "u", "order": "asc"}},
            {"id": "filter", "process": {"op": "filter", "from": "sorted", "text": "beta"}},
            {"id": "tail", "process": {"op": "tail", "from": "sorted", "count": 2}}
        ]));
        let nodes = &result["result"]["nodes"];
        assert_eq!(nodes[1]["output"], "beta\nalpha\nbeta\ngamma");
        assert_eq!(nodes[2]["output"], "alpha\nbeta\nbeta\ngamma\n");
        assert_eq!(nodes[2]["retained"], json!([1, 0, 2, 3]));
        assert_eq!(nodes[3]["output"], "beta\nbeta\n");
        assert_eq!(nodes[4]["output"], "beta\ngamma\n");
    }

    #[test]
    fn strips_exactly_one_line_terminator() {
        assert_eq!(body("a\r\n"), "a");
        assert_eq!(body("a\n"), "a");
        assert_eq!(body("a\r\r\n"), "a\r");
        assert_eq!(body("a\r"), "a\r");
        assert_eq!(ending("a\r\n"), "\r\n");
        assert_eq!(ending("a"), "");
        let result = run(json!([
            {"id": "s", "process": {"op": "source", "text": "a\r\r\na\r\n"}},
            {"id": "u", "process": {"op": "unique", "from": "s"}}
        ]));
        assert_eq!(result["result"]["nodes"][1]["outputRows"], 2);
    }

    #[test]
    fn sort_keeps_each_line_terminator() {
        let result = run(json!([
            {"id": "s", "process": {"op": "source", "text": "casey\r\nalex\r\nblair"}},
            {"id": "asc", "process": {"op": "sort", "from": "s", "order": "asc"}},
            {"id": "mixed", "process": {"op": "source", "text": "b\na\r\n"}},
            {"id": "m", "process": {"op": "sort", "from": "mixed", "order": "asc"}},
            {"id": "plain", "process": {"op": "source", "text": "b\na"}},
            {"id": "p", "process": {"op": "sort", "from": "plain", "order": "desc"}}
        ]));
        let nodes = &result["result"]["nodes"];
        assert_eq!(nodes[1]["output"], "alex\r\nblair\r\ncasey\r\n");
        assert_eq!(nodes[3]["output"], "a\r\nb\n");
        assert_eq!(nodes[5]["output"], "b\na\n");
        let cr = run(json!([
            {"id": "s", "process": {"op": "source", "text": "b\na\r"}},
            {"id": "sorted", "process": {"op": "sort", "from": "s", "order": "asc"}}
        ]));
        assert_eq!(cr["result"]["nodes"][1]["output"], "a\r\r\nb\n");
    }

    #[test]
    fn rejects_malformed_requests_as_a_whole_with_codes() {
        let cases = [
            (
                json!([{"id":"a","process":{"op":"source","text":""}},{"id":"a","process":{"op":"source","text":""}}]),
                "duplicate_id",
            ),
            (
                json!([{"id":"a","process":{"op":"exec","command":"anything"}}]),
                "invalid_request",
            ),
            (
                json!([{"id":"a b","process":{"op":"source","text":""}}]),
                "invalid_id",
            ),
            (
                json!((0..51)
                    .map(|i| json!({"id": format!("n{i}"), "process": {"op":"source","text":""}}))
                    .collect::<Vec<_>>()),
                "too_many_nodes",
            ),
        ];
        for (case, code) in cases {
            let result = run(case);
            assert_eq!(result["ok"], false);
            assert_eq!(result["error"]["code"], code);
        }
        let old: Value =
            serde_json::from_str(&evaluate(&json!({"version": 1, "nodes": []}).to_string()))
                .unwrap();
        assert_eq!(old["error"]["code"], "unsupported_version");
    }

    #[test]
    fn reports_step_problems_on_the_failing_node_only() {
        let cases = [
            (
                json!([{"id":"a","process":{"op":"pass","from":"a"}}]),
                "cycle",
            ),
            (
                json!([{"id":"a","process":{"op":"pass","from":"missing"}}]),
                "missing_source",
            ),
            (
                json!([{"id":"a","process":{"op":"source","text":"x".repeat(1001)}}]),
                "sample_too_long",
            ),
            (
                json!([{"id":"a","process":{"op":"source","text":"x\n".repeat(101)}}]),
                "too_many_lines",
            ),
            (
                json!([{"id":"a","process":{"op":"source","text":"x"}},{"id":"h","process":{"op":"head","from":"a","count":101}}]),
                "count_out_of_range",
            ),
            (
                json!([{"id":"a","process":{"op":"source","text":"x"}},{"id":"f","process":{"op":"filter","from":"a","text":"y".repeat(201)}}]),
                "filter_too_long",
            ),
            (
                json!([{"id":"a","process":{"op":"source","text":"y\n".repeat(99) + &"z".repeat(802)}},{"id":"s","process":{"op":"sort","from":"a","order":"asc"}}]),
                "output_too_long",
            ),
        ];
        for (case, code) in cases {
            let result = run(case);
            assert_eq!(result["ok"], true);
            let nodes = result["result"]["nodes"].as_array().unwrap();
            let failed = nodes.last().unwrap();
            assert_eq!(failed["status"], "failed");
            assert_eq!(failed["error"]["code"], code);
        }
    }

    #[test]
    fn failures_spread_downstream_but_not_across_branches() {
        let result = run(json!([
            {"id": "s", "process": {"op": "source", "text": "b\na"}},
            {"id": "bad", "process": {"op": "head", "from": "s", "count": 101}},
            {"id": "after", "process": {"op": "pass", "from": "bad"}},
            {"id": "good", "process": {"op": "sort", "from": "s", "order": "asc"}},
            {"id": "loop1", "process": {"op": "pass", "from": "loop2"}},
            {"id": "loop2", "process": {"op": "pass", "from": "loop1"}},
            {"id": "tail", "process": {"op": "pass", "from": "loop1"}}
        ]));
        let nodes = &result["result"]["nodes"];
        assert_eq!(nodes[0]["status"], "ok");
        assert_eq!(nodes[1]["error"]["code"], "count_out_of_range");
        assert_eq!(nodes[2]["error"]["code"], "upstream_failed");
        assert_eq!(nodes[2]["error"]["source"], "bad");
        assert_eq!(nodes[3]["output"], "a\nb\n");
        assert_eq!(nodes[4]["error"]["code"], "cycle");
        assert_eq!(nodes[5]["error"]["code"], "cycle");
        assert_eq!(nodes[6]["error"]["code"], "upstream_failed");
        assert_eq!(nodes[6]["id"], "tail");
    }

    #[test]
    fn geometry_and_serialization_are_repeatable() {
        let nodes = json!([
            {"id":"s","process":{"op":"source","text":"a\nb\nc"}},
            {"id":"h","process":{"op":"head","from":"s","count":2}}
        ]);
        assert_eq!(run(nodes.clone()), run(nodes));
        assert_eq!(drawing(3, &[2, 0]).paths[0].d, "M 6 9 C 42 9 78 19 114 19");
    }

    /// Short lines over a tiny alphabet, so duplicates, CR and missing final LF are common.
    fn sample() -> impl Strategy<Value = String> {
        let line = prop::collection::vec(prop::sample::select(vec!['a', 'b', 'c', '\r']), 0..4)
            .prop_map(|chars| chars.into_iter().collect::<String>());
        (
            prop::collection::vec((line, prop::bool::ANY), 0..12),
            prop::bool::ANY,
        )
            .prop_map(|(lines, terminated)| {
                let mut text: String = lines
                    .into_iter()
                    .map(|(line, crlf)| line + if crlf { "\r\n" } else { "\n" })
                    .collect();
                if !terminated {
                    text.pop();
                }
                text
            })
    }

    fn operation() -> impl Strategy<Value = Operation> {
        let from = || Just(String::from("s"));
        prop_oneof![
            from().prop_map(|from| Operation::Pass { from }),
            (from(), 0..15usize).prop_map(|(from, count)| Operation::Head { from, count }),
            (from(), 0..15usize).prop_map(|(from, count)| Operation::Tail { from, count }),
            (from(), prop::bool::ANY).prop_map(|(from, asc)| Operation::Sort {
                from,
                order: if asc { SortOrder::Asc } else { SortOrder::Desc },
            }),
            (from(), prop::sample::select(vec!["", "a", "b", "ab", "\r"])).prop_map(
                |(from, text)| Operation::Filter {
                    from,
                    text: text.into(),
                }
            ),
            from().prop_map(|from| Operation::Unique { from }),
        ]
    }

    proptest! {
        #[test]
        fn every_operation_keeps_its_provenance_consistent(text in sample(), op in operation()) {
            let lines: Vec<&str> = text.split_inclusive('\n').collect();
            let result = transform("t", &op, text.clone()).unwrap();
            prop_assert_eq!(result.input_rows, lines.len());
            prop_assert_eq!(result.output_rows, result.retained.len());
            prop_assert_eq!(result.drawing.paths.len(), lines.len());
            let mut seen = result.retained.clone();
            seen.sort_unstable();
            seen.dedup();
            prop_assert_eq!(seen.len(), result.retained.len());
            prop_assert!(result.retained.iter().all(|&i| i < lines.len()));
            let output: Vec<&str> = result.output.split_inclusive('\n').collect();
            prop_assert_eq!(output.len(), result.retained.len());
            for (line, &index) in output.iter().zip(&result.retained) {
                prop_assert_eq!(body(line), body(lines[index]));
            }
            match &op {
                Operation::Sort { order, .. } => {
                    prop_assert!(output.iter().all(|line| !ending(line).is_empty()));
                    let bodies: Vec<&str> = output.iter().map(|line| body(line)).collect();
                    let ordered = bodies.windows(2).all(|w| match order {
                        SortOrder::Asc => w[0] <= w[1],
                        SortOrder::Desc => w[0] >= w[1],
                    });
                    prop_assert!(ordered);
                }
                _ => {
                    let kept: String = result.retained.iter().map(|&i| lines[i]).collect();
                    prop_assert_eq!(&result.output, &kept);
                }
            }
            match &op {
                Operation::Head { count, .. } => {
                    prop_assert_eq!(&result.retained, &(0..(*count).min(lines.len())).collect::<Vec<_>>());
                }
                Operation::Tail { count, .. } => {
                    prop_assert_eq!(&result.retained, &(lines.len().saturating_sub(*count)..lines.len()).collect::<Vec<_>>());
                }
                Operation::Filter { text: needle, .. } => {
                    for (index, line) in lines.iter().enumerate() {
                        prop_assert_eq!(result.retained.contains(&index), body(line).contains(needle.as_str()));
                    }
                }
                Operation::Unique { .. } => {
                    prop_assert!(output.windows(2).all(|w| body(w[0]) != body(w[1])));
                }
                _ => {}
            }
        }

        #[test]
        fn arbitrary_graphs_never_fail_the_whole_request(
            edges in prop::collection::vec((0..8usize, prop::option::of(0..10usize), sample()), 1..8)
        ) {
            let nodes: Vec<Value> = edges.iter().enumerate().map(|(index, (_, from, text))| {
                let process = match from {
                    None => json!({"op": "source", "text": text}),
                    Some(source) => json!({"op": "pass", "from": format!("n{source}")}),
                };
                json!({"id": format!("n{index}"), "process": process})
            }).collect();
            let result = run(Value::Array(nodes));
            prop_assert_eq!(&result["ok"], true);
            let outcomes = result["result"]["nodes"].as_array().unwrap();
            prop_assert_eq!(outcomes.len(), edges.len());
            let by_id: HashMap<&str, &Value> = outcomes.iter().map(|n| (n["id"].as_str().unwrap(), n)).collect();
            for outcome in outcomes {
                if outcome["error"]["code"] == "upstream_failed" {
                    let source = by_id[outcome["error"]["source"].as_str().unwrap()];
                    prop_assert_eq!(&source["status"], "failed");
                }
                if outcome["status"] == "ok" && outcome["input"] != outcome["output"] {
                    prop_assert!(false, "pass changed its input");
                }
            }
        }

        #[test]
        fn arbitrary_input_always_returns_an_envelope(chars in prop::collection::vec(any::<char>(), 0..200)) {
            let json: String = chars.into_iter().collect();
            let response: Value = serde_json::from_str(&evaluate(&json)).unwrap();
            prop_assert!(response["ok"].is_boolean());
        }
    }
}
