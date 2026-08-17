import type { DatabasePromise } from '@tursodatabase/database-common';
import { type FsSyscall } from './errors.js';
export declare function getInodeModeOrThrow(db: DatabasePromise, ino: number, syscall: FsSyscall, path: string): Promise<number>;
export declare function assertNotRoot(path: string, syscall: FsSyscall): void;
export declare function normalizeRmOptions(options?: {
    force?: boolean;
    recursive?: boolean;
}): {
    force: boolean;
    recursive: boolean;
};
export declare function throwENOENTUnlessForce(path: string, syscall: FsSyscall, force: boolean): void;
export declare function assertNotSymlinkMode(mode: number, syscall: FsSyscall, path: string): void;
export declare function assertInodeIsDirectory(db: DatabasePromise, ino: number, syscall: FsSyscall, fullPathForError: string): Promise<void>;
export declare function assertWritableExistingInode(db: DatabasePromise, ino: number, syscall: FsSyscall, fullPathForError: string): Promise<void>;
export declare function assertReadableExistingInode(db: DatabasePromise, ino: number, syscall: FsSyscall, fullPathForError: string): Promise<void>;
export declare function assertReaddirTargetInode(db: DatabasePromise, ino: number, fullPathForError: string): Promise<void>;
export declare function assertUnlinkTargetInode(db: DatabasePromise, ino: number, fullPathForError: string): Promise<void>;
