//! Native end-to-end evaluation benchmark; fixtures arrive on stdin, outside the core.
use std::io::{self, Read};
use std::time::Instant;

fn main() {
    let mut request = String::new();
    io::stdin().read_to_string(&mut request).unwrap();
    for _ in 0..20 {
        std::hint::black_box(opsis_engine::evaluate(&request));
    }
    let mut samples = Vec::with_capacity(100);
    for _ in 0..100 {
        let start = Instant::now();
        std::hint::black_box(opsis_engine::evaluate(&request));
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({"native": {"p50Ms": samples[49], "p95Ms": samples[94]}})
    );
}
