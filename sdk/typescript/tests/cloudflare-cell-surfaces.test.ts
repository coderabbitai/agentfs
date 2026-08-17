import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentFS } from '../src/integrations/cloudflare/index.js';
import { cloudflareStorage } from './cloudflare-test-storage.js';

describe('Cloudflare single-cell AgentFS surfaces', () => {
  const databases: DatabaseSync[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  function createFixture() {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const storage = cloudflareStorage(database);
    return { agent: AgentFS.create(storage), database };
  }

  it('initializes filesystem, KV, tool-call, whiteout, and origin tables in one database', () => {
    const { database } = createFixture();
    const tables = database.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'fs_inode', 'kv_store', 'tool_calls', 'fs_whiteout', 'fs_origin'
       ) ORDER BY name`,
    ).all().map(row => row.name);

    expect(tables).toEqual([
      'fs_inode',
      'fs_origin',
      'fs_whiteout',
      'kv_store',
      'tool_calls',
    ]);
  });

  it('commits all cell surfaces in one caller-owned transaction', async () => {
    const { agent } = createFixture();

    agent.transactionSync(transaction => {
      transaction.writeFile('/session/answer.md', 'answer');
      transaction.kv.set('session:state', { phase: 'complete' });
      transaction.tools.record({
        name: 'write_file',
        parameters: { path: '/session/answer.md' },
        outcome: { kind: 'success', result: { bytes: 6 } },
        startedAt: 10,
        completedAt: 12,
      });
      transaction.overlay.createWhiteout('/base/removed.md', 13);
      transaction.overlay.setOrigin(7, 101);
    });

    expect(await agent.readFile('/session/answer.md', 'utf8')).toBe('answer');
    expect(agent.kv.get('session:state')).toEqual({ phase: 'complete' });
    expect(agent.tools.getRecent(0)).toEqual([
      expect.objectContaining({
        name: 'write_file',
        outcome: { kind: 'success', result: { bytes: 6 } },
        durationMs: 2_000,
      }),
    ]);
    expect(agent.overlay.isWhiteout('/base/removed.md/child')).toBe(true);
    expect(agent.overlay.getOrigin(7)).toBe(101);
  });

  it('rolls every surface back when a later cell mutation fails', async () => {
    const { agent } = createFixture();

    expect(() => agent.transactionSync(transaction => {
      transaction.writeFile('/uncommitted.md', 'no');
      transaction.kv.set('uncommitted', true);
      transaction.tools.record({
        name: 'uncommitted',
        outcome: { kind: 'error', error: 'failure' },
        startedAt: 20,
        completedAt: 21,
      });
      transaction.overlay.createWhiteout('/uncommitted-base.md', 22);
      transaction.overlay.setOrigin(8, 102);
      throw new Error('injected cell failure');
    })).toThrow('injected cell failure');

    await expect(agent.readFile('/uncommitted.md')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(agent.kv.get('uncommitted')).toBeUndefined();
    expect(agent.tools.getRecent(0)).toEqual([]);
    expect(agent.overlay.isWhiteout('/uncommitted-base.md')).toBe(false);
    expect(agent.overlay.getOrigin(8)).toBeUndefined();
  });

  it('lists KV prefixes literally and rejects values JSON cannot persist', () => {
    const { agent } = createFixture();
    agent.kv.set('scope:100%:one', { value: 1 });
    agent.kv.set('scope:100x:two', { value: 2 });
    agent.kv.set('scope:100%:_three', { value: 3 });

    expect(agent.kv.list('scope:100%:')).toEqual([
      { key: 'scope:100%:_three', value: { value: 3 } },
      { key: 'scope:100%:one', value: { value: 1 } },
    ]);
    expect(() => agent.kv.set('undefined', undefined)).toThrow('JSON-serializable');
  });

  it('records completed tool calls as an immutable, validated audit log', () => {
    const { agent, database } = createFixture();
    const successId = agent.tools.record({
      name: 'search',
      parameters: { query: 'sqlite' },
      outcome: { kind: 'success', result: ['one'] },
      startedAt: 100,
      completedAt: 103,
    });
    const errorId = agent.tools.record({
      name: 'search',
      outcome: { kind: 'error', error: 'timeout' },
      startedAt: 104,
      completedAt: 105,
    });

    expect(agent.tools.get(successId)).toEqual(expect.objectContaining({
      id: successId,
      outcome: { kind: 'success', result: ['one'] },
      durationMs: 3_000,
    }));
    expect(agent.tools.getByName('search', 1)).toEqual([
      expect.objectContaining({ id: errorId, outcome: { kind: 'error', error: 'timeout' } }),
    ]);
    expect(agent.tools.getStats()).toEqual([
      { name: 'search', totalCalls: 2, successful: 1, failed: 1, averageDurationMs: 2_000 },
    ]);
    expect(() => agent.tools.record({
      name: 'clock-skew',
      outcome: { kind: 'success', result: null },
      startedAt: 2,
      completedAt: 1,
    })).toThrow('completedAt');
    expect(() => database.exec("UPDATE tool_calls SET name = 'changed' WHERE id = 1"))
      .toThrow('tool_calls is insert-only');
    expect(() => database.exec('DELETE FROM tool_calls WHERE id = 1'))
      .toThrow('tool_calls is insert-only');
  });

  it('sanitizes tool-call payloads before persistence and supports controlled retention', () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    const agent = AgentFS.create(cloudflareStorage(database), {
      sanitizeToolCallValue: (_field, value) => {
        if (typeof value !== 'object' || value === null) return value;
        return { ...value, token: '[REDACTED]' };
      },
    });
    const oldId = agent.tools.record({
      name: 'fetch',
      parameters: { token: 'input-secret', path: '/public' },
      outcome: { kind: 'success', result: { token: 'output-secret', ok: true } },
      startedAt: 10,
      completedAt: 11,
    });
    const currentId = agent.tools.record({
      name: 'fetch',
      outcome: { kind: 'error', error: 'safe error' },
      startedAt: 20,
      completedAt: 21,
    });

    expect(agent.tools.get(oldId)).toMatchObject({
      parameters: { token: '[REDACTED]', path: '/public' },
      outcome: { kind: 'success', result: { token: '[REDACTED]', ok: true } },
    });
    expect(database.prepare('SELECT parameters, result FROM tool_calls WHERE id = ?').get(oldId))
      .toEqual({
        parameters: '{"token":"[REDACTED]","path":"/public"}',
        result: '{"token":"[REDACTED]","ok":true}',
      });
    expect(agent.tools.purgeBefore(20)).toBe(1);
    expect(agent.tools.get(oldId)).toBeUndefined();
    expect(agent.tools.get(currentId)).toBeDefined();
    expect(() => database.exec(`DELETE FROM tool_calls WHERE id = ${currentId}`))
      .toThrow('tool_calls is insert-only');
  });

  it('identifies the key when persisted KV JSON is corrupt', () => {
    const { agent, database } = createFixture();
    database.exec("INSERT INTO kv_store(key, value) VALUES ('bad:key', '{')");

    expect(() => agent.kv.get('bad:key')).toThrow('stored KV value for bad:key');
    expect(() => agent.kv.list('bad:')).toThrow('stored KV value for bad:key');
  });

  it('normalizes overlay metadata and keeps direct-child whiteout queries exact', () => {
    const { agent } = createFixture();
    agent.overlay.createWhiteout('/root.md', 1);
    agent.overlay.createWhiteout('/dir/child.md', 2);
    agent.overlay.createWhiteout('/dir/nested/grandchild.md', 3);

    expect(agent.overlay.listChildWhiteouts('/')).toEqual(['/root.md']);
    expect(agent.overlay.listChildWhiteouts('/dir')).toEqual(['/dir/child.md']);
    expect(agent.overlay.isWhiteout('/dir/child.md/deeper')).toBe(true);
    agent.overlay.removeWhiteout('/dir/child.md');
    expect(agent.overlay.isWhiteout('/dir/child.md')).toBe(false);
    expect(() => agent.overlay.createWhiteout('/dir/../escape', 4)).toThrow('normalized absolute');
  });
});
