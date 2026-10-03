//! Turn row provenance into deterministic SVG path data.
use crate::contract::{Drawing, Trace};

/// Geometry for each input row's journey to the output row it feeds, if any. Stable inputs
/// produce exactly the same vector paths.
pub(crate) fn drawing(rows: usize, origins: &[Vec<usize>]) -> Drawing {
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
