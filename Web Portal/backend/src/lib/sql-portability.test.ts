import { describe, it, expect } from 'vitest';
import { constantOrderTerms, portabilityProblems } from './sql-portability';

describe('constantOrderTerms: sort terms MariaDB reads as a column position', () => {
  it('finds a bare TRUE/FALSE, number, NULL, string or placeholder, in brackets or not', () => {
    expect(constantOrderTerms('SELECT t.id FROM t ORDER BY (FALSE) DESC, t.updatedAt DESC LIMIT ? OFFSET ?')).toEqual(['(FALSE) DESC']);
    expect(constantOrderTerms('SELECT 1 FROM t ORDER BY 0')).toEqual(['0']);
    expect(constantOrderTerms('SELECT 1 FROM t ORDER BY ((TRUE)) ASC, ? DESC, NULL, \'x\'')).toEqual(['((TRUE)) ASC', '? DESC', 'NULL', "'x'"]);
    expect(constantOrderTerms('SELECT kind, COUNT(*) FROM x GROUP BY 1')).toEqual(['1']);
  });

  it('leaves columns and expressions alone, nested queries too', () => {
    expect(constantOrderTerms("SELECT t.id FROM t ORDER BY (si.head LIKE ? ESCAPE '!') DESC, (t.completedAt IS NOT NULL OR c.category = 'DONE') ASC, t.id DESC LIMIT ?")).toEqual([]);
    expect(constantOrderTerms('SELECT kind, id FROM (SELECT 1 AS id FROM t ORDER BY t.a, (FALSE) DESC LIMIT 5) x ORDER BY score DESC, at DESC')).toEqual(['(FALSE) DESC']);
    expect(constantOrderTerms('SELECT 1 FROM t ORDER BY (FALSE) * 1000 + t.a DESC')).toEqual([]);
    expect(constantOrderTerms("SELECT ',' AS c, ')' AS d FROM t ORDER BY c")).toEqual([]);
    expect(constantOrderTerms('SELECT 1 FROM t WHERE a = 1')).toEqual([]);
  });
});

// 1.23.2 — every rule the MariaDB audit of Merge tasks checked, in one place (the Management page's SQL
// is checked by the same rules now).
describe('portabilityProblems: what MariaDB (the live server) reads otherwise or refuses', () => {
  it('finds each kind', () => {
    expect(portabilityProblems('SELECT 1 FROM t ORDER BY (FALSE) DESC')).toEqual(['constant sort term: (FALSE) DESC']);
    expect(portabilityProblems('SELECT 1 FROM t WHERE id IN (SELECT id FROM u ORDER BY a LIMIT 5)')).toEqual(['LIMIT in IN (…)']);
    expect(portabilityProblems('DELETE FROM t RETURNING id')).toEqual(['not portable syntax']);
    expect(portabilityProblems("SELECT data->>'$.a' FROM t")).toEqual(['not portable syntax']);
    expect(portabilityProblems('SELECT ROW_NUMBER() OVER (ORDER BY a) FROM t')).toEqual(['not portable syntax']);
    expect(portabilityProblems('WITH x AS (SELECT 1) SELECT * FROM x')).toEqual(['not portable syntax']);
    expect(portabilityProblems('SELECT 1 FROM t FOR UPDATE SKIP LOCKED')).toEqual(['not portable syntax']);
    expect(portabilityProblems('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')).toEqual(['isolation statement']);
    expect(portabilityProblems('UPDATE t JOIN u ON u.id = t.u SET t.a = 1 ORDER BY t.id LIMIT 1')).toEqual(['multi-table update/delete with ORDER BY/LIMIT']);
  });

  // 1.23.27 — found by the first run of the DB suite on MariaDB 11.8.9 (configured like live).
  it('finds FOR SHARE (MariaDB: LOCK IN SHARE MODE) and a bare `vector`, a keyword in MariaDB 11.7 and later', () => {
    expect(portabilityProblems('SELECT deletedAt FROM inspection_forms WHERE id = ? FOR SHARE')).toEqual(['not portable syntax']);
    expect(portabilityProblems('INSERT INTO search_embeddings (kind, recordId, vector) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE vector = VALUES(vector)')).toEqual(['bare keyword as a name: vector']);
    expect(portabilityProblems('SELECT kind, recordId AS id, vector FROM search_embeddings WHERE model = ?')).toEqual(['bare keyword as a name: vector']);
    expect(portabilityProblems('SELECT 1 FROM search_embeddings WHERE vector IS NULL')).toEqual(['bare keyword as a name: vector']);
  });

  it('leaves the portable forms alone: LOCK IN SHARE MODE, `vector` quoted or after a table name, the word inside a string', () => {
    expect(portabilityProblems('SELECT deletedAt FROM inspection_forms WHERE id = ? LOCK IN SHARE MODE')).toEqual([]);
    expect(portabilityProblems('INSERT INTO search_embeddings (kind, `vector`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `vector` = VALUES(`vector`)')).toEqual([]);
    expect(portabilityProblems("SELECT e.vector, e.vectorDims FROM search_embeddings e WHERE e.model = 'vector'")).toEqual([]);
  });

  it('leaves ordinary statements alone', () => {
    expect(portabilityProblems('SELECT t.id FROM tasks t JOIN kanban_columns c ON c.id = t.columnId WHERE t.projectId IN (?,?) ORDER BY t.dueDate IS NULL, t.dueDate ASC, t.`key` ASC LIMIT ?')).toEqual([]);
    expect(portabilityProblems('SELECT a.id FROM action_items a WHERE a.status IN (SELECT 1 FROM x WHERE y = ?) LIMIT 3')).toEqual([]);
    expect(portabilityProblems('SELECT CAST(SUM(a.result = ?) AS SIGNED) AS passed FROM inspection_answers a GROUP BY a.inspectionId')).toEqual([]);
  });
});
