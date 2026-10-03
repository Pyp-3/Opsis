use crate::contract::*;
use crate::drawing::drawing;
use crate::evaluate;
use crate::operations::transform;
use crate::text::*;
use proptest::prelude::*;
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::HashMap;

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
        serde_json::from_str(&evaluate(&json!({"version": 1, "nodes": []}).to_string())).unwrap();
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
    // Keep replaying the recorded seeds after moving tests out of lib.rs.
    #![proptest_config(ProptestConfig {
        failure_persistence: Some(Box::new(
            proptest::test_runner::FileFailurePersistence::Direct("proptest-regressions/lib.txt")
        )),
        ..ProptestConfig::default()
    })]
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
