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

pub const START_PROVIDER: &[u8; 8] = b"PAVANEGO";

/// Private launcher mode: a provider cannot start until the parent has attached
/// this waiting host to its job and explicitly released the startup gate. EOF
/// before the gate (including parent death) exits without starting a provider.
#[cfg(windows)]
pub fn run_host() -> Option<i32> {
    use std::io::Read;
    use std::os::windows::io::BorrowedHandle;
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Console::{GetStdHandle, STD_INPUT_HANDLE};
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--pavane-codex-host")) {
        return None;
    }
    let Some(executable) = args.next() else {
        return Some(78);
    };
    // Read the pipe without Stdin's read-ahead buffer: initialize JSON may
    // already follow the gate and must remain available to the provider.
    let raw = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    if raw.is_null() || raw == INVALID_HANDLE_VALUE {
        return Some(0);
    }
    // Borrow only while duplicating; the parent-provided standard handle stays
    // owned by the runtime. The duplicate becomes the provider's stdin.
    let Ok(input) = (unsafe { BorrowedHandle::borrow_raw(raw) }).try_clone_to_owned() else {
        return Some(1);
    };
    let mut input = std::fs::File::from(input);
    let mut gate = [0u8; 8];
    if input.read_exact(&mut gate).is_err() || &gate != START_PROVIDER {
        return Some(0);
    }
    let mut command = std::process::Command::new(executable);
    command
        .args(args)
        .stdin(std::process::Stdio::from(input))
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let status = command.status();
    Some(status.ok().and_then(|status| status.code()).unwrap_or(1))
}

#[cfg(not(windows))]
pub fn run_host() -> Option<i32> {
    None
}

#[cfg(windows)]
pub fn host_executable() -> Result<std::path::PathBuf, String> {
    let current =
        std::env::current_exe().map_err(|_| "The Pavane provider host is unavailable.")?;
    if current.file_stem() == Some(std::ffi::OsStr::new("pavane")) {
        return Ok(current);
    }
    // Ignored live tests run from target/debug/deps after a native build.
    let host = current
        .parent()
        .and_then(std::path::Path::parent)
        .map(|path| path.join("pavane.exe"))
        .filter(|path| path.is_file());
    host.ok_or("Build the desktop executable before running a live Codex test.".into())
}
