//! Installs the official speech.cpp Windows Vulkan release: download the zip, check it against the
//! release's SHA256SUMS, extract it under the app's data folder. (deviations.md D-10, option c)

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const REPO: &str = "nyosegawa/speech.cpp";
const ASSET_SUFFIX: &str = "windows-x64-vulkan.zip";
const UA: &str = "speechorus-installer";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub version: String,
    pub exe: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseAssets {
    pub tag: String,
    pub zip_name: String,
    pub zip_url: String,
    pub sums_url: String,
}

/// Picks the Windows Vulkan zip and SHA256SUMS out of a GitHub release object.
pub fn pick_assets(release: &Value) -> Result<ReleaseAssets, String> {
    let tag = release.get("tag_name").and_then(Value::as_str).ok_or("release has no tag_name")?.to_string();
    let assets = release.get("assets").and_then(Value::as_array).ok_or("release has no assets")?;
    let find = |pred: &dyn Fn(&str) -> bool| {
        assets.iter().find_map(|a| {
            let name = a.get("name")?.as_str()?;
            let url = a.get("browser_download_url")?.as_str()?;
            pred(name).then(|| (name.to_string(), url.to_string()))
        })
    };
    let (zip_name, zip_url) = find(&|n| n.ends_with(ASSET_SUFFIX)).ok_or("release has no Windows Vulkan zip")?;
    let (_, sums_url) = find(&|n| n == "SHA256SUMS").ok_or("release has no SHA256SUMS")?;
    Ok(ReleaseAssets { tag, zip_name, zip_url, sums_url })
}

/// The hash SHA256SUMS lists for `name` (`<hex>  <name>` or `<hex> *<name>`).
pub fn parse_sums(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|l| {
        let mut it = l.split_whitespace();
        let hash = it.next()?;
        let file = it.next()?.trim_start_matches('*');
        (file == name && hash.len() == 64).then(|| hash.to_ascii_lowercase())
    })
}

/// Extracts `zip` into `dest`, refusing entries that would land outside it; returns the path of speech.exe.
pub fn extract(zip: &Path, dest: &Path) -> Result<PathBuf, String> {
    let f = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    let mut ar = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut exe = None;
    for i in 0..ar.len() {
        let mut entry = ar.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else { return Err(format!("unsafe path in zip: {}", entry.name())) };
        let out = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut w).map_err(|e| e.to_string())?;
        if out.file_name().map(|n| n.eq_ignore_ascii_case("speech.exe")).unwrap_or(false) {
            exe = Some(out);
        }
    }
    exe.ok_or_else(|| "the zip holds no speech.exe".into())
}

fn get(url: &str) -> Result<ureq::Response, String> {
    ureq::get(url).set("User-Agent", UA).call().map_err(|e| format!("{url}: {e}"))
}

/// Downloads, verifies and extracts the latest release into `root/<tag>/`.
pub fn install_latest(root: &Path, log: &dyn Fn(String)) -> Result<Installed, String> {
    log(format!("fetching the latest release of {REPO}"));
    let body = get(&format!("https://api.github.com/repos/{REPO}/releases/latest"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    let release: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let a = pick_assets(&release)?;
    let sums = get(&a.sums_url)?.into_string().map_err(|e| e.to_string())?;
    let expected = parse_sums(&sums, &a.zip_name).ok_or_else(|| format!("SHA256SUMS does not list {}", a.zip_name))?;
    let dl = root.join("dl");
    std::fs::create_dir_all(&dl).map_err(|e| e.to_string())?;
    let zip_path = dl.join(&a.zip_name);
    log(format!("downloading {} ({})", a.zip_name, a.tag));
    let resp = get(&a.zip_url)?;
    let total: u64 = resp.header("Content-Length").and_then(|s| s.parse().ok()).unwrap_or(0);
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    let (mut got, mut next_report) = (0u64, 10u64);
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        if total > 0 && got * 100 / total >= next_report {
            log(format!("  {} MB of {} MB", got >> 20, total >> 20));
            next_report += 10;
        }
    }
    drop(file);
    let actual = hex::encode(hasher.finalize());
    if actual != expected {
        let _ = std::fs::remove_file(&zip_path);
        return Err(format!("SHA-256 mismatch for {}: expected {expected}, got {actual}", a.zip_name));
    }
    log(format!("SHA-256 checked ({actual})"));
    let dest = root.join(&a.tag);
    let exe = extract(&zip_path, &dest)?;
    let _ = std::fs::remove_file(&zip_path);
    log(format!("installed {}", exe.display()));
    Ok(Installed { version: a.tag, exe: exe.to_string_lossy().into_owned() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn picks_assets_and_sums() {
        let r = json!({"tag_name":"v0.11.2","assets":[
            {"name":"SHA256SUMS","browser_download_url":"https://x/SHA256SUMS"},
            {"name":"speech-0.11.2-linux-x64-cpu.zip","browser_download_url":"https://x/l.zip"},
            {"name":"speech-0.11.2-windows-x64-vulkan.zip","browser_download_url":"https://x/w.zip"}]});
        let a = pick_assets(&r).unwrap();
        assert_eq!(a.zip_name, "speech-0.11.2-windows-x64-vulkan.zip");
        assert_eq!(a.zip_url, "https://x/w.zip");
        assert_eq!(a.sums_url, "https://x/SHA256SUMS");
        assert!(pick_assets(&json!({"tag_name":"v1","assets":[]})).is_err());
        let h = "2cf46f0351a2a90b9ce0bfb83cf63ac209ca31c88df9a5bc0126898a20a58586";
        let sums =
            format!("{}  speech-0.11.2-linux-x64-cpu.zip\n{h} *speech-0.11.2-windows-x64-vulkan.zip\n", "0".repeat(64));
        assert_eq!(parse_sums(&sums, &a.zip_name).as_deref(), Some(h));
        assert_eq!(parse_sums(&sums, "nope.zip"), None);
    }

    #[test]
    fn extracts_and_refuses_zip_slip() {
        let d = tempfile::tempdir().unwrap();
        let good = d.path().join("good.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&good).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            w.start_file("speech.exe", o).unwrap();
            w.write_all(b"MZ").unwrap();
            w.start_file("speech.dll", o).unwrap();
            w.write_all(b"MZ").unwrap();
            w.finish().unwrap();
        }
        let exe = extract(&good, &d.path().join("out")).unwrap();
        assert_eq!(exe, d.path().join("out").join("speech.exe"));
        assert!(d.path().join("out").join("speech.dll").exists());

        let bad = d.path().join("bad.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&bad).unwrap());
            w.start_file("../evil.exe", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"x").unwrap();
            w.finish().unwrap();
        }
        assert!(extract(&bad, &d.path().join("out2")).unwrap_err().contains("unsafe"));
        assert!(!d.path().join("evil.exe").exists());
    }
}
