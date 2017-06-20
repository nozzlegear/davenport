import Client, {
    BasicCouchResponse,
    ClientOptions,
    configureDatabase,
    CouchDoc,
    DesignDocConfiguration,
    isDavenportError,
    PropSelector,
    ViewRow,
    ViewRowWithDoc
    } from '../';
import inspect from 'logspect';
import {
    AsyncTeardownFixture,
    AsyncTest,
    Expect,
    TestFixture,
    Timeout
    } from 'alsatian';

const DB_URL = "http://localhost:5984";
const DB_NAME = "davenport_tests";
const OPTIONS: ClientOptions = {
    // username: "test_admin",
    // password: "test_password"
}

declare const emit: (key, value) => void;

interface TestObject extends CouchDoc {
    hello: string;
    foo: number;
    bar: number;
}

function isClient(client): client is Client<any> {
    return client instanceof (Client);
}

function getClient(): Client<TestObject> {
    return new Client<TestObject>(DB_URL, DB_NAME, OPTIONS);
}

const designDoc: DesignDocConfiguration = {
    name: "list",
    views: [
        {
            name: "only-foos-greater-than-10",
            map: function (doc: TestObject) {
                if (doc.foo > 10) {
                    emit(doc._id, doc);
                }
            }.toString(),
            reduce: "_count"
        },
        {
            name: "by-foo-value",
            map: function (doc: TestObject) {
                emit(doc.foo, doc);
            }.toString(),
        },
        {
            name: "by-foo-complex-key",
            map: function (doc: TestObject) {
                emit([doc.hello, doc.foo], doc);
            }.toString(),
        }
    ]
}

@TestFixture("Davenport")
export class DavenportTestFixture {
    @AsyncTest("Davenport.createDeleteDb")
    @Timeout(5000)
    public async createDeleteDbTest() {
        const dbName = "davenport_delete_me";
        const client = new Client(DB_URL, dbName, OPTIONS);

        let result = await client.createDb();
        Expect(result.ok).toBe(true);

        const dbInfo = await client.getDbInfo();
        Expect(dbInfo.db_name).toEqual(dbName);

        result = await client.deleteDb();
        Expect(result.ok).toBe(true);

        try {
            await client.getDbInfo();
        } catch (err) {
            if (isDavenportError(err)) {
                Expect(err.status).toEqual(404);
            } else {
                throw err;
            }
        }
    }

    @AsyncTeardownFixture
    @Timeout(5000)
    public async teardownFixture() {
        const client = getClient();
        const result = await client.deleteDb();
        Expect(result.ok).toBe(true);
    }

    @AsyncTest("Davenport.configureDatabase")
    @Timeout(5000)
    public async configureTest() {
        const db = await configureDatabase<TestObject>(DB_URL, {
            name: DB_NAME,
            designDocs: [designDoc]
        }, OPTIONS)

        Expect(isClient(db)).toBe(true);
    }

    @AsyncTest("Davenport new Client()")
    @Timeout(5000)
    public async createClientTest() {
        const client = getClient();

        Expect(isClient(client)).toBe(true);
    }

    @AsyncTest("Davenport.post")
    @Timeout(5000)
    public async postTest() {
        const client = getClient();
        const result = await client.post({
            bar: 5,
            foo: 4,
            hello: "world"
        });

        Expect(typeof (result.id)).toBe("string");
        Expect(typeof (result.rev)).toBe("string");
    }

    @AsyncTest("Davenport.get")
    @Timeout(5000)
    public async getTest() {
        const client = getClient();
        const createResult = await client.post({
            bar: 5,
            foo: 4,
            hello: "world"
        });
        const result = await client.get(createResult.id);

        Expect(result.bar).toBe(5);
        Expect(result.foo).toBe(4);
        Expect(result.hello).toBe("world");
    }

    @AsyncTest("Davenport.put")
    @Timeout(5000)
    public async putTest() {
        const client = getClient();
        const createResult = await client.post({
            bar: 5,
            foo: 4,
            hello: "world"
        });
        const putResult = await client.put(createResult.id, {
            bar: 4,
            foo: 3,
            hello: "world",
        }, createResult.rev);
        const result = await client.get(putResult.id, putResult.rev);

        Expect(createResult.id).toBe(putResult.id);
        Expect(result.bar).toBe(4);
        Expect(result.foo).toBe(3);
        Expect(result.hello).toBe("world");
    }

    @AsyncTest("Davenport.listWithDocs")
    @Timeout(5000)
    public async listWithDocsTest() {
        const client = getClient();
        const list = await client.listWithDocs();

        Expect(list.offset).toBe(0);
        Expect(Array.isArray(list.rows)).toBe(true);
        Expect(list.total_rows).toBeGreaterThan(0);
        Expect(list.rows.every(r => {
            if (r._id.indexOf("_design") > -1) {
                return true;
            }

            return !!r &&
                typeof (r.bar) === "number" &&
                typeof (r.foo) === "number" &&
                typeof (r.hello) === "string" &&
                typeof (r._id) === "string" &&
                typeof (r._rev) === "string";
        })).toBe(true);
    }

    @AsyncTest("Davenport.listWithoutDocs")
    @Timeout(5000)
    public async listWithoutDocsTest() {
        const client = getClient();
        const list = await client.listWithoutDocs();

        Expect(list.offset).toBe(0);
        Expect(Array.isArray(list.rows)).toBe(true);
        Expect(list.total_rows).toBeGreaterThan(0);
        Expect(list.rows.every(r => typeof(r.rev) === "string" && typeof(r["id"]) === "undefined" )).toBe(true);
    }

    @AsyncTest("Davenport.count")
    @Timeout(5000)
    public async countTest() {
        const client = getClient();
        const count = await client.count();

        Expect(count).toBeGreaterThan(0);
    }

    @AsyncTest("Davenport.count with selector")
    @Timeout(5000)
    public async countWithSelectorTest() {
        const client = getClient();
        const uuid = `a-unique-string-${Date.now()}`;

        for (let i = 0; i < 3; i++) {
            await client.post({
                bar: i,
                foo: i + 1,
                hello: uuid
            })
        };

        const count = await client.countBySelector({
            hello: uuid
        });

        Expect(count).toBe(3);
    }

    @AsyncTest("Davenport.count with selector indexes")
    @Timeout(5000)
    public async countWithSelectorIndexesTest() {
        const client = getClient();
        const uuid = `a-unique-string-${Date.now()}`;

        for (let i = 0; i < 3; i++) {
            await client.post({
                bar: i,
                foo: i + 1,
                hello: uuid
            })
        };

        const count = await client.countBySelector({
            hello: {
                $eq: uuid
            }
        });

        Expect(count).toBe(3);
    }

    @AsyncTest("Davenport.delete")
    @Timeout(5000)
    public async deleteTest() {
        const client = getClient();
        const createResult = await client.post({
            bar: 5,
            foo: 4,
            hello: "world"
        });
        let error;

        try {
            await client.delete(createResult.id, createResult.rev)
        } catch (e) {
            error = e;
        }

        Expect(error).not.toBeDefined();
    }

    @AsyncTest("Davenport.exists")
    @Timeout(5000)
    public async existsTest() {
        const client = getClient();
        const createResult = await client.post({
            bar: 5,
            foo: 4,
            hello: "world"
        });
        const exists = await client.exists(createResult.id);

        Expect(exists).toBe(true);
    }

    @AsyncTest("Davenport.exists with field value")
    @Timeout(5000)
    public async existsWithFieldValueTest() {
        const client = getClient();
        const uuid = `a-unique-string-${Date.now()}`;
        const createResult = await client.post({
            bar: 5,
            foo: 4,
            hello: uuid,
        })
        const exists = await client.existsByFieldValue(uuid, "hello");

        Expect(exists).toBe(true);
    }

    @AsyncTest("Davenport.exists with selector")
    @Timeout(5000)
    public async existsWithSelectorTest() {
        const client = getClient();
        const uuid = `a-unique-string-${Date.now()}`;
        const createResult = await client.post({
            bar: 5,
            foo: 4,
            hello: uuid,
        })
        const exists = await client.existsBySelector({
            hello: {
                $eq: uuid
            }
        });

        Expect(exists).toBe(true);
    }

    @AsyncTest("Davenport.copy")
    @Timeout(5000)
    public async copyTest() {
        const client = getClient();
        const uuid = `a-unique-string-${Date.now()}`;
        const createResult = await client.post({
            bar: 5,
            foo: 4,
            hello: uuid
        });
        const copyResult = await client.copy(createResult.id, uuid);
        const result = await client.get(copyResult.id);

        Expect(result._id).toBe(uuid);
    }

    @AsyncTest("Davenport.find")
    @Timeout(5000)
    public async findTest() {
        const client = getClient();

        for (let i = 0; i < 3; i++) {
            await client.post({
                bar: 5,
                foo: 4,
                hello: "shwoop"
            })
        }

        const result = await client.find({
            selector: {
                hello: "shwoop"
            }
        });

        Expect(Array.isArray(result)).toBe(true);
        Expect(result.every(r => r.hello === "shwoop")).toBe(true);
    }

    @AsyncTest("Davenport.view")
    @Timeout(5000)
    public async viewTest() {
        await this.createFoosGreaterThan10();

        const client = getClient();
        const result = await client.view<TestObject>(designDoc.name, "only-foos-greater-than-10");

        const testRows = () => {
            this.checkViewRows(result.rows);
        }

        Expect(Array.isArray(result.rows)).toBe(true);
        Expect(result.rows.length > 0);
        Expect(testRows).not.toThrow();
        Expect(this.checkViewRows(result.rows)).toBe(true);
    }

    @AsyncTest("Davenport.viewWithDocs")
    @Timeout(5000)
    public async viewWithDocsTest() {
        await this.createFoosGreaterThan10();

        const client = getClient();
        const result = await client.viewWithDocs<TestObject>(designDoc.name, "only-foos-greater-than-10");

        const testRows = () => {
            this.checkViewRows(result.rows);
        }

        Expect(Array.isArray(result.rows)).toBe(true);
        Expect(result.rows.length > 0);
        Expect(testRows).not.toThrow();
        Expect(this.checkViewRows(result.rows)).toBe(true);
    }

    @AsyncTest("Davenport.view reduces result")
    @Timeout(5000)
    public async viewReducesTests() {
        const client = getClient();
        const result = await client.view<number>(designDoc.name, "only-foos-greater-than-10", {
            reduce: true,
            group: false
        });

        const sum = result.rows.reduce((sum, row) => sum + row.value, 0);

        Expect(Array.isArray(result.rows)).toBe(true);
        Expect(sum).toBeGreaterThan(0);
    }

    @AsyncTest("Davenport.view with start and end keys")
    @Timeout(5000)
    public async viewWithKeysTest() {
        await this.createFoosGreaterThan10();

        const client = getClient();
        const result = await client.view<TestObject>(designDoc.name, "by-foo-value", {
            start_key: 15,
            end_key: 20
        });

        const testRows = () => {
            this.checkViewRows(result.rows);
        }

        Expect(true).toBe(true);
        Expect(result.rows.length > 0).toBe(true);
        Expect(testRows).not.toThrow();
        Expect(this.checkViewRows(result.rows)).toBe(true);
        Expect(result.rows.every(row => row.value.foo >= 15 && row.value.foo <= 20)).toBe(true);
    }

    @AsyncTest("Davenport.view with complex start and end keys")
    @Timeout(5000)
    public async viewWithComplexKeyTest() {
        const keyPart = "keyPart";
        await this.createFoosGreaterThan10(keyPart);
        const client = getClient();
        let result = await client.view<TestObject>(designDoc.name, "by-foo-complex-key", {
            start_key: [keyPart],
            end_key: [keyPart, {}],
            inclusive_end: true
        });

        const testRows = () => {
            this.checkViewRows(result.rows);
        }

        Expect(result.rows.length).toEqual(6);
        Expect(testRows).not.toThrow();
        Expect(this.checkViewRows(result.rows)).toBe(true);

        result = await client.view<TestObject>(designDoc.name, "by-foo-complex-key", {
            start_key: [keyPart, 15],
            end_key: [keyPart, 20],
            inclusive_end: true
        });

        Expect(testRows).not.toThrow();
        Expect(this.checkViewRows(result.rows)).toBe(true);
        Expect(result.rows.every(row => (row.key[1] >= 15 && row.key[1] <= 20))).toBe(true);
        Expect(result.rows.every(row => row.value.foo >= 15 && row.value.foo <= 20)).toBe(true);
    }

    private async createFoosGreaterThan10(hello: string = "world") {
        const client = getClient();

        await Promise.all([0,1,2,3,4,5].map(i => client.post({
            bar: 5,
            foo: i === 0 ? 17 : Math.floor(Math.random() * 30),
            hello: hello
        })));
    }

    private hasDoc(arg: ViewRow<TestObject>): arg is ViewRowWithDoc<TestObject> {
      return (arg as ViewRowWithDoc<TestObject>).doc !== undefined;
    }
    
    private checkViewRows(rows: ViewRow<TestObject>[]) {
        const errors = rows.reduce((errors, row) => {
            function pushError(prop: string, expectedType: string) {
                errors.push({
                    property: prop,
                    message: `Property ${prop} was not of type ${expectedType}.`
                })
            };

            if (this.hasDoc(row)) {
              if (! row.doc) {
                errors.push({property: "row.doc", message: "row.doc was not found."});
              }
            }

            if (typeof(row.id) !== "string") {
                pushError("row.id", "string");
            }

            if (! row.key) {
                errors.push({property: "row.key", message: "row.key was not found."})
            }

            if (! row.value) {
                errors.push({property: "row.value", message: "row.value was not found."})

                return errors;
            }

            if (typeof(row.value.bar) !== "number") {
                pushError("row.value.bar", "number");
            }

            if (typeof(row.value.foo) !== "number") {
                pushError("row.value.foo", "number");
            }

            if (typeof(row.value.hello) !== "string") {
                pushError("row.value.hello", "string");
            }

            if (typeof(row.value._id) !== "string") {
                pushError("row.value._id", "string");
            }

            if (typeof(row.value._rev) !== "string") {
                pushError("row.value._rev", "string");
            }

            return errors;
        }, [] as {property: string; message: string;}[]);

        if (errors.length > 0) {
            inspect("View row errors: ", errors);

            throw new Error(`There were ${errors.length} errors in the view result.`);
        }

        return errors.length === 0;
    }
}