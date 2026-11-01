use std::ffi::OsString;
use std::path::PathBuf;

/// Select before opening SQLite. Explicit profiles never fall back on error.
pub fn database_directory(
    base: PathBuf,
    args: Vec<OsString>,
    debug_override: Option<OsString>,
    debug: bool,
) -> Result<PathBuf, String> {
    if args.is_empty() {
        return Ok(if debug {
            debug_override.map(PathBuf::from).unwrap_or(base)
        } else {
            base
        });
    }
    if args.len() != 2 || args[0] != "--profile" {
        return Err(
            "Use --profile NAME, or launch without arguments for your normal database.".into(),
        );
    }
    let name = args[1]
        .to_str()
        .filter(|name| {
            !name.is_empty()
                && name.len() <= 64
                && name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        })
        .ok_or("Profile names use 1–64 ASCII letters, numbers, hyphens or underscores.")?;
    Ok(base.join("profiles").join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn default_release_ignores_debug_override_and_profiles_are_explicit() {
        let base = PathBuf::from("normal");
        let override_dir = Some(OsString::from("debug-only"));
        assert_eq!(
            database_directory(base.clone(), vec![], override_dir.clone(), false).unwrap(),
            base
        );
        assert_eq!(
            database_directory(base.clone(), vec![], override_dir.clone(), true).unwrap(),
            PathBuf::from("debug-only")
        );
        for debug in [false, true] {
            assert_eq!(
                database_directory(
                    base.clone(),
                    args(&["--profile", "verify-123"]),
                    override_dir.clone(),
                    debug
                )
                .unwrap(),
                base.join("profiles/verify-123")
            );
        }
        assert_ne!(
            database_directory(base.clone(), args(&["--profile", "one"]), None, false).unwrap(),
            database_directory(base, args(&["--profile", "two"]), None, false).unwrap()
        );
    }

    #[test]
    fn malformed_profiles_never_select_normal_or_escape_the_profile_root() {
        for values in [
            vec!["--profile"],
            vec!["--profile", "../normal"],
            vec!["--profile", "."],
            vec!["--profile", ""],
            vec!["--profile", "C:\\other"],
            vec!["--profile", "a/b"],
            vec!["--profile", "a\\b"],
            vec!["--profile", "work space"],
            vec!["--profile", "世界"],
            vec!["--profile", "a", "--profile", "b"],
            vec!["--unknown"],
        ] {
            assert!(
                database_directory(PathBuf::from("normal"), args(&values), None, false).is_err(),
                "accepted {values:?}"
            );
        }
        assert!(
            database_directory(
                PathBuf::from("normal"),
                args(&["--profile", &"x".repeat(65)]),
                None,
                false
            )
            .is_err()
        );
    }
}
