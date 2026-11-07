//! Prints the IDL of the program crate at the path given, as Anchor 1.1.2's
//! `anchor idl build` would, on one line
use anchor_lang_idl::build::IdlBuilder;
use std::path::PathBuf;

fn main() {
    let path = std::env::args().nth(1).expect("usage: generator <program dir>");
    let idl = IdlBuilder::new()
        .program_path(PathBuf::from(path))
        .no_docs(true)
        .skip_lint(true)
        .build()
        .unwrap_or_else(|e| {
            eprintln!("{e:#}");
            std::process::exit(1);
        });
    println!("{}", serde_json::to_string(&idl).expect("an IDL serialises"));
}
