//! Validate and calculate one operation from the exact text of its inputs.
use crate::contract::{
    EngineError, ErrorCode, InputBlock, Operation, SortOrder, StepResult, MAX_FIELDS, MAX_INPUTS,
    MAX_LINES, MAX_TEXT,
};
use crate::drawing::drawing;
use crate::text::ending;
use crate::text::{
    body, compare_folded, compare_numbers, expand_set, one_char, terminated, usual_ending,
    utf16_len,
};
use std::cmp::Ordering;
use std::collections::HashMap;

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
pub(crate) fn transform(
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
