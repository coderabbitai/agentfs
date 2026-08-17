import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AgentFS,
  type CloudflareStorage,
} from '../src/integrations/cloudflare/index.js';

function cursor<T>(rows: T[]) {
  return {
    toArray: () => rows,
    one: () => {
      if (rows.length !== 1) throw new Error(`expected one row, received ${rows.length}`);
      return rows[0];
    },
  } as ReturnType<CloudflareStorage['sql']['exec']>;
}

function cloudflareStorage(database: DatabaseSync): CloudflareStorage {
  return {
    sql: {
      exec<T>(query: string, ...bindings: unknown[]) {
        if (bindings.length === 0 && query.includes(';')) {
          database.exec(query);
          return cursor<T>([]);
        }
        return cursor(database.prepare(query).all(...bindings as SQLInputValue[]) as T[]);
      },
      get databaseSize() {
        return 0;
      },
    },
    transactionSync<T>(callback: () => T): T {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = callback();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

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
