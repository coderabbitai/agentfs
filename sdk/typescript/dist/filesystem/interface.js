// File types for mode field
export const S_IFMT = 0o170000; // File type mask
export const S_IFREG = 0o100000; // Regular file
export const S_IFDIR = 0o040000; // Directory
export const S_IFLNK = 0o120000; // Symbolic link
// Default permissions
export const DEFAULT_FILE_MODE = S_IFREG | 0o644; // Regular file, rw-r--r--
export const DEFAULT_DIR_MODE = S_IFDIR | 0o755; // Directory, rwxr-xr-x
/**
 * Create a Stats object from raw data
 */
export function createStats(data) {
    return {
        ...data,
        isFile: () => (data.mode & S_IFMT) === S_IFREG,
        isDirectory: () => (data.mode & S_IFMT) === S_IFDIR,
        isSymbolicLink: () => (data.mode & S_IFMT) === S_IFLNK,
    };
}
