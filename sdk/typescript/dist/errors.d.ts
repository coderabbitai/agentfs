/**
 * POSIX-style error codes for filesystem operations.
 */
export type FsErrorCode = 'ENOENT' | 'EEXIST' | 'EISDIR' | 'ENOTDIR' | 'ENOTEMPTY' | 'EPERM' | 'EINVAL' | 'ENOSYS';
/**
 * Filesystem syscall names for error reporting.
 * rm, scandir and copyFile are not actual syscall but used for convenience
 */
export type FsSyscall = 'open' | 'stat' | 'mkdir' | 'rmdir' | 'rm' | 'unlink' | 'rename' | 'scandir' | 'copyfile' | 'access';
export interface ErrnoException extends Error {
    code?: FsErrorCode;
    syscall?: FsSyscall;
    path?: string;
}
export declare function createFsError(params: {
    code: FsErrorCode;
    syscall: FsSyscall;
    path?: string;
    message?: string;
}): ErrnoException;
