//! Exact line endings, bounded character sets and deterministic text comparisons.
use crate::contract::{EngineError, MAX_SET, MAX_TEXT};
use std::cmp::Ordering;

pub(crate) fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// A line's text without its single terminator (LF or CRLF).
pub(crate) fn body(line: &str) -> &str {
    match line.strip_suffix('\n') {
        Some(line) => line.strip_suffix('\r').unwrap_or(line),
        None => line,
    }
}

/// The terminator a line already has, if any.
pub(crate) fn ending(line: &str) -> &str {
    &line[body(line).len()..]
}

/// The first terminator among `lines`, used to finish lines that had none (LF if none exists).
pub(crate) fn usual_ending<'a>(lines: &[&'a str]) -> &'a str {
    lines
        .iter()
        .map(|line| ending(line))
        .find(|e| !e.is_empty())
        .unwrap_or("\n")
}

/// `text` followed by `original`'s terminator, or by `fallback` when it had none. A trailing CR
/// would read as part of an LF terminator, so unterminated text ending in CR always gets CRLF.
pub(crate) fn terminated(text: &str, original: &str, fallback: &str) -> String {
    match ending(original) {
        "" if text.ends_with('\r') => format!("{text}\r\n"),
        "" => format!("{text}{fallback}"),
        terminator => format!("{text}{terminator}"),
    }
}

pub(crate) fn one_char(value: &str, what: &str) -> Result<char, EngineError> {
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
pub(crate) fn expand_set(set: &str) -> Result<Vec<char>, EngineError> {
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
pub(crate) fn compare_numbers(a: &str, b: &str) -> Ordering {
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

pub(crate) fn compare_folded(a: &str, b: &str) -> Ordering {
    a.chars()
        .flat_map(char::to_uppercase)
        .cmp(b.chars().flat_map(char::to_uppercase))
}
