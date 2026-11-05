import { describe, it, expect } from 'vitest';
import { constantOrderTerms } from './sql-portability';

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
