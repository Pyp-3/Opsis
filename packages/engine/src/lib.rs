use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

const VERSION: u8 = 3;
const MAX_NODES: usize = 50;
const MAX_LINES: usize = 100;
const MAX_TEXT: usize = 1000;
const MAX_INPUTS: usize = 10;
const MAX_FIELDS: usize = 20;
const MAX_SET: usize = 100;

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Operation {
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
enum SortOrder {
    Asc,
    Desc,
}

impl Operation {
    /// The steps whose output this one reads, in order. Empty only for sources.
    fn sources(&self) -> Vec<&str> {
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
    /// For each output row, the input rows it was made from.
    origins: Vec<Vec<usize>>,
    /// Which step supplied each consecutive block of input rows.
    inputs: Vec<InputBlock>,
    drawing: Drawing,
}

#[derive(Clone, Serialize)]
struct InputBlock {
    id: String,
    rows: usize,
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
    InputTooLong,
    TooManyLines,
    CountOutOfRange,
    FilterTooLong,
    InvalidArgument,
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

    fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidArgument, message)
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

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
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

/// The first terminator among `lines`, used to finish lines that had none (LF if none exists).
fn usual_ending<'a>(lines: &[&'a str]) -> &'a str {
    lines
        .iter()
        .map(|line| ending(line))
        .find(|e| !e.is_empty())
        .unwrap_or("\n")
}

/// `text` followed by `original`'s terminator, or by `fallback` when it had none. A trailing CR
/// would read as part of an LF terminator, so unterminated text ending in CR always gets CRLF.
fn terminated(text: &str, original: &str, fallback: &str) -> String {
    match ending(original) {
        "" if text.ends_with('\r') => format!("{text}\r\n"),
        "" => format!("{text}{fallback}"),
        terminator => format!("{text}{terminator}"),
    }
}

fn one_char(value: &str, what: &str) -> Result<char, EngineError> {
    let mut chars = value.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c != '\n' && c != '\r' => Ok(c),
        _ => Err(EngineError::invalid(format!(
            "The {what} must be one character other than a line break."
        ))),
    }
}

/// Expand a `tr` set: literal characters and `a-z` style ranges. Line breaks are excluded so
/// every row stays one row.
fn expand_set(set: &str) -> Result<Vec<char>, EngineError> {
    if set.is_empty() || utf16_len(set) > MAX_SET {
        return Err(EngineError::invalid(
            "Translation sets must contain 1 to 100 characters.",
        ));
    }
    let chars: Vec<char> = set.chars().collect();
    let mut expanded = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if index + 2 < chars.len() && chars[index + 1] == '-' {
            let (start, end) = (chars[index], chars[index + 2]);
            if start > end {
                return Err(EngineError::invalid(format!(
                    "The range {start}-{end} is in reverse order."
                )));
            }
            if (end as u32 - start as u32) as usize + expanded.len() >= MAX_TEXT {
                return Err(EngineError::invalid(
                    "Translation ranges expand to at most 1000 characters.",
                ));
            }
            expanded.extend(start..=end);
            index += 3;
        } else {
            expanded.push(chars[index]);
            index += 1;
        }
    }
    if expanded.iter().any(|&c| c == '\n' || c == '\r') {
        return Err(EngineError::invalid(
            "Translation sets cannot include line breaks.",
        ));
    }
    Ok(expanded)
}

/// `sort -n` key comparison: optional leading blanks and minus sign, digits, optional fraction.
/// Text without a leading number counts as zero. Compared exactly, without floating point.
fn compare_numbers(a: &str, b: &str) -> Ordering {
    fn parse(text: &str) -> (bool, &str, &str) {
        let text = text.trim_start_matches([' ', '\t']);
        let (negative, rest) = match text.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, text),
        };
        let int_end = rest
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(rest.len());
        let int = rest[..int_end].trim_start_matches('0');
        let frac = match rest[int_end..].strip_prefix('.') {
            Some(after) => {
                let end = after
                    .find(|c: char| !c.is_ascii_digit())
                    .unwrap_or(after.len());
                after[..end].trim_end_matches('0')
            }
            None => "",
        };
        // Negative zero is zero.
        (negative && !(int.is_empty() && frac.is_empty()), int, frac)
    }
    let magnitude = |(_, ai, af): (bool, &str, &str), (_, bi, bf): (bool, &str, &str)| {
        ai.len().cmp(&bi.len()).then(ai.cmp(bi)).then(af.cmp(bf))
    };
    let (a, b) = (parse(a), parse(b));
    match (a.0, b.0) {
        (false, true) => Ordering::Greater,
        (true, false) => Ordering::Less,
        (false, false) => magnitude(a, b),
        (true, true) => magnitude(b, a),
    }
}

fn compare_folded(a: &str, b: &str) -> Ordering {
    a.chars()
        .flat_map(char::to_uppercase)
        .cmp(b.chars().flat_map(char::to_uppercase))
}

/// Geometry for each input row's journey to the output row it feeds, if any. Stable inputs
/// produce exactly the same vector paths.
fn drawing(rows: usize, origins: &[Vec<usize>]) -> Drawing {
    let mut targets = vec![None; rows];
    for (output, sources) in origins.iter().enumerate() {
        for &input in sources {
            targets[input] = Some(output);
        }
    }
    let height = rows.max(origins.len()).max(1) * 10 + 8;
    let paths = targets
        .iter()
        .enumerate()
        .map(|(index, target)| {
            let y = 9 + index * 10;
            match target {
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

/// Reject arguments that are malformed regardless of the data flowing through.
fn validate(operation: &Operation) -> Result<(), EngineError> {
    match operation {
        Operation::Source { text } => {
            if utf16_len(text) > MAX_TEXT || text.len() > 4 * MAX_TEXT {
                return Err(EngineError::new(
                    ErrorCode::SampleTooLong,
                    "Sample data is too long.",
                ));
            }
        }
        Operation::Head { count, .. } | Operation::Tail { count, .. } if *count > MAX_LINES => {
            return Err(EngineError::new(
                ErrorCode::CountOutOfRange,
                "Line count must be between 0 and 100.",
            ));
        }
        Operation::Filter { text, .. } if utf16_len(text) > 200 => {
            return Err(EngineError::new(
                ErrorCode::FilterTooLong,
                "Filter text is too long.",
            ));
        }
        Operation::Cut {
            fields, delimiter, ..
        } => {
            one_char(delimiter, "cut delimiter")?;
            if fields.is_empty()
                || fields.len() > MAX_FIELDS
                || fields.iter().any(|&f| f == 0 || f > MAX_LINES)
            {
                return Err(EngineError::invalid(
                    "Cut takes 1 to 20 field numbers from 1 to 100.",
                ));
            }
        }
        Operation::Translate { set1, set2, .. } => {
            expand_set(set1)?;
            expand_set(set2)?;
        }
        Operation::Concat { from } | Operation::Paste { from, .. }
            if from.len() < 2 || from.len() > MAX_INPUTS =>
        {
            return Err(EngineError::invalid("Combine 2 to 10 inputs."));
        }
        Operation::Paste { delimiter, .. } => {
            one_char(delimiter, "paste delimiter")?;
        }
        _ => {}
    }
    Ok(())
}

/// Calculate one step from its inputs' text, given as `(step id, text)` in `from` order.
fn transform(
    id: &str,
    operation: &Operation,
    inputs: &[(&str, &str)],
) -> Result<StepResult, EngineError> {
    validate(operation)?;
    let texts: Vec<&str> = match operation {
        Operation::Source { text } => vec![text],
        _ => inputs.iter().map(|&(_, text)| text).collect(),
    };
    let per_input: Vec<Vec<&str>> = texts
        .iter()
        .map(|text| text.split_inclusive('\n').collect())
        .collect();
    let lines: Vec<&str> = per_input.iter().flatten().copied().collect();
    if lines.len() > MAX_LINES {
        return Err(EngineError::new(
            ErrorCode::TooManyLines,
            "Sample data is limited to 100 lines.",
        ));
    }
    // Multiple inputs are shown stacked, one row per line, so rows never merge across inputs.
    let input: String = match texts.as_slice() {
        [text] => text.to_string(),
        _ => lines
            .iter()
            .enumerate()
            .map(|(index, line)| match ending(line) {
                "" if index + 1 < lines.len() => terminated(body(line), line, "\n"),
                _ => line.to_string(),
            })
            .collect(),
    };
    if utf16_len(&input) > MAX_TEXT {
        return Err(EngineError::new(
            ErrorCode::InputTooLong,
            "Combined input is limited to 1000 characters.",
        ));
    }
    let fallback = usual_ending(&lines);
    let identity = || {
        (0..lines.len())
            .map(|index| vec![index])
            .collect::<Vec<_>>()
    };
    let select = |keep: Vec<usize>| {
        let output: String = keep.iter().map(|&index| lines[index]).collect();
        (output, keep.into_iter().map(|index| vec![index]).collect())
    };
    let (output, origins): (String, Vec<Vec<usize>>) = match operation {
        Operation::Source { .. } | Operation::Pass { .. } => (input.clone(), identity()),
        Operation::Head { count, .. } => select((0..lines.len().min(*count)).collect()),
        Operation::Tail { count, .. } => {
            select((lines.len().saturating_sub(*count)..lines.len()).collect())
        }
        Operation::Sort {
            order,
            numeric,
            ignore_case,
            ..
        } => {
            let mut keep: Vec<usize> = (0..lines.len()).collect();
            // Like GNU sort, lines with equal keys fall back to a plain comparison.
            keep.sort_by(|&a, &b| {
                let (a, b) = (body(lines[a]), body(lines[b]));
                match (numeric, ignore_case) {
                    (true, _) => compare_numbers(a, b),
                    (false, true) => compare_folded(a, b),
                    (false, false) => Ordering::Equal,
                }
                .then_with(|| a.cmp(b))
            });
            if matches!(order, SortOrder::Desc) {
                keep.reverse();
            }
            let output = keep
                .iter()
                .map(|&index| terminated(body(lines[index]), lines[index], fallback))
                .collect();
            (output, keep.into_iter().map(|index| vec![index]).collect())
        }
        Operation::Filter {
            text,
            ignore_case,
            invert,
            ..
        } => {
            let needle = if *ignore_case {
                text.to_lowercase()
            } else {
                text.clone()
            };
            select(
                (0..lines.len())
                    .filter(|&index| {
                        let line = body(lines[index]);
                        let found = if *ignore_case {
                            line.to_lowercase().contains(&needle)
                        } else {
                            line.contains(&needle)
                        };
                        found != *invert
                    })
                    .collect(),
            )
        }
        Operation::Unique { with_counts, .. } => {
            // Like uniq: collapse adjacent equal lines; do not silently sort or deduplicate globally.
            let mut groups: Vec<Vec<usize>> = Vec::new();
            for index in 0..lines.len() {
                match groups.last_mut() {
                    Some(group) if body(lines[group[0]]) == body(lines[index]) => group.push(index),
                    _ => groups.push(vec![index]),
                }
            }
            if *with_counts {
                let output = groups
                    .iter()
                    .map(|group| {
                        let first = lines[group[0]];
                        terminated(
                            &format!("{:>7} {}", group.len(), body(first)),
                            first,
                            fallback,
                        )
                    })
                    .collect();
                (output, groups)
            } else {
                select(groups.into_iter().map(|group| group[0]).collect())
            }
        }
        Operation::Count { .. } => {
            // Like wc -l: count terminators, so an unterminated final line is not counted.
            let counted: Vec<usize> = (0..lines.len())
                .filter(|&index| !ending(lines[index]).is_empty())
                .collect();
            (format!("{}\n", counted.len()), vec![counted])
        }
        Operation::Cut {
            fields, delimiter, ..
        } => {
            let delimiter = one_char(delimiter, "cut delimiter")?;
            let mut wanted = fields.clone();
            wanted.sort_unstable();
            wanted.dedup();
            // Like cut -f: fields print in input order; lines without the delimiter print whole.
            let output = lines
                .iter()
                .map(|line| {
                    let text = body(line);
                    let kept = if text.contains(delimiter) {
                        let parts: Vec<&str> = text.split(delimiter).collect();
                        wanted
                            .iter()
                            .filter_map(|&field| parts.get(field - 1).copied())
                            .collect::<Vec<_>>()
                            .join(&delimiter.to_string())
                    } else {
                        text.to_string()
                    };
                    terminated(&kept, line, fallback)
                })
                .collect();
            (output, identity())
        }
        Operation::Translate { set1, set2, .. } => {
            let (set1, set2) = (expand_set(set1)?, expand_set(set2)?);
            // Like tr: a shorter second set repeats its last character; later mappings win.
            let mut map = HashMap::new();
            for (index, &c) in set1.iter().enumerate() {
                map.insert(c, set2.get(index).copied().unwrap_or(set2[set2.len() - 1]));
            }
            let output = input
                .chars()
                .map(|c| map.get(&c).copied().unwrap_or(c))
                .collect();
            (output, identity())
        }
        Operation::Concat { .. } => {
            // Like cat: bytes join exactly, so an unterminated last line runs into the next input.
            let mut origins: Vec<Vec<usize>> = Vec::new();
            let mut open = false;
            for (index, line) in lines.iter().enumerate() {
                match origins.last_mut() {
                    Some(row) if open => row.push(index),
                    _ => origins.push(vec![index]),
                }
                open = ending(line).is_empty();
            }
            (texts.concat(), origins)
        }
        Operation::Paste { delimiter, .. } => {
            let delimiter = one_char(delimiter, "paste delimiter")?.to_string();
            let starts: Vec<usize> = per_input
                .iter()
                .scan(0, |start, rows| {
                    let first = *start;
                    *start += rows.len();
                    Some(first)
                })
                .collect();
            let rows = per_input.iter().map(Vec::len).max().unwrap_or(0);
            let mut output = String::new();
            let mut origins = Vec::new();
            // Like paste: row n joins line n of every input; missing lines are empty fields.
            for row in 0..rows {
                let fields: Vec<&str> = per_input
                    .iter()
                    .map(|lines| lines.get(row).map_or("", |line| body(line)))
                    .collect();
                output.push_str(&fields.join(&delimiter));
                output.push('\n');
                origins.push(
                    per_input
                        .iter()
                        .zip(&starts)
                        .filter(|(lines, _)| row < lines.len())
                        .map(|(_, start)| start + row)
                        .collect(),
                );
            }
            (output, origins)
        }
    };
    if utf16_len(&output) > MAX_TEXT {
        return Err(EngineError::new(
            ErrorCode::OutputTooLong,
            "Calculated output is limited to 1000 characters. Shorten the sample.",
        ));
    }
    let inputs = match operation {
        Operation::Source { .. } => Vec::new(),
        _ => inputs
            .iter()
            .zip(&per_input)
            .map(|(&(id, _), rows)| InputBlock {
                id: id.into(),
                rows: rows.len(),
            })
            .collect(),
    };
    let drawing = drawing(lines.len(), &origins);
    Ok(StepResult {
        id: id.into(),
        input,
        output,
        input_rows: lines.len(),
        output_rows: origins.len(),
        origins,
        inputs,
        drawing,
    })
}

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
            &json!({"version": 3, "nodes": nodes}).to_string(),
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
        assert_eq!(result["result"]["nodes"][0]["origins"], json!([[0], [1]]));
        assert_eq!(
            result["result"]["nodes"][0]["inputs"],
            json!([{"id": "cat", "rows": 3}])
        );
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
        assert_eq!(nodes[2]["origins"], json!([[1], [0], [2], [3]]));
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
        assert_eq!(
            drawing(3, &[vec![2], vec![0]]).paths[0].d,
            "M 6 9 C 42 9 78 19 114 19"
        );
    }

    fn outputs(nodes: Value) -> Vec<Value> {
        let result = run(nodes);
        assert_eq!(result["ok"], true, "{result}");
        result["result"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| {
                assert_eq!(node["status"], "ok", "{node}");
                node["output"].clone()
            })
            .collect()
    }

    #[test]
    fn sorts_numerically_and_case_insensitively_like_gnu_sort() {
        let out = outputs(json!([
            {"id": "s", "process": {"op": "source", "text": "10 b\n9\n-2\n 3.5\nx\n-0\n3.50\n007"}},
            {"id": "n", "process": {"op": "sort", "from": "s", "order": "asc", "numeric": true}},
            {"id": "r", "process": {"op": "sort", "from": "s", "order": "desc", "numeric": true}},
            {"id": "w", "process": {"op": "source", "text": "beta\nAlpha\nalpha\nBeta"}},
            {"id": "f", "process": {"op": "sort", "from": "w", "order": "asc", "ignoreCase": true}},
            {"id": "plain", "process": {"op": "sort", "from": "w", "order": "asc"}}
        ]));
        // Zero-valued lines (no number, -0) tie and fall back to plain order.
        assert_eq!(out[1], "-2\n-0\nx\n 3.5\n3.50\n007\n9\n10 b\n");
        assert_eq!(out[2], "10 b\n9\n007\n3.50\n 3.5\nx\n-0\n-2\n");
        assert_eq!(out[4], "Alpha\nalpha\nBeta\nbeta\n");
        assert_eq!(out[5], "Alpha\nBeta\nalpha\nbeta\n");
    }

    #[test]
    fn filters_ignoring_case_and_inverted() {
        let out = outputs(json!([
            {"id": "s", "process": {"op": "source", "text": "Error: disk\nok\nerror: net\nfine"}},
            {"id": "i", "process": {"op": "filter", "from": "s", "text": "ERROR", "ignoreCase": true}},
            {"id": "v", "process": {"op": "filter", "from": "s", "text": "rror", "invert": true}},
            {"id": "iv", "process": {"op": "filter", "from": "s", "text": "ERROR", "ignoreCase": true, "invert": true}}
        ]));
        assert_eq!(out[1], "Error: disk\nerror: net\n");
        assert_eq!(out[2], "ok\nfine");
        assert_eq!(out[3], "ok\nfine");
    }

    #[test]
    fn counts_adjacent_duplicates_like_uniq_c() {
        let result = run(json!([
            {"id": "s", "process": {"op": "source", "text": "a\na\nb\na\r\na"}},
            {"id": "c", "process": {"op": "unique", "from": "s", "withCounts": true}}
        ]));
        let node = &result["result"]["nodes"][1];
        assert_eq!(node["output"], "      2 a\n      1 b\n      2 a\r\n");
        assert_eq!(node["origins"], json!([[0, 1], [2], [3, 4]]));
        assert_eq!(node["drawing"]["paths"][1]["kept"], true);
    }

    #[test]
    fn counts_terminated_lines_like_wc_l() {
        for (text, expected, origins) in [
            ("a\nb\nc", "2\n", json!([[0, 1]])),
            ("a\nb\n", "2\n", json!([[0, 1]])),
            ("", "0\n", json!([[]])),
        ] {
            let result = run(json!([
                {"id": "s", "process": {"op": "source", "text": text}},
                {"id": "wc", "process": {"op": "count", "from": "s"}}
            ]));
            let node = &result["result"]["nodes"][1];
            assert_eq!(node["output"], expected);
            assert_eq!(node["origins"], origins);
            assert_eq!(node["outputRows"], 1);
        }
    }

    #[test]
    fn cuts_fields_like_cut() {
        let out = outputs(json!([
            {"id": "s", "process": {"op": "source", "text": "alex,31,nairobi\nno delimiter\nblair,,kisumu\r\nshort,1"}},
            {"id": "c", "process": {"op": "cut", "from": "s", "fields": [3, 1, 3], "delimiter": ","}},
            {"id": "t", "process": {"op": "source", "text": "a\tb\tc\n"}},
            {"id": "tab", "process": {"op": "cut", "from": "t", "fields": [2]}}
        ]));
        assert_eq!(
            out[1],
            "alex,nairobi\nno delimiter\nblair,kisumu\r\nshort\n"
        );
        assert_eq!(out[3], "b\n");
    }

    #[test]
    fn translates_characters_like_tr() {
        let out = outputs(json!([
            {"id": "s", "process": {"op": "source", "text": "Hello, World\r\nabc-xyz"}},
            {"id": "up", "process": {"op": "translate", "from": "s", "set1": "a-z", "set2": "A-Z"}},
            {"id": "pad", "process": {"op": "translate", "from": "s", "set1": "lo-", "set2": "0_"}},
            {"id": "last", "process": {"op": "translate", "from": "s", "set1": "aa", "set2": "xy"}}
        ]));
        assert_eq!(out[1], "HELLO, WORLD\r\nABC-XYZ");
        assert_eq!(out[2], "He00_, W_r0d\r\nabc_xyz");
        assert_eq!(out[3], "Hello, World\r\nybc-xyz");
    }

    #[test]
    fn concatenates_bytes_exactly_like_cat() {
        let result = run(json!([
            {"id": "a", "process": {"op": "source", "text": "one\ntwo"}},
            {"id": "b", "process": {"op": "source", "text": "three\nfour\n"}},
            {"id": "cat", "process": {"op": "concat", "from": ["a", "b", "a"]}}
        ]));
        let node = &result["result"]["nodes"][2];
        assert_eq!(node["output"], "one\ntwothree\nfour\none\ntwo");
        assert_eq!(node["input"], "one\ntwo\nthree\nfour\none\ntwo");
        assert_eq!(node["origins"], json!([[0], [1, 2], [3], [4], [5]]));
        assert_eq!(
            node["inputs"],
            json!([{"id": "a", "rows": 2}, {"id": "b", "rows": 2}, {"id": "a", "rows": 2}])
        );
        assert_eq!(node["inputRows"], 6);
        assert_eq!(node["outputRows"], 5);
    }

    #[test]
    fn pastes_rows_side_by_side_like_paste() {
        let result = run(json!([
            {"id": "names", "process": {"op": "source", "text": "alex\nblair\ncasey"}},
            {"id": "ages", "process": {"op": "source", "text": "31\r\n27\r\n"}},
            {"id": "p", "process": {"op": "paste", "from": ["names", "ages"]}},
            {"id": "comma", "process": {"op": "paste", "from": ["ages", "names"], "delimiter": ","}}
        ]));
        let nodes = &result["result"]["nodes"];
        assert_eq!(nodes[2]["output"], "alex\t31\nblair\t27\ncasey\t\n");
        assert_eq!(nodes[2]["origins"], json!([[0, 3], [1, 4], [2]]));
        assert_eq!(nodes[3]["output"], "31,alex\n27,blair\n,casey\n");
    }

    #[test]
    fn rejects_malformed_arguments_on_their_node() {
        let cases = [
            json!({"op": "cut", "from": "s", "fields": [], "delimiter": ","}),
            json!({"op": "cut", "from": "s", "fields": [0], "delimiter": ","}),
            json!({"op": "cut", "from": "s", "fields": [1], "delimiter": ",,"}),
            json!({"op": "cut", "from": "s", "fields": [1], "delimiter": "\n"}),
            json!({"op": "translate", "from": "s", "set1": "z-a", "set2": "x"}),
            json!({"op": "translate", "from": "s", "set1": "\t-~", "set2": "x"}),
            json!({"op": "translate", "from": "s", "set1": "a", "set2": ""}),
            json!({"op": "translate", "from": "s", "set1": "\u{0}-\u{10FFFF}", "set2": "x"}),
            json!({"op": "concat", "from": ["s"]}),
            json!({"op": "paste", "from": ["s", "s"], "delimiter": ""}),
        ];
        for process in cases {
            let result = run(json!([
                {"id": "s", "process": {"op": "source", "text": "a,b"}},
                {"id": "x", "process": process}
            ]));
            assert_eq!(result["result"]["nodes"][0]["status"], "ok");
            assert_eq!(
                result["result"]["nodes"][1]["error"]["code"], "invalid_argument",
                "{process}"
            );
        }
    }

    #[test]
    fn combined_inputs_respect_row_and_size_limits_and_failures() {
        let half = "x\n".repeat(60);
        let result = run(json!([
            {"id": "a", "process": {"op": "source", "text": half}},
            {"id": "lines", "process": {"op": "concat", "from": ["a", "a"]}},
            {"id": "b", "process": {"op": "head", "from": "a", "count": 101}},
            {"id": "c", "process": {"op": "paste", "from": ["a", "b"]}},
            {"id": "loop", "process": {"op": "concat", "from": ["a", "loop"]}}
        ]));
        let nodes = &result["result"]["nodes"];
        assert_eq!(nodes[1]["error"]["code"], "too_many_lines");
        assert_eq!(nodes[3]["error"]["code"], "upstream_failed");
        assert_eq!(nodes[3]["error"]["source"], "b");
        assert_eq!(nodes[4]["error"]["code"], "cycle");
        let wide = "y".repeat(600);
        let result = run(json!([
            {"id": "a", "process": {"op": "source", "text": wide}},
            {"id": "p", "process": {"op": "paste", "from": ["a", "a"]}}
        ]));
        assert_eq!(
            result["result"]["nodes"][1]["error"]["code"],
            "input_too_long"
        );
    }

    #[test]
    fn compares_numbers_exactly() {
        for (a, b, expected) in [
            ("2", "10", Ordering::Less),
            ("0010", "10", Ordering::Equal),
            ("-0", "0", Ordering::Equal),
            ("-0.0", "abc", Ordering::Equal),
            ("1.5", "1.50", Ordering::Equal),
            ("1.05", "1.5", Ordering::Less),
            ("-3", "-20", Ordering::Greater),
            ("-1", "0", Ordering::Less),
            (
                "99999999999999999999",
                "99999999999999999998",
                Ordering::Greater,
            ),
            ("\t 4x", "4", Ordering::Equal),
        ] {
            assert_eq!(compare_numbers(a, b), expected, "{a} vs {b}");
        }
    }

    /// Short lines over a tiny alphabet, so duplicates, CR, delimiters, digits and missing final
    /// LF are common.
    fn sample() -> impl Strategy<Value = String> {
        let line = prop::collection::vec(
            prop::sample::select(vec!['a', 'B', 'c', '1', '-', ',', '\r']),
            0..5,
        )
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

    /// Single-input operations reading from `s`.
    fn operation() -> impl Strategy<Value = Operation> {
        let s = || String::from("s");
        prop_oneof![
            Just(Operation::Pass { from: s() }),
            (0..15usize).prop_map(move |count| Operation::Head { from: s(), count }),
            (0..15usize).prop_map(move |count| Operation::Tail { from: s(), count }),
            (prop::bool::ANY, prop::bool::ANY, prop::bool::ANY).prop_map(
                move |(asc, numeric, ignore_case)| Operation::Sort {
                    from: s(),
                    order: if asc { SortOrder::Asc } else { SortOrder::Desc },
                    numeric,
                    ignore_case,
                }
            ),
            (
                prop::sample::select(vec!["", "a", "B", "ab", "\r", "1"]),
                prop::bool::ANY,
                prop::bool::ANY
            )
                .prop_map(move |(text, ignore_case, invert)| Operation::Filter {
                    from: s(),
                    text: text.into(),
                    ignore_case,
                    invert,
                }),
            prop::bool::ANY.prop_map(move |with_counts| Operation::Unique {
                from: s(),
                with_counts
            }),
            Just(Operation::Count { from: s() }),
            (
                prop::collection::vec(1..5usize, 1..4),
                prop::sample::select(vec![",", "-", "a"])
            )
                .prop_map(move |(fields, delimiter)| Operation::Cut {
                    from: s(),
                    fields,
                    delimiter: delimiter.into(),
                }),
            (
                prop::sample::select(vec!["a-c", "aB", "-1", "a"]),
                prop::sample::select(vec!["x", "X-Z", "12"])
            )
                .prop_map(move |(set1, set2)| Operation::Translate {
                    from: s(),
                    set1: set1.into(),
                    set2: set2.into(),
                }),
        ]
    }

    fn check_mapping(result: &StepResult) -> Result<(), TestCaseError> {
        prop_assert_eq!(result.output_rows, result.origins.len());
        prop_assert_eq!(result.drawing.paths.len(), result.input_rows);
        let output: Vec<&str> = result.output.split_inclusive('\n').collect();
        // Count always prints one line, even for empty input.
        prop_assert_eq!(output.len(), result.origins.len());
        let mut seen: Vec<usize> = result.origins.iter().flatten().copied().collect();
        let total = seen.len();
        seen.sort_unstable();
        seen.dedup();
        prop_assert_eq!(
            seen.len(),
            total,
            "an input row feeds at most one output row"
        );
        prop_assert!(seen.iter().all(|&row| row < result.input_rows));
        for (trace, row) in result.drawing.paths.iter().zip(0..) {
            prop_assert_eq!(trace.kept, seen.binary_search(&row).is_ok());
        }
        Ok(())
    }

    proptest! {
        #[test]
        fn every_operation_keeps_its_provenance_consistent(text in sample(), op in operation()) {
            let lines: Vec<&str> = text.split_inclusive('\n').collect();
            let result = transform("t", &op, &[("s", &text)]).unwrap();
            prop_assert_eq!(result.input_rows, lines.len());
            prop_assert_eq!(&result.input, &text);
            check_mapping(&result)?;
            let output: Vec<&str> = result.output.split_inclusive('\n').collect();
            let single: Vec<usize> = result.origins.iter().map(|o| o.first().copied().unwrap_or(usize::MAX)).collect();
            let rows_preserved = |result: &StepResult| result.origins.iter().all(|o| o.len() == 1);
            match &op {
                Operation::Pass { .. } | Operation::Head { .. } | Operation::Tail { .. } | Operation::Filter { .. } | Operation::Unique { with_counts: false, .. } => {
                    prop_assert!(rows_preserved(&result));
                    let kept: String = single.iter().map(|&i| lines[i]).collect();
                    prop_assert_eq!(&result.output, &kept);
                }
                _ => {}
            }
            match &op {
                Operation::Head { count, .. } => {
                    prop_assert_eq!(&single, &(0..(*count).min(lines.len())).collect::<Vec<_>>());
                }
                Operation::Tail { count, .. } => {
                    prop_assert_eq!(&single, &(lines.len().saturating_sub(*count)..lines.len()).collect::<Vec<_>>());
                }
                Operation::Filter { text: needle, ignore_case, invert, .. } => {
                    for (index, line) in lines.iter().enumerate() {
                        let found = if *ignore_case {
                            body(line).to_lowercase().contains(&needle.to_lowercase())
                        } else {
                            body(line).contains(needle.as_str())
                        };
                        prop_assert_eq!(single.contains(&index), found != *invert);
                    }
                }
                Operation::Sort { order, numeric, ignore_case, .. } => {
                    prop_assert!(rows_preserved(&result));
                    prop_assert!(output.iter().all(|line| !ending(line).is_empty()));
                    for (line, &index) in output.iter().zip(&single) {
                        prop_assert_eq!(body(line), body(lines[index]));
                    }
                    let bodies: Vec<&str> = output.iter().map(|line| body(line)).collect();
                    for pair in bodies.windows(2) {
                        let key = if *numeric {
                            compare_numbers(pair[0], pair[1])
                        } else if *ignore_case {
                            compare_folded(pair[0], pair[1])
                        } else {
                            Ordering::Equal
                        }
                        .then_with(|| pair[0].cmp(pair[1]));
                        prop_assert_ne!(key, if matches!(order, SortOrder::Asc) { Ordering::Greater } else { Ordering::Less });
                    }
                }
                Operation::Unique { with_counts, .. } => {
                    // Groups are contiguous runs of equal lines, and neighbouring groups differ.
                    for group in &result.origins {
                        prop_assert!(group.windows(2).all(|w| w[1] == w[0] + 1));
                        prop_assert!(group.iter().all(|&i| body(lines[i]) == body(lines[group[0]])));
                    }
                    prop_assert!(result.origins.windows(2).all(|w| body(lines[w[0][0]]) != body(lines[w[1][0]])));
                    if *with_counts {
                        prop_assert_eq!(result.origins.iter().map(Vec::len).sum::<usize>(), lines.len());
                        for (line, group) in output.iter().zip(&result.origins) {
                            prop_assert_eq!(body(line), format!("{:>7} {}", group.len(), body(lines[group[0]])));
                        }
                    }
                }
                Operation::Count { .. } => {
                    prop_assert_eq!(&result.output, &format!("{}\n", text.matches('\n').count()));
                }
                Operation::Cut { .. } => {
                    prop_assert!(rows_preserved(&result));
                    prop_assert!(output.iter().all(|line| !ending(line).is_empty()));
                }
                Operation::Translate { .. } => {
                    prop_assert!(rows_preserved(&result));
                    prop_assert_eq!(result.output.chars().count(), text.chars().count());
                    for (line, original) in output.iter().zip(&lines) {
                        prop_assert_eq!(ending(line), ending(original));
                    }
                }
                _ => {}
            }
        }

        #[test]
        fn combining_inputs_keeps_every_row_accounted_for(
            texts in prop::collection::vec(sample(), 2..4),
            paste in prop::bool::ANY,
        ) {
            let ids: Vec<String> = (0..texts.len()).map(|i| format!("in{i}")).collect();
            let inputs: Vec<(&str, &str)> = ids.iter().map(String::as_str).zip(texts.iter().map(String::as_str)).collect();
            let from = ids.clone();
            let op = if paste {
                Operation::Paste { from, delimiter: "\t".into() }
            } else {
                Operation::Concat { from }
            };
            let result = transform("t", &op, &inputs).unwrap();
            check_mapping(&result)?;
            let rows: Vec<usize> = texts.iter().map(|t| t.split_inclusive('\n').count()).collect();
            prop_assert_eq!(result.input_rows, rows.iter().sum::<usize>());
            prop_assert_eq!(result.input.split_inclusive('\n').count(), result.input_rows);
            prop_assert_eq!(result.inputs.iter().map(|block| block.rows).collect::<Vec<_>>(), rows.clone());
            // Every input row reaches the output.
            prop_assert!(result.drawing.paths.iter().all(|trace| trace.kept));
            if paste {
                prop_assert_eq!(result.output_rows, rows.iter().copied().max().unwrap_or(0));
                for line in result.output.split_inclusive('\n') {
                    prop_assert_eq!(line.matches('\t').count(), texts.len() - 1);
                }
            } else {
                prop_assert_eq!(&result.output, &texts.concat());
            }
        }

        #[test]
        fn arbitrary_graphs_never_fail_the_whole_request(
            steps in prop::collection::vec((prop::collection::vec(0..10usize, 0..4), sample()), 1..8)
        ) {
            let nodes: Vec<Value> = steps.iter().enumerate().map(|(index, (from, text))| {
                let names: Vec<String> = from.iter().map(|source| format!("n{source}")).collect();
                let process = match names.as_slice() {
                    [] => json!({"op": "source", "text": text}),
                    [one] => json!({"op": "pass", "from": one}),
                    _ => json!({"op": "concat", "from": names}),
                };
                json!({"id": format!("n{index}"), "process": process})
            }).collect();
            let result = run(Value::Array(nodes));
            prop_assert_eq!(&result["ok"], true);
            let outcomes = result["result"]["nodes"].as_array().unwrap();
            prop_assert_eq!(outcomes.len(), steps.len());
            let by_id: HashMap<&str, &Value> = outcomes.iter().map(|n| (n["id"].as_str().unwrap(), n)).collect();
            for outcome in outcomes {
                if outcome["error"]["code"] == "upstream_failed" {
                    let source = by_id[outcome["error"]["source"].as_str().unwrap()];
                    prop_assert_eq!(&source["status"], "failed");
                }
                if outcome["status"] == "ok" {
                    for block in outcome["inputs"].as_array().unwrap() {
                        prop_assert_eq!(&by_id[block["id"].as_str().unwrap()]["status"], "ok");
                    }
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
