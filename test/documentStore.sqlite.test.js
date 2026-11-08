const path = require('path');
const { createTempDir } = require('./helpers');
const { defineDocumentStoreContract } = require('./documentStore.contract');
const { createDocumentStore } = require('../db/documentStore');
const { createSqliteStorage } = require('../db/sqliteStorage');

defineDocumentStoreContract('sqlite', async () => {
    const storage = createSqliteStorage(path.join(createTempDir('store'), 'store.sqlite'));
    return { api: createDocumentStore(storage), storage };
});
