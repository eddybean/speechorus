//! Versioned JSON files the app keeps for itself (`settings.json`, `voices.json`) (D-61).
//!
//! Each file carries a format version. Loading reads it, upgrades an older file one step at a time with the caller's
//! `migrate`, and turns the result into the caller's type. A file that cannot be read is moved aside, and a file
//! written by a newer version is copied aside, before the app goes on, so that the next save never silently replaces
//! what the user had. The caller shows `notice` to the user.

use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde_json::Value;

/// What [`load`] found.
pub struct Loaded<T> {
    /// None when there is no file, or when it could not be read (it was moved aside; see `notice`).
    pub value: Option<T>,
    /// Something the user should be told: the file was unreadable, or newer than this version.
    pub notice: Option<String>,
}

/// One step of an upgrade: turns a file of version `from` into version `from + 1`.
pub type Migrate = fn(&mut Value, u32) -> Result<(), String>;

/// Reads `path`, a JSON file of format `current`.
/// - `version_of` gives the version of a file as read (for a file older than the version member, what it was).
/// - `migrate` is called for each version from the file's up to `current - 1`.
/// - `what` names the file to the user (`アプリ設定`).
pub fn load<T: DeserializeOwned>(
    path: &Path,
    current: u32,
    version_of: fn(&Value) -> u32,
    migrate: Migrate,
    what: &str,
) -> Loaded<T> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Loaded { value: None, notice: None },
        Err(e) => return unreadable(path, what, &e.to_string()),
    };
    let mut v: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return unreadable(path, what, &e.to_string()),
    };
    let version = version_of(&v);
    let mut notice = None;
    if version > current {
        // Read what this version understands; members it does not know are kept by the caller's `extra`. The next
        // save writes this version's format, so keep the newer file as it was.
        // One copy is enough: until this version saves, every start finds the same newer file.
        let tag = format!("v{version}");
        let (kept, copied) = match existing_backup(path, &tag) {
            Some(k) => (k, Ok(0)),
            None => {
                let k = backup_path(path, &tag);
                let r = std::fs::copy(path, &k);
                (k, r)
            }
        };
        notice = Some(match copied {
            Ok(_) => format!(
                "{what}は新しいバージョンの形式 (v{version}) で保存されています。読める範囲で読み込みました。元のファイルは {} に残しています。",
                kept.display()
            ),
            Err(e) => format!(
                "{what}は新しいバージョンの形式 (v{version}) で保存されています。読める範囲で読み込みましたが、元のファイルを残せませんでした ({e})。"
            ),
        });
    } else {
        for from in version..current {
            if let Err(e) = migrate(&mut v, from) {
                return unreadable(path, what, &format!("v{from} からの変換に失敗: {e}"));
            }
        }
    }
    match serde_json::from_value(v) {
        Ok(t) => Loaded { value: Some(t), notice },
        Err(e) => unreadable(path, what, &e.to_string()),
    }
}

/// Moves an unreadable file aside, so that the defaults the caller goes on with do not overwrite it.
fn unreadable<T>(path: &Path, what: &str, why: &str) -> Loaded<T> {
    let aside = backup_path(path, "broken");
    let notice = match std::fs::rename(path, &aside) {
        Ok(()) => format!(
            "{what}を読めなかったため初期設定で起動しました ({why})。元のファイルは {} に移しました。",
            aside.display()
        ),
        Err(e) => format!(
            "{what}を読めなかったため初期設定で起動しました ({why})。元のファイルを退避できませんでした ({e})。"
        ),
    };
    Loaded { value: None, notice: Some(notice) }
}

/// `settings.json` → `settings.json.<tag>-<unix seconds>` (with `-2`, `-3`… when that exists).
fn backup_path(path: &Path, tag: &str) -> PathBuf {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let base = path.with_file_name(format!("{name}.{tag}-{secs}"));
    let mut p = base.clone();
    let mut n = 2;
    while p.exists() {
        p = PathBuf::from(format!("{}-{n}", base.display()));
        n += 1;
    }
    p
}

/// A backup made earlier by [`backup_path`] with this tag.
fn existing_backup(path: &Path, tag: &str) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let prefix = format!("{name}.{tag}-");
    std::fs::read_dir(path.parent()?)
        .ok()?
        .flatten()
        .find(|e| e.file_name().to_string_lossy().starts_with(&prefix))
        .map(|e| e.path())
}

/// The `version` member of an object, or `default` when it has none.
pub fn version_member(v: &Value, default: u32) -> u32 {
    v.get("version").and_then(Value::as_u64).map(|n| n.min(u32::MAX as u64) as u32).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Doc {
        version: u32,
        name: String,
    }

    fn version_of(v: &Value) -> u32 {
        version_member(v, 1)
    }

    /// v1 had `title`; v2 calls it `name`.
    fn migrate(v: &mut Value, from: u32) -> Result<(), String> {
        let o = v.as_object_mut().ok_or("not an object")?;
        match from {
            1 => {
                let t = o.remove("title").unwrap_or_default();
                o.insert("name".into(), t);
            }
            _ => return Err(format!("unknown version {from}")),
        }
        o.insert("version".into(), (from + 1).into());
        Ok(())
    }

    fn files(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> =
            std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    #[test]
    fn missing_file_is_quiet() {
        let d = tempfile::tempdir().unwrap();
        let l: Loaded<Doc> = load(&d.path().join("a.json"), 2, version_of, migrate, "テスト");
        assert!(l.value.is_none() && l.notice.is_none());
    }

    #[test]
    fn older_file_is_migrated() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.json");
        std::fs::write(&p, r#"{"title":"x"}"#).unwrap();
        let l: Loaded<Doc> = load(&p, 2, version_of, migrate, "テスト");
        assert_eq!(l.value.unwrap(), Doc { version: 2, name: "x".into() });
        assert!(l.notice.is_none());
        assert_eq!(files(d.path()), ["a.json"]);
    }

    #[test]
    fn broken_file_is_moved_aside() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.json");
        std::fs::write(&p, "{ not json").unwrap();
        let l: Loaded<Doc> = load(&p, 2, version_of, migrate, "テスト");
        assert!(l.value.is_none());
        assert!(l.notice.unwrap().contains("読めなかった"));
        let f = files(d.path());
        assert_eq!(f.len(), 1);
        assert!(f[0].starts_with("a.json.broken-"));
        assert_eq!(std::fs::read_to_string(d.path().join(&f[0])).unwrap(), "{ not json");
    }

    #[test]
    fn wrong_shape_is_moved_aside_too() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.json");
        std::fs::write(&p, r#"{"version":2,"name":5}"#).unwrap();
        let l: Loaded<Doc> = load(&p, 2, version_of, migrate, "テスト");
        assert!(l.value.is_none() && l.notice.is_some());
        assert!(!p.exists());
    }

    #[test]
    fn newer_file_is_read_and_copied_aside() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.json");
        std::fs::write(&p, r#"{"version":3,"name":"y","more":1}"#).unwrap();
        let l: Loaded<Doc> = load(&p, 2, version_of, migrate, "テスト");
        assert_eq!(l.value.unwrap(), Doc { version: 3, name: "y".into() });
        assert!(l.notice.unwrap().contains("v3"));
        let f = files(d.path());
        assert_eq!(f[0], "a.json");
        assert!(f[1].starts_with("a.json.v3-"));
        // The next start reuses that copy.
        let l: Loaded<Doc> = load(&p, 2, version_of, migrate, "テスト");
        assert!(l.notice.unwrap().contains(&f[1]));
        assert_eq!(files(d.path()).len(), 2);
    }
}
