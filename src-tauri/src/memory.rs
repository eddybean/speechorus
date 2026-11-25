//! The process's working set, for the GUI memory check (Windows only; 0 elsewhere).

#[cfg(windows)]
pub fn working_set() -> u64 {
    #[repr(C)]
    #[derive(Default)]
    struct Pmc {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn K32GetProcessMemoryInfo(process: isize, pmc: *mut Pmc, cb: u32) -> i32;
    }
    let mut p = Pmc {
        cb: std::mem::size_of::<Pmc>() as u32,
        ..Default::default()
    };
    // SAFETY: the pseudo handle needs no closing, and `p` is a correctly sized PROCESS_MEMORY_COUNTERS.
    let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut p, p.cb) };
    if ok != 0 {
        p.working_set_size as u64
    } else {
        0
    }
}

#[cfg(not(windows))]
pub fn working_set() -> u64 {
    0
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(windows)]
    fn reads_a_plausible_working_set() {
        let ws = super::working_set();
        assert!(ws > 1 << 20 && ws < 1 << 34, "{ws}");
    }
}
