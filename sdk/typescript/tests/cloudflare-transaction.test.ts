import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AgentFS,
  type CloudflareAgentFSTransaction,
} from '../src/integrations/cloudflare/index.js';
import { cloudflareStorage } from './cloudflare-test-storage.js';

describe('Cloudflare caller-owned transactions', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  function createFixture() {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const storage = cloudflareStorage(database);
    const filesystem = AgentFS.create(storage);
    database.exec('CREATE TABLE app_metadata(path TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
    return { database, filesystem, storage };
  }

  it('atomically commits filesystem and application tables', async () => {
    const { database, filesystem, storage } = createFixture();

    filesystem.transactionSync(transaction => {
      transaction.writeFile('/knowledge/fact.md', 'fact');
      expect(transaction.stat('/knowledge/fact.md')).toMatchObject({ size: 4 });
      expect(transaction.readFile('/knowledge/fact.md').toString('utf8')).toBe('fact');
      storage.sql.exec(
        'INSERT INTO app_metadata(path, revision) VALUES (?, ?)',
        '/knowledge/fact.md',
        1,
      );
    });

    expect(await filesystem.readFile('/knowledge/fact.md', 'utf8')).toBe('fact');
    expect(database.prepare('SELECT revision FROM app_metadata').get()).toEqual({ revision: 1 });
  });

  it('rolls back filesystem and application tables on a later failure', async () => {
    const { database, filesystem, storage } = createFixture();

    expect(() => filesystem.transactionSync(transaction => {
      transaction.writeFile('/knowledge/fact.md', 'uncommitted');
      storage.sql.exec(
        'INSERT INTO app_metadata(path, revision) VALUES (?, ?)',
        '/knowledge/fact.md',
        1,
      );
      throw new Error('injected application failure');
    })).toThrow('injected application failure');

    await expect(filesystem.readFile('/knowledge/fact.md')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM app_metadata').get()).toEqual({ count: 0 });
  });

  it('invalidates escaped transaction surfaces after commit and rollback', () => {
    const { filesystem } = createFixture();
    let committed!: CloudflareAgentFSTransaction;
    filesystem.transactionSync(transaction => {
      committed = transaction;
      transaction.kv.set('inside', true);
    });

    expect(() => committed.writeFile('/escaped', 'no')).toThrow('transaction is already closed');
    expect(() => committed.kv.set('escaped', true)).toThrow('transaction is already closed');
    expect(() => committed.tools.record({
      name: 'escaped',
      outcome: { kind: 'success', result: null },
      startedAt: 1,
      completedAt: 1,
    })).toThrow('transaction is already closed');
    expect(() => committed.overlay.createWhiteout('/escaped', 1))
      .toThrow('transaction is already closed');

    let rolledBack!: CloudflareAgentFSTransaction;
    expect(() => filesystem.transactionSync(transaction => {
      rolledBack = transaction;
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(() => rolledBack.readFile('/anything')).toThrow('transaction is already closed');
  });

  it('zero-extends truncate growth through both mutation APIs', async () => {
    const { filesystem } = createFixture();
    await filesystem.writeFile('/file.bin', Buffer.from('abc'));

    const handle = await filesystem.open('/file.bin');
    await handle.truncate(8193);
    expect(await filesystem.readFile('/file.bin')).toEqual(
      Buffer.concat([Buffer.from('abc'), Buffer.alloc(8190)]),
    );

    filesystem.transactionSync(transaction => transaction.truncate('/file.bin', 12289));
    expect((await filesystem.readFile('/file.bin')).byteLength).toBe(12289);
  });

  it('zero-fills sparse writes without allocating the complete gap at once', async () => {
    const { filesystem } = createFixture();
    await filesystem.writeFile('/sparse.bin', Buffer.from('abc'));
    const handle = await filesystem.open('/sparse.bin');

    await handle.pwrite(20_000, Buffer.from('tail'));

    const content = await filesystem.readFile('/sparse.bin');
    expect(content.byteLength).toBe(20_004);
    expect(content.subarray(0, 3).toString()).toBe('abc');
    expect(content.subarray(3, 20_000)).toEqual(Buffer.alloc(19_997));
    expect(content.subarray(20_000).toString()).toBe('tail');
  });

  it('rejects excessive zero-fill work atomically', async () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const filesystem = AgentFS.create(cloudflareStorage(database), {
      maxZeroFillBytes: 8,
    });
    await filesystem.writeFile('/bounded.bin', Buffer.from('abc'));
    const handle = await filesystem.open('/bounded.bin');

    await expect(handle.pwrite(12, Buffer.from('tail'))).rejects.toThrow(
      'zero-fill gap of 9 bytes exceeds the 8 byte limit',
    );
    expect(await filesystem.readFile('/bounded.bin')).toEqual(Buffer.from('abc'));

    await expect(handle.truncate(12)).rejects.toThrow(
      'zero-fill gap of 9 bytes exceeds the 8 byte limit',
    );
    expect(await filesystem.readFile('/bounded.bin')).toEqual(Buffer.from('abc'));
  });

  it('rejects an unknown persisted schema instead of relabeling it', () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    database.exec(`
      CREATE TABLE fs_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO fs_config(key, value) VALUES ('schema_version', 'future');
    `);

    expect(() => AgentFS.create(cloudflareStorage(database))).toThrow(
      'unsupported AgentFS schema future; expected 0.4'
    );
    expect(database.prepare(
      "SELECT value FROM fs_config WHERE key = 'schema_version'"
    ).get()).toEqual({ value: 'future' });
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name IN ('kv_store', 'tool_calls', 'fs_whiteout', 'fs_origin')`
    ).get()).toEqual({ count: 0 });
  });

  it('supports rename and removal without nested transactions', async () => {
    const { filesystem } = createFixture();

    filesystem.transactionSync(transaction => {
      transaction.writeFile('/tree/source.md', 'source');
      transaction.writeFile('/tree/remove.md', 'remove');
      transaction.rename('/tree/source.md', '/tree/renamed.md');
      transaction.unlink('/tree/remove.md');
    });

    expect(await filesystem.readFile('/tree/renamed.md', 'utf8')).toBe('source');
    await expect(filesystem.readFile('/tree/remove.md')).rejects.toMatchObject({ code: 'ENOENT' });

    filesystem.transactionSync(transaction => transaction.rm('/tree', { recursive: true }));
    await expect(filesystem.stat('/tree')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
