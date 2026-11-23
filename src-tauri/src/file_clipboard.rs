//! Files and the system clipboard, like Copy and Paste in Finder or the file
//! manager. Copied, a project's file pastes in a folder (copied there), a
//! chat or an email (attached). Pasted, files copied anywhere land in a
//! project's folder; a name already there gets " (2)", nothing is replaced.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Kept for desk's lifetime: on Linux the owner serves what was copied, so
/// dropping it would empty the clipboard (or hand it to a clipboard manager).
static CLIPBOARD: Mutex<Option<arboard::Clipboard>> = Mutex::new(None);

fn with_clipboard<T>(f: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>) -> Result<T, arboard::Error> {
    let mut slot = CLIPBOARD.lock().unwrap_or_else(|e| e.into_inner());
    if slot.is_none() {
        *slot = Some(arboard::Clipboard::new()?);
    }
    f(slot.as_mut().expect("set above"))
}

/// `rel` of the project at `root`; anything outside the project is refused.
pub fn copy(root: &Path, rel: &str) -> Result<(), String> {
    let full = crate::project::inside(root, rel)?;
    with_clipboard(|c| c.set().file_list(&[full])).map_err(|e| e.to_string())
}

/// The files in the clipboard into `dir` ("" = the project itself); returns
/// where they went, relative to the project, "/"-separated.
pub fn paste(root: &Path, dir: &str) -> Result<Vec<String>, String> {
    let dir = dir.trim_end_matches('/');
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    let target = base.join(dir).canonicalize().map_err(|e| format!("{dir}: {e}"))?;
    if !target.starts_with(&base) || !target.is_dir() {
        return Err(tr!(
            format!("{dir} nie jest folderem tego projektu"),
            format!("{dir} is not a folder of this project")
        ));
    }
    let none = || tr!("W schowku nie ma plików".to_string(), "There are no files in the clipboard".to_string());
    let sources = match with_clipboard(|c| c.get().file_list()) {
        Ok(list) if !list.is_empty() => list,
        Ok(_) | Err(arboard::Error::ContentNotAvailable) => return Err(none()),
        Err(e) => return Err(e.to_string()),
    };
    let mut pasted = Vec::new();
    for src in sources {
        let src = src.canonicalize().map_err(|e| format!("{}: {e}", src.display()))?;
        if src.is_dir() && target.starts_with(&src) {
            return Err(tr!(
                format!("Nie da się wkleić folderu {} do niego samego", src.display()),
                format!("Cannot paste the folder {} into itself", src.display())
            ));
        }
        let Some(name) = src.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue; // the root of a disk
        };
        let to = target.join(free_name(&name, |n| target.join(n).symlink_metadata().is_ok()));
        copy_any(&src, &to).map_err(|e| format!("{name}: {e}"))?;
        pasted.push(relative(&base, &to));
    }
    Ok(pasted)
}

/// `name`, or "name (2).ext", "name (3).ext"... when `taken`.
fn free_name(name: &str, taken: impl Fn(&str) -> bool) -> String {
    if !taken(name) {
        return name.to_string();
    }
    // A dotfile (".env") has no extension; "a.tar.gz" numbers before ".gz".
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => name.split_at(i),
        _ => (name, ""),
    };
    (2..)
        .map(|n| format!("{stem} ({n}){ext}"))
        .find(|candidate| !taken(candidate))
        .expect("an unbounded range finds a free name")
}

/// A file, or a folder with everything in it. A link inside a folder stays a
/// link (where the system allows), so a link to a parent cannot loop.
fn copy_any(src: &Path, to: &Path) -> std::io::Result<()> {
    if !src.is_dir() {
        return std::fs::copy(src, to).map(|_| ());
    }
    std::fs::create_dir(to)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_symlink() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(std::fs::read_link(&from)?, &dest)?;
        } else {
            copy_any(&from, &dest)?;
        }
    }
    Ok(())
}

fn relative(base: &Path, full: &Path) -> String {
    let rel: PathBuf = full.strip_prefix(base).unwrap_or(full).to_path_buf();
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_a_name_already_taken() {
        let taken = |names: &'static [&'static str]| move |n: &str| names.contains(&n);
        assert_eq!(free_name("a.txt", taken(&[])), "a.txt");
        assert_eq!(free_name("a.txt", taken(&["a.txt"])), "a (2).txt");
        assert_eq!(free_name("a.txt", taken(&["a.txt", "a (2).txt"])), "a (3).txt");
        assert_eq!(free_name(".env", taken(&[".env"])), ".env (2)");
        assert_eq!(free_name("src", taken(&["src"])), "src (2)");
        assert_eq!(free_name("a.tar.gz", taken(&["a.tar.gz"])), "a.tar (2).gz");
    }

    #[test]
    fn copies_a_folder_with_its_contents() {
        let tmp = std::env::temp_dir().join(format!("desk-paste-{}", std::process::id()));
        let src = tmp.join("src");
        std::fs::create_dir_all(src.join("inner")).unwrap();
        std::fs::write(src.join("a.txt"), "a").unwrap();
        std::fs::write(src.join("inner/b.txt"), "b").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("..", src.join("inner/up")).unwrap();
        let to = tmp.join("copy");
        copy_any(&src, &to).unwrap();
        assert_eq!(std::fs::read_to_string(to.join("a.txt")).unwrap(), "a");
        assert_eq!(std::fs::read_to_string(to.join("inner/b.txt")).unwrap(), "b");
        #[cfg(unix)]
        assert_eq!(std::fs::read_link(to.join("inner/up")).unwrap(), Path::new(".."));
        assert_eq!(relative(&tmp, &to.join("inner/b.txt")), "copy/inner/b.txt");
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
