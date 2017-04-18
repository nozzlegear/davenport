import inspect from "logspect";
import { Expect, AsyncTest, Timeout, TestFixture } from "alsatian";
import Client, { ClientOptions, configureDatabase, CouchDoc, DesignDocConfiguration, PropSelector } from "../";

const DB_URL = "http://localhost:5984";
const DB_NAME = "davenport_tests";
const OPTIONS: ClientOptions = {
    username: "test_admin",
    password: "test_password"
}

declare const emit: (key: string, value) => void;

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
    views: [{
        name: "only-foos-greater-than-10",
        map: function (doc: TestObject) {
            if (doc.foo > 10) {
                emit(doc._id, doc);
            }
        }.toString(),
        reduce: "_count"
    }]
}

@TestFixture("Davenport")
export class DavenportTestFixture {
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
        const client = getClient();
        const result = await client.view(designDoc.name, designDoc.views[0].name);

        Expect(Array.isArray(result.rows)).toBe(true);
    }
}