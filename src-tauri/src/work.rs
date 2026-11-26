//! The running app's scratch folder (D-39): untitled projects' takes, voice-design candidates and trimmed
//! references. Each app instance gets `work/<uuid>/` and holds `.lock` in it open without sharing, so a later
//! start can tell its folder from one an exited (or crashed) instance left behind and sweep only the latter.

use std::fs::File;
use std::path::{Path, PathBuf};

const LOCK: &str = ".lock";
/// Subfolders of the instance folder that are not an untitled project's takes.
pub const DESIGN: &str = "design";
pub const TRIMMED: &str = "trimmed";

pub struct WorkDir {
    root: PathBuf,
    _lock: File,
}

fn open_exclusive(p: &Path) -> std::io::Result<File> {
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        o.share_mode(0);
    }
    o.open(p)
}

/// Whether another running instance holds `dir`.
fn in_use(dir: &Path) -> bool {
    let p = dir.join(LOCK);
    if !p.exists() {
        return false;
    }
    // Opening fails with a sharing violation while the owner runs; any other failure is treated as in use too.
    open_exclusive(&p).is_err()
}

/// Removes every folder (and stray file) under `base` that no running instance holds. Returns how many it removed.
pub fn sweep(base: &Path) -> usize {
    let Ok(rd) = std::fs::read_dir(base) else {
        return 0;
    };
    let mut n = 0;
    for e in rd.flatten() {
        let p = e.path();
        let ok = if p.is_dir() {
            !in_use(&p) && std::fs::remove_dir_all(&p).is_ok()
        } else {
            std::fs::remove_file(&p).is_ok()
        };
        if ok {
            n += 1;
        }
    }
    n
}

impl WorkDir {
    /// Sweeps what earlier instances left in `base`, then makes this instance's folder.
    pub fn open(base: &Path) -> std::io::Result<WorkDir> {
        sweep(base);
        let root = base.join(uuid::Uuid::new_v4().simple().to_string());
        std::fs::create_dir_all(&root)?;
        let lock = open_exclusive(&root.join(LOCK))?;
        Ok(WorkDir { root, _lock: lock })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// `root/name`, created.
    pub fn sub(&self, name: &str) -> std::io::Result<PathBuf> {
        let d = self.root.join(name);
        std::fs::create_dir_all(&d)?;
        Ok(d)
    }

    /// Whether `dir` is an untitled project's takes folder made by `project_new`.
    pub fn is_project_dir(&self, dir: &Path) -> bool {
        dir.parent() == Some(self.root.as_path())
            && dir
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n != DESIGN && n != TRIMMED && n != LOCK)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sweeps_folders_of_exited_instances_only() {
        let base = tempfile::tempdir().unwrap();
        // Left by an older version (no lock) and by an instance that has exited.
        let legacy = base.path().join("0123abcd");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("take.wav"), b"RIFF").unwrap();
        let exited = WorkDir::open(base.path()).unwrap();
        let exited_root = exited.root().to_path_buf();
        std::fs::write(exited.sub(DESIGN).unwrap().join("c.wav"), b"RIFF").unwrap();
        drop(exited);

        let running = WorkDir::open(base.path()).unwrap();
        assert!(!legacy.exists());
        assert!(!exited_root.exists());
        let take = running.root().join("p1").join("take.wav");
        std::fs::create_dir_all(take.parent().unwrap()).unwrap();
        std::fs::write(&take, b"RIFF").unwrap();

        // A second instance starting now must leave the running one's folder alone.
        let second = WorkDir::open(base.path()).unwrap();
        if cfg!(windows) {
            assert!(take.exists());
        }
        assert!(second.root().exists());
    }

    #[test]
    fn project_dirs_are_direct_children_except_reserved() {
        let base = tempfile::tempdir().unwrap();
        let w = WorkDir::open(base.path()).unwrap();
        assert!(w.is_project_dir(&w.root().join("abc")));
        assert!(!w.is_project_dir(&w.root().join(DESIGN)));
        assert!(!w.is_project_dir(&w.root().join(TRIMMED)));
        assert!(!w.is_project_dir(w.root()));
        assert!(!w.is_project_dir(&w.root().join("abc").join("x")));
        assert!(!w.is_project_dir(Path::new("E:/elsewhere/abc")));
    }
}
