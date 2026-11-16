const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(crm) {
  const window = {};
  vm.runInNewContext(fs.readFileSync('app/scripts/remote-data.js', 'utf8'), { window });
  return window.AccountingManagerApp.createRemoteDataModule({ crm,
    resolveCoqlFields: async (_, fields) => fields,
    helpers: { dedupeById: rows => [...new Map(rows.map(row => [row.id, row])).values()] }
  });
}
test('unfiltered payment accounts use a WHERE clause and stable pagination beyond 200 rows', async () => {
  const queries = [], records = Array.from({length: 237}, (_, i) => ({id: String(i + 1)}));
  const remote = setup({
    coql: async (query, options) => {
      assert.equal(options.strict, true);
      assert.match(query, /from Payment_Accounts where id is not null order by id asc limit/);
      queries.push(query);
      const offset = Number(query.match(/limit (\d+), 200$/)[1]);
      return records.slice(offset, offset + 200);
    },
    getAllRecords: async () => { throw Error('Unexpected fallback'); }
  });
  assert.equal((await remote.loadModuleRecords('Payment_Accounts', ['id', 'Name'])).length, 237);
  assert.equal(queries.length, 2); assert.match(queries[1], /limit 200, 200$/);
});
test('explicit filters and ordering are preserved and page builders have valid defaults', async () => {
  const queries = [], remote = setup({coql: async query => {queries.push(query); return [];}});
  await remote.loadRecordsByCoql('Payment_Accounts', ['id'], {whereClause: "Status = 'Active'", orderByClause: 'Name asc, id asc'});
  assert.match(queries[0], /where Status = 'Active' order by Name asc, id asc/);
  assert.match(await remote.buildCoqlPageQuery('Payment_Accounts', ['id'], {page: 2, perPage: 50}), /where id is not null order by id asc limit 50, 51$/);
});
test('filtered query failures propagate with query context instead of returning an empty result', async () => {
  const remote = setup({coql: async () => {throw Error('Invalid field');}});
  await assert.rejects(remote.loadModuleRecords('Payment_Accounts', ['id'], {whereClause: "Status = 'Active'"}), error => {
    assert.equal(error.message, 'Invalid field');
    assert.match(error.coqlQuery, /where Status = 'Active'/); return true;
  });
});
