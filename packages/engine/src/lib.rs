use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

const MAX_NODES: usize = 50;
const MAX_LINES: usize = 100;

#[derive(Clone, Deserialize)]
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

#[derive(Clone, Deserialize)]
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

#[derive(Serialize)]
struct ResultSet {
    version: u8,
    nodes: Vec<StepResult>,
}

fn body(line: &str) -> &str {
    line.trim_end_matches('\n').trim_end_matches('\r')
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

fn transform(id: &str, operation: &Operation, input: String) -> Result<StepResult, String> {
    let lines: Vec<&str> = input.split_inclusive('\n').collect();
    if lines.len() > MAX_LINES {
        return Err("Sample data is limited to 100 lines.".into());
    }
    let mut retained: Vec<usize> = (0..lines.len()).collect();
    match operation {
        Operation::Head { count, .. } => {
            if *count > MAX_LINES {
                return Err("Line count must be between 0 and 100.".into());
            }
            retained.truncate(*count);
        }
        Operation::Tail { count, .. } => {
            if *count > MAX_LINES {
                return Err("Line count must be between 0 and 100.".into());
            }
            retained = retained
                .into_iter()
                .skip(lines.len().saturating_sub(*count))
                .collect();
        }
        Operation::Sort { order, .. } => {
            retained.sort_by(|&a, &b| body(lines[a]).cmp(body(lines[b])));
            if matches!(order, SortOrder::Desc) {
                retained.reverse();
            }
        }
        Operation::Filter { text, .. } => {
            if text.encode_utf16().count() > 200 {
                return Err("Filter text is too long.".into());
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
        retained
            .iter()
            .map(|&index| format!("{}\n", body(lines[index])))
            .collect()
    } else {
        retained.iter().map(|&index| lines[index]).collect()
    };
    if output.encode_utf16().count() > 1000 {
        return Err("Calculated output is limited to 1000 characters. Shorten the sample.".into());
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

fn resolve(
    id: &str,
    operations: &HashMap<&str, &Operation>,
    visiting: &mut HashSet<String>,
    results: &mut HashMap<String, StepResult>,
) -> Result<(), String> {
    if results.contains_key(id) {
        return Ok(());
    }
    if !visiting.insert(id.into()) {
        return Err("Calculated process steps must not form a cycle.".into());
    }
    let operation = operations
        .get(id)
        .ok_or_else(|| format!("Missing process source: {id}"))?;
    let input = match operation {
        Operation::Source { text } => {
            if text.encode_utf16().count() > 1000 || text.len() > 4000 {
                return Err("Sample data is too long.".into());
            }
            text.clone()
        }
        _ => {
            let source = operation.source().ok_or("Missing process source.")?;
            resolve(source, operations, visiting, results)?;
            results
                .get(source)
                .ok_or("Missing calculated input.")?
                .output
                .clone()
        }
    };
    let result = transform(id, operation, input)?;
    visiting.remove(id);
    results.insert(id.into(), result);
    Ok(())
}

fn calculate(request: Request) -> Result<ResultSet, String> {
    if request.version != 1 {
        return Err("Unsupported engine contract version.".into());
    }
    if request.nodes.len() > MAX_NODES {
        return Err("A process is limited to 50 nodes.".into());
    }
    let mut operations = HashMap::new();
    for node in &request.nodes {
        if node.id.is_empty()
            || node.id.len() > 80
            || !node
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err("Invalid process ID.".into());
        }
        if let Some(source) = node.process.source() {
            if source.is_empty()
                || source.len() > 80
                || !source
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
            {
                return Err("Invalid process source ID.".into());
            }
        }
        if operations.insert(node.id.as_str(), &node.process).is_some() {
            return Err("Process IDs must be unique.".into());
        }
    }
    let mut results = HashMap::new();
    let mut visiting = HashSet::new();
    for node in &request.nodes {
        resolve(&node.id, &operations, &mut visiting, &mut results)?;
    }
    let nodes = request
        .nodes
        .iter()
        .map(|node| results.remove(&node.id).expect("resolved node"))
        .collect();
    Ok(ResultSet { version: 1, nodes })
}

/// The only WASM entry point: bounded JSON in, calculated data and vector geometry out.
#[wasm_bindgen]
pub fn evaluate(json: &str) -> String {
    let result = if json.len() > 512_000 {
        Err("Engine request is too large.".into())
    } else {
        serde_json::from_str::<Request>(json)
            .map_err(|e| format!("Invalid engine request: {e}"))
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
    use serde_json::{json, Value};

    fn run(nodes: Value) -> Value {
        serde_json::from_str(&evaluate(
            &json!({"version": 1, "nodes": nodes}).to_string(),
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
    fn rejects_cycles_missing_sources_duplicates_unknown_operations_and_limits() {
        let cases = vec![
            json!([{"id":"a","process":{"op":"pass","from":"a"}}]),
            json!([{"id":"a","process":{"op":"pass","from":"missing"}}]),
            json!([{"id":"a","process":{"op":"source","text":""}},{"id":"a","process":{"op":"source","text":""}}]),
            json!([{"id":"a","process":{"op":"exec","command":"anything"}}]),
            json!([{"id":"a","process":{"op":"source","text":"x".repeat(1001)}}]),
            json!([{"id":"a","process":{"op":"source","text":"x\n".repeat(101)}}]),
            json!([{"id":"a","process":{"op":"source","text":"x"}},{"id":"h","process":{"op":"head","from":"a","count":101}}]),
        ];
        for case in cases {
            assert_eq!(run(case)["ok"], false);
        }
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
}
