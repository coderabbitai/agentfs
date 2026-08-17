import { createFsError } from './errors.js';
import { S_IFDIR, S_IFLNK, S_IFMT } from './filesystem/interface.js';
async function getInodeMode(db, ino) {
    const stmt = db.prepare('SELECT mode FROM fs_inode WHERE ino = ?');
    const row = await stmt.get(ino);
    return row?.mode ?? null;
}
function isDirMode(mode) {
    return (mode & S_IFMT) === S_IFDIR;
}
export async function getInodeModeOrThrow(db, ino, syscall, path) {
    const mode = await getInodeMode(db, ino);
    if (mode === null) {
        throw createFsError({
            code: 'ENOENT',
            syscall,
            path,
            message: 'no such file or directory',
        });
    }
    return mode;
}
export function assertNotRoot(path, syscall) {
    if (path === '/') {
        throw createFsError({
            code: 'EPERM',
            syscall,
            path,
            message: 'operation not permitted on root directory',
        });
    }
}
export function normalizeRmOptions(options) {
    return {
        force: options?.force === true,
        recursive: options?.recursive === true,
    };
}
export function throwENOENTUnlessForce(path, syscall, force) {
    if (force)
        return;
    throw createFsError({
        code: 'ENOENT',
        syscall,
        path,
        message: 'no such file or directory',
    });
}
export function assertNotSymlinkMode(mode, syscall, path) {
    if ((mode & S_IFMT) === S_IFLNK) {
        throw createFsError({
            code: 'ENOSYS',
            syscall,
            path,
            message: 'symbolic links not supported yet',
        });
    }
}
async function assertExistingNonDirNonSymlinkInode(db, ino, syscall, fullPathForError) {
    const mode = await getInodeMode(db, ino);
    if (mode === null) {
        throw createFsError({
            code: 'ENOENT',
            syscall,
            path: fullPathForError,
            message: 'no such file or directory',
        });
    }
    if (isDirMode(mode)) {
        throw createFsError({
            code: 'EISDIR',
            syscall,
            path: fullPathForError,
            message: 'illegal operation on a directory',
        });
    }
    assertNotSymlinkMode(mode, syscall, fullPathForError);
}
export async function assertInodeIsDirectory(db, ino, syscall, fullPathForError) {
    const mode = await getInodeMode(db, ino);
    if (mode === null) {
        throw createFsError({
            code: 'ENOENT',
            syscall,
            path: fullPathForError,
            message: 'no such file or directory',
        });
    }
    if (!isDirMode(mode)) {
        throw createFsError({
            code: 'ENOTDIR',
            syscall,
            path: fullPathForError,
            message: 'not a directory',
        });
    }
}
export async function assertWritableExistingInode(db, ino, syscall, fullPathForError) {
    await assertExistingNonDirNonSymlinkInode(db, ino, syscall, fullPathForError);
}
export async function assertReadableExistingInode(db, ino, syscall, fullPathForError) {
    await assertExistingNonDirNonSymlinkInode(db, ino, syscall, fullPathForError);
}
export async function assertReaddirTargetInode(db, ino, fullPathForError) {
    const syscall = 'scandir';
    const mode = await getInodeMode(db, ino);
    if (mode === null) {
        throw createFsError({
            code: 'ENOENT',
            syscall,
            path: fullPathForError,
            message: 'no such file or directory',
        });
    }
    assertNotSymlinkMode(mode, syscall, fullPathForError);
    if (!isDirMode(mode)) {
        throw createFsError({
            code: 'ENOTDIR',
            syscall,
            path: fullPathForError,
            message: 'not a directory',
        });
    }
}
export async function assertUnlinkTargetInode(db, ino, fullPathForError) {
    const syscall = 'unlink';
    const mode = await getInodeMode(db, ino);
    if (mode === null) {
        throw createFsError({
            code: 'ENOENT',
            syscall,
            path: fullPathForError,
            message: 'no such file or directory',
        });
    }
    if (isDirMode(mode)) {
        throw createFsError({
            code: 'EISDIR',
            syscall,
            path: fullPathForError,
            message: 'illegal operation on a directory',
        });
    }
    assertNotSymlinkMode(mode, syscall, fullPathForError);
}
