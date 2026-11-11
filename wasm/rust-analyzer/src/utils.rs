use cargo_toml::Manifest;
use ide_db::base_db::{CrateGraph, CrateId, FileId, FileSet, SourceRoot, VfsPath};

/// Search the given source roots to find the crate with a matching name.
// TODO(HOO-2754): key crates by name and version so renamed and multi-version dependencies resolve generally
pub fn get_file_id<'a, 'b>(name: &'a str, source_roots: &'b Vec<SourceRoot>) -> Option<&'b FileId> {
    source_roots
        .iter()
        .find_map(|root| root.file_for_path(&get_crate_path(name)))
}

/// Get the file id from [get_file_id] and find the crate id from the given crate graph.
pub fn get_crate_id(
    name: &str,
    source_roots: &Vec<SourceRoot>,
    crate_graph: &CrateGraph,
) -> Option<CrateId> {
    get_file_id(name, source_roots)
        .and_then(|file_id| crate_graph.crate_id_for_crate_root(*file_id))
}

/// Create a source root for a library with one file.
pub fn create_source_root(name: &str, file_id: FileId) -> SourceRoot {
    let mut file_set = FileSet::default();
    file_set.insert(file_id, get_crate_path(name));
    SourceRoot::new_library(file_set)
}

/// The features the lockfile enables for a crate, which `generate-crates.mjs` writes to
/// `[package.metadata.solana-playground] features`; none when the manifest has no such list.
pub fn get_enabled_features(manifest: &Manifest) -> Vec<String> {
    manifest
        .package
        .as_ref()
        .and_then(|package| package.metadata.as_ref())
        .and_then(|metadata| {
            metadata
                .get("solana-playground")?
                .get("features")?
                .as_array()
        })
        .map(|features| {
            features
                .iter()
                .filter_map(|feature| feature.as_str().map(ToOwned::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Get the file position.
pub fn get_file_position(
    line_number: u32,
    column: u32,
    line_index: &ide::LineIndex,
    file_id: ide::FileId,
) -> ide::FilePosition {
    ide::FilePosition {
        file_id,
        offset: line_index
            .offset(ide::LineCol {
                line: line_number - 1,
                col: column - 1,
            })
            .unwrap(),
    }
}

/// Get the crate root path for the given crate name.
fn get_crate_path(name: &str) -> VfsPath {
    VfsPath::new_virtual_path(format!("/{name}/src/lib.rs"))
}
