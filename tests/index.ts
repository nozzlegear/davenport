import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Client, {
  ClientOptions,
  configureDatabase,
  CouchDoc,
  DesignDocConfiguration,
  isDavenportError,
  PostPutCopyResponse,
  BulkDocumentError,
  ViewRow,
  ViewRowWithDoc,
} from '../src/index.js';

const DB_URL = 'http://localhost:5984';
const DB_NAME = 'davenport_tests';
const OPTIONS: ClientOptions = {
  // username: "test_admin",
  // password: "test_password"
};

declare const emit: (key: any, value: any) => void;

interface TestObject extends CouchDoc {
  hello: string;
  foo: number;
  bar: number;
}

function getClient(): Client<TestObject> {
  return new Client<TestObject>(DB_URL, DB_NAME, OPTIONS);
}

const designDoc: DesignDocConfiguration = {
  name: 'list',
  views: [
    {
      name: 'only-foos-greater-than-10',
      map: function (doc: TestObject) {
        if (doc.foo > 10) {
          emit(doc._id, doc);
        }
      }.toString(),
      reduce: '_count',
    },
    {
      name: 'by-foo-value',
      map: function (doc: TestObject) {
        emit(doc.foo, doc);
      }.toString(),
    },
    {
      name: 'by-foo-complex-key',
      map: function (doc: TestObject) {
        emit([doc.hello, doc.foo], doc);
      }.toString(),
    },
  ],
};

function isBulkError(arg: any): arg is BulkDocumentError {
  return !!arg.error;
}

function hasDoc(arg: ViewRow<TestObject>): arg is ViewRowWithDoc<TestObject> {
  return (arg as ViewRowWithDoc<TestObject>).doc !== undefined;
}

function checkViewRows(rows: ViewRow<TestObject>[]) {
  const errors: { property: string; message: string }[] = [];
  rows.forEach((row) => {
    function pushError(prop: string, expectedType: string) {
      errors.push({
        property: prop,
        message: `Property ${prop} was not of type ${expectedType}.`,
      });
    }

    if (hasDoc(row)) {
      if (!row.doc) {
        errors.push({ property: 'row.doc', message: 'row.doc was not found.' });
      }
    }

    if (typeof row.id !== 'string') {
      pushError('row.id', 'string');
    }

    if (!row.key) {
      errors.push({ property: 'row.key', message: 'row.key was not found.' });
    }

    if (!row.value) {
      errors.push({ property: 'row.value', message: 'row.value was not found.' });
      return;
    }

    if (typeof row.value.bar !== 'number') {
      pushError('row.value.bar', 'number');
    }

    if (typeof row.value.foo !== 'number') {
      pushError('row.value.foo', 'number');
    }

    if (typeof row.value.hello !== 'string') {
      pushError('row.value.hello', 'string');
    }

    if (typeof row.value._id !== 'string') {
      pushError('row.value._id', 'string');
    }

    if (typeof row.value._rev !== 'string') {
      pushError('row.value._rev', 'string');
    }
  });

  if (errors.length > 0) {
    console.log('View row errors: ', errors);
    throw new Error(`There were ${errors.length} errors in the view result.`);
  }

  return errors.length === 0;
}

async function createFoosGreaterThan10(hello: string = 'world') {
  const client = getClient();
  await Promise.all(
    [0, 1, 2, 3, 4, 5].map((i) =>
      client.post({
        bar: 5,
        foo: i === 0 ? 17 : Math.floor(Math.random() * 30),
        hello: hello,
      }),
    ),
  );
}

describe('Davenport', () => {
  beforeAll(async () => {
    const client = getClient();
    const result = await client.createDb();
    expect(result.ok).toBe(true);

    await client.post({
      bar: 117,
      foo: 22,
      hello: 'world',
    });
  }, 10000);

  afterAll(async () => {
    const client = getClient();
    const result = await client.deleteDb();
    expect(result.ok).toBe(true);
  }, 10000);

  it('Davenport.createDeleteDb', async () => {
    const dbName = 'davenport_delete_me';
    const client = new Client(DB_URL, dbName, OPTIONS);
    const createResult = await client.createDb();
    expect(createResult.ok).toBe(true);

    const dbInfo = await client.getDbInfo();
    expect(dbInfo.db_name).toBe(dbName);

    const deleteResult = await client.deleteDb();
    expect(deleteResult.ok).toBe(true);

    try {
      await client.getDbInfo();
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      if (isDavenportError(err)) {
        expect(err.status).toBe(404);
      } else {
        throw err;
      }
    }
  });

  it('Davenport.createDb when database already exists', async () => {
    const dbName = 'davenport_delete-me';
    const client = new Client(DB_URL, dbName, OPTIONS);
    const firstResult = await client.createDb();
    expect(firstResult.ok).toBe(true);

    const secondResult = await client.createDb();
    expect(secondResult.ok).toBe(true);
    expect(secondResult.alreadyExisted).toBe(true);

    await client.deleteDb();
  });

  it('Davenport.configureDatabase', async () => {
    const db = await configureDatabase<TestObject>(
      DB_URL,
      {
        name: DB_NAME,
        designDocs: [designDoc],
      },
      OPTIONS,
    );
    expect(db).toBeInstanceOf(Client);
  });

  it('Davenport new Client()', () => {
    const client = getClient();
    expect(client).toBeInstanceOf(Client);
  });

  it('Davenport.post', async () => {
    const client = getClient();
    const result = await client.post({
      bar: 5,
      foo: 4,
      hello: 'world',
    });
    expect(typeof result.id).toBe('string');
    expect(typeof result.rev).toBe('string');
  });

  it('Davenport.get', async () => {
    const client = getClient();
    const createResult = await client.post({
      bar: 5,
      foo: 4,
      hello: 'world',
    });
    const result = await client.get(createResult.id);
    expect(result.bar).toBe(5);
    expect(result.foo).toBe(4);
    expect(result.hello).toBe('world');
  });

  it('Davenport.put', async () => {
    const client = getClient();
    const createResult = await client.post({
      bar: 5,
      foo: 4,
      hello: 'world',
    });
    const putResult = await client.put(
      createResult.id,
      {
        bar: 4,
        foo: 3,
        hello: 'world',
      },
      createResult.rev,
    );
    const result = await client.get(putResult.id, putResult.rev);
    expect(createResult.id).toBe(putResult.id);
    expect(result.bar).toBe(4);
    expect(result.foo).toBe(3);
    expect(result.hello).toBe('world');
  });

  it('Davenport.listWithDocs', async () => {
    const client = getClient();
    const list = await client.listWithDocs();
    expect(list.offset).toBe(0);
    expect(Array.isArray(list.rows)).toBe(true);
    expect(list.total_rows).toBeGreaterThan(0);
    expect(
      list.rows.every((r: any) => {
        if (r._id?.includes('_design')) return true;
        return (
          !!r &&
          typeof r.bar === 'number' &&
          typeof r.foo === 'number' &&
          typeof r.hello === 'string' &&
          typeof r._id === 'string' &&
          typeof r._rev === 'string'
        );
      }),
    ).toBe(true);
  });

  it('Davenport.listWithoutDocs', async () => {
    const client = getClient();
    const list = await client.listWithoutDocs();
    expect(list.offset).toBe(0);
    expect(Array.isArray(list.rows)).toBe(true);
    expect(list.total_rows).toBeGreaterThan(0);
    expect(list.rows.every((r: any) => typeof r.rev === 'string' && typeof (r as any).id === 'undefined')).toBe(true);
  });

  it('Davenport.count', async () => {
    const client = getClient();
    const count = await client.count();
    expect(count).toBeGreaterThan(0);
  });

  it('Davenport.count with selector', async () => {
    const client = getClient();
    const uuid = `a-unique-string-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await client.post({
        bar: i,
        foo: i + 1,
        hello: uuid,
      });
    }
    const count = await client.countBySelector({
      hello: uuid,
    });
    expect(count).toBe(3);
  });

  it('Davenport.delete', async () => {
    const client = getClient();
    const createResult = await client.post({
      bar: 5,
      foo: 4,
      hello: 'world',
    });
    await expect(client.delete(createResult.id, createResult.rev)).resolves.not.toThrow();
  });

  it('Davenport.exists', async () => {
    const client = getClient();
    const createResult = await client.post({
      bar: 5,
      foo: 4,
      hello: 'world',
    });
    const exists = await client.exists(createResult.id);
    expect(exists).toBe(true);
  });

  it('Davenport.exists with field value', async () => {
    const client = getClient();
    const uuid = `a-unique-string-${Date.now()}`;
    await client.post({
      bar: 5,
      foo: 4,
      hello: uuid,
    });
    const exists = await client.existsByFieldValue(uuid, 'hello');
    expect(exists).toBe(true);
  });

  it('Davenport.copy', async () => {
    const client = getClient();
    const uuid = `a-unique-string-${Date.now()}`;
    const createResult = await client.post({
      bar: 5,
      foo: 4,
      hello: uuid,
    });
    const copyResult = await client.copy(createResult.id, uuid);
    const result = await client.get(copyResult.id);
    expect(result._id).toBe(uuid);
  });

  it('Davenport.find', async () => {
    const client = getClient();
    const uuid = `find-test-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await client.post({
        bar: 5,
        foo: 4,
        hello: uuid,
      });
    }
    const result = await client.find({
      selector: {
        hello: uuid,
      },
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.every((r: any) => r.hello === uuid)).toBe(true);
  });

  it('Davenport.view', async () => {
    await createFoosGreaterThan10();
    const client = getClient();
    const result = await client.view<TestObject>(designDoc.name, 'only-foos-greater-than-10');
    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(checkViewRows(result.rows)).toBe(true);
  });

  it('Davenport.viewWithDocs', async () => {
    await createFoosGreaterThan10();
    const client = getClient();
    const result = await client.viewWithDocs<TestObject>(designDoc.name, 'only-foos-greater-than-10');
    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(checkViewRows(result.rows)).toBe(true);
  });

  it('Davenport.bulk insert with auto-generated ids.', async () => {
    const docs = Array.from({ length: 100 }, (_, i) => ({
      bar: i,
      foo: i * 3,
      hello: 'world',
    }));
    const client = getClient();
    const result = await client.bulk(docs);
    expect(result.length).toBe(100);
    expect(result.every((item: any) => !isBulkError(item))).toBe(true);
    expect(result.every((item: any) => !!item.id && !!item.rev)).toBe(true);
  });

  it('Davenport.bulk insert and update with conflicts', async () => {
    const client = getClient();
    const totalExisting = 10;
    const totalOperations = 100;
    const existingDocs = await client.bulk(
      Array.from({ length: totalExisting }, (_, i) => ({
        bar: i,
        foo: i * 5,
        hello: 'existing doc',
      })),
    );
    const result = await client.bulk(
      Array.from({ length: totalOperations }, (_, i) => {
        const existingDoc = existingDocs[i];
        const id = existingDoc && !isBulkError(existingDoc) ? existingDoc.id : undefined;
        return {
          _id: id,
          bar: i,
          foo: i * 5,
          hello: 'generated doc',
        };
      }),
    );
    expect(result.length).toBe(100);
    const conflicts = result.filter(isBulkError);
    const rest = result.filter((item: any) => !isBulkError(item));
    expect(conflicts.length).toBe(totalExisting);
    expect(rest.length).toBe(totalOperations - totalExisting);
  });
});
