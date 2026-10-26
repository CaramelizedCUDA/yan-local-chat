// Keep command fixtures executable by the shell selected by the host platform.
export const shellCommand = (powershell, posix) => (process.platform === "win32" ? powershell : posix);
