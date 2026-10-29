//! Keep provider descendants scoped to the desktop process, including hard exits.
#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::*;

pub struct ProcessScope {
    #[cfg(windows)]
    handle: OwnedHandle,
}
impl ProcessScope {
    pub fn new() -> Result<Self, String> {
        #[cfg(windows)]
        {
            // The unnamed job is private to this process. OwnedHandle closes it
            // exactly once; KILL_ON_JOB_CLOSE also covers abrupt parent exit.
            let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if raw.is_null() {
                return Err("Unable to create the provider process scope.".into());
            }
            let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    raw,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of_val(&limits) as u32,
                )
            };
            if configured == 0 {
                return Err("Unable to configure provider process cleanup.".into());
            }
            Ok(Self { handle })
        }
        #[cfg(not(windows))]
        {
            Ok(Self {})
        }
    }
    pub fn assign(&self, child: &tokio::process::Child) -> Result<(), String> {
        #[cfg(windows)]
        {
            let process = child
                .raw_handle()
                .ok_or("The provider process is unavailable.")?;
            // Both handles are live and owned by this scope / Child.
            if unsafe { AssignProcessToJobObject(self.handle.as_raw_handle(), process) } == 0 {
                return Err(
                    "Unable to contain the provider process. Codex was not started.".into(),
                );
            }
        }
        #[cfg(not(windows))]
        let _ = child;
        Ok(())
    }
    pub fn terminate(&self) {
        #[cfg(windows)]
        {
            let _ = unsafe { TerminateJobObject(self.handle.as_raw_handle(), 0) };
        }
    }
}
