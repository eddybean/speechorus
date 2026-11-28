//! System protection: before the engine starts, checks that the model will fit in the free memory
//! of the device it is loaded on, so that loading it over a GPU another program is using does not
//! push Windows into paging VRAM and freeze the PC (D-58).
//!
//! The check is deliberately not strict by default: a shortfall only asks the user, except at
//! `Strict`, and anything it cannot measure (an older speech.exe, an unknown device) lets the
//! engine start.

use serde::{Deserialize, Serialize};
use serde_json::Value;

const MIB: u64 = 1 << 20;
const GIB: u64 = 1 << 30;
/// Buffers beside the weights (codec, KV cache, compute): Drama-3 Q4_K's 20.8 GiB file takes
/// about 23.5 GiB of VRAM, and file × 1.1 + 512 MiB comes to 23.4 GiB.
const WORK_FIXED: u64 = 512 * MIB;
/// What `Strict` leaves free for the desktop and other programs on top of the estimate.
pub const STRICT_RESERVE: u64 = 3 * GIB / 2;

/// How hard the check guards the system.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum GuardLevel {
    /// No check.
    Off,
    /// Asks only when the model file itself is larger than the free memory.
    Low,
    /// Asks when the estimate (file and working buffers) is larger than the free memory.
    /// Also what an unknown value in settings.json reads as.
    #[default]
    Standard,
    /// Refuses to start unless the estimate plus `STRICT_RESERVE` is free.
    Strict,
}

impl<'de> Deserialize<'de> for GuardLevel {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        // An unknown value must not make the whole settings.json unreadable.
        Ok(match Value::deserialize(d)?.as_str() {
            Some("off") => GuardLevel::Off,
            Some("low") => GuardLevel::Low,
            Some("strict") => GuardLevel::Strict,
            _ => GuardLevel::Standard,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    Fits,
    /// Start only if the user confirms.
    Confirm,
    /// Do not start.
    Block,
}

/// One entry of `speech devices --json`.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceMemory {
    pub name: String,
    pub description: String,
    pub gpu: bool,
    pub free: u64,
    pub total: u64,
}

/// The device `speech worker --device NAME` loads on: `auto`/empty is the first GPU (the CPU
/// without one), `gpu` the first GPU, `cpu` the CPU, anything else a device name.
pub fn pick_device(devices: &Value, wanted: &str) -> Option<DeviceMemory> {
    let list: Vec<DeviceMemory> = devices
        .get("devices")?
        .as_array()?
        .iter()
        .filter_map(|d| {
            Some(DeviceMemory {
                name: d.get("name")?.as_str()?.to_string(),
                description: d.get("description").and_then(Value::as_str).unwrap_or("").trim().to_string(),
                gpu: d.get("kind").and_then(Value::as_str) == Some("gpu"),
                free: d.get("memory_free")?.as_u64()?,
                total: d.get("memory_total").and_then(Value::as_u64).unwrap_or(0),
            })
        })
        .collect();
    let w = wanted.trim().to_ascii_lowercase();
    let found = match w.as_str() {
        "" | "auto" => list.iter().find(|d| d.gpu).or_else(|| list.iter().find(|d| !d.gpu)),
        "gpu" => list.iter().find(|d| d.gpu),
        "cpu" => list.iter().find(|d| !d.gpu),
        _ => list.iter().find(|d| d.name.eq_ignore_ascii_case(&w)),
    };
    found.cloned()
}

/// Memory a model of `file_bytes` takes once loaded, weights and working buffers.
pub fn estimate(file_bytes: u64) -> u64 {
    file_bytes + file_bytes / 10 + WORK_FIXED
}

/// The result of a check, shown to the user when it does not fit.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCheck {
    pub level: GuardLevel,
    pub device: String,
    pub description: String,
    pub gpu: bool,
    /// Free now, plus what the running engine frees on this device when it stops.
    pub free: u64,
    /// Of `free`, what the running engine holds.
    pub reclaim: u64,
    pub total: u64,
    pub file_bytes: u64,
    /// What the level asks to be free.
    pub need: u64,
    pub verdict: Verdict,
}

/// Judges a model of `file_bytes` against `dev`, counting `reclaim` (held by the engine that
/// stops first) as free. `None` at `Off`.
pub fn check(level: GuardLevel, dev: &DeviceMemory, reclaim: u64, file_bytes: u64) -> Option<MemoryCheck> {
    let (need, short) = match level {
        GuardLevel::Off => return None,
        GuardLevel::Low => (file_bytes, Verdict::Confirm),
        GuardLevel::Standard => (estimate(file_bytes), Verdict::Confirm),
        GuardLevel::Strict => (estimate(file_bytes) + STRICT_RESERVE, Verdict::Block),
    };
    // Never more than the device has: a stale measurement must not inflate it.
    let free = (dev.free + reclaim).min(if dev.total > 0 { dev.total } else { u64::MAX });
    Some(MemoryCheck {
        level,
        device: dev.name.clone(),
        description: dev.description.clone(),
        gpu: dev.gpu,
        free,
        reclaim,
        total: dev.total,
        file_bytes,
        need,
        verdict: if free >= need { Verdict::Fits } else { short },
    })
}

/// Memory the running engine was measured (or estimated) to hold, to count it as free when
/// another start stops it first.
#[derive(Debug, Clone, PartialEq)]
pub struct Held {
    pub profile_id: String,
    pub device: String,
    pub bytes: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn devices() -> Value {
        json!({"devices": [
            {"name": "Vulkan0", "description": "NVIDIA GeForce RTX 5090", "kind": "gpu",
             "memory_total": 33_750_515_712u64, "memory_free": 32_945_209_344u64},
            {"name": "CPU", "description": "AMD Ryzen 7 9800X3D   ", "kind": "cpu",
             "memory_total": 68_293_152_768u64, "memory_free": 30_593_986_560u64},
        ]})
    }

    fn gpu(free_gib: f64) -> DeviceMemory {
        DeviceMemory {
            name: "Vulkan0".into(),
            description: String::new(),
            gpu: true,
            free: (free_gib * GIB as f64) as u64,
            total: 32 * GIB,
        }
    }

    const DRAMA_Q4K: u64 = 22_359_473_504;

    #[test]
    fn picks_the_device_the_worker_uses() {
        let d = devices();
        assert_eq!(pick_device(&d, "Vulkan0").unwrap().free, 32_945_209_344);
        assert_eq!(pick_device(&d, "vulkan0").unwrap().name, "Vulkan0");
        assert_eq!(pick_device(&d, "auto").unwrap().name, "Vulkan0");
        assert_eq!(pick_device(&d, "").unwrap().name, "Vulkan0");
        assert_eq!(pick_device(&d, "gpu").unwrap().name, "Vulkan0");
        let cpu = pick_device(&d, "CPU").unwrap();
        assert!(!cpu.gpu);
        assert_eq!(cpu.description, "AMD Ryzen 7 9800X3D");
        assert_eq!(pick_device(&d, "Vulkan1"), None);
        let cpu_only = json!({"devices": [{"name": "CPU", "kind": "cpu", "memory_free": 5, "memory_total": 9}]});
        assert_eq!(pick_device(&cpu_only, "auto").unwrap().name, "CPU");
        assert_eq!(pick_device(&cpu_only, "gpu"), None);
        assert_eq!(pick_device(&json!({"error": "x"}), "auto"), None);
    }

    #[test]
    fn the_estimate_matches_the_measured_drama_vram() {
        // Measured: about 23.5 GiB above idle (docs/engine-protocol.md).
        let est = estimate(DRAMA_Q4K) as f64 / GIB as f64;
        assert!((23.0..24.0).contains(&est), "{est}");
    }

    #[test]
    fn levels_get_stricter_in_order() {
        // Drama-3 Q4_K (20.8 GiB file, 23.4 GiB estimate) on a GPU with this much free:
        let v = |level, free| check(level, &gpu(free), 0, DRAMA_Q4K).map(|c| c.verdict);
        assert_eq!(v(GuardLevel::Off, 1.0), None);
        // Plenty free: nothing asks.
        for l in [GuardLevel::Low, GuardLevel::Standard, GuardLevel::Strict] {
            assert_eq!(v(l, 26.0), Some(Verdict::Fits));
        }
        // 24 GiB free: fits the estimate, but not with the strict reserve.
        assert_eq!(v(GuardLevel::Standard, 24.0), Some(Verdict::Fits));
        assert_eq!(v(GuardLevel::Strict, 24.0), Some(Verdict::Block));
        // 22 GiB free: the file fits, the estimate does not.
        assert_eq!(v(GuardLevel::Low, 22.0), Some(Verdict::Fits));
        assert_eq!(v(GuardLevel::Standard, 22.0), Some(Verdict::Confirm));
        // 12 GiB free: even the file does not fit.
        assert_eq!(v(GuardLevel::Low, 12.0), Some(Verdict::Confirm));
    }

    #[test]
    fn the_running_engine_counts_as_free_up_to_the_total() {
        let c = check(GuardLevel::Standard, &gpu(6.0), 24 * GIB, DRAMA_Q4K).unwrap();
        assert_eq!(c.verdict, Verdict::Fits);
        assert_eq!(c.free, 30 * GIB);
        let c = check(GuardLevel::Standard, &gpu(20.0), 24 * GIB, DRAMA_Q4K).unwrap();
        assert_eq!(c.free, 32 * GIB);
    }

    #[test]
    fn levels_serialize_as_the_settings_store_them() {
        assert_eq!(serde_json::to_value(GuardLevel::Standard).unwrap(), json!("standard"));
        assert_eq!(serde_json::from_value::<GuardLevel>(json!("strict")).unwrap(), GuardLevel::Strict);
        assert_eq!(serde_json::from_value::<GuardLevel>(json!("paranoid")).unwrap(), GuardLevel::Standard);
        assert_eq!(GuardLevel::default(), GuardLevel::Standard);
    }
}
