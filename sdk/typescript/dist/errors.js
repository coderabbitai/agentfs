export function createFsError(params) {
    const { code, syscall, path, message } = params;
    const base = message ?? code;
    const suffix = path !== undefined
        ? ` '${path}'`
        : '';
    const err = new Error(`${code}: ${base}, ${syscall}${suffix}`);
    err.code = code;
    err.syscall = syscall;
    if (path !== undefined)
        err.path = path;
    return err;
}
