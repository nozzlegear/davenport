# Davenport

Davenport is a CouchDB client for simplifying common tasks like get, list, create, update and delete. It comes complete with full TypeScript definitions.

## Installing



## Importing

Davenport can be imported via ES6-style default import syntax, or via Node's `require`:

```js
// ES6
import Client from "davenport";

// require
const Client = require("davenport").Client;
```

## Async/await and promises

All Davenport functions are implemented as async/awaitable promises. You'll need Node.js v4 and above to use Davenport, as Node v3 and below don't support the generators needed for async/await.

Because async/await implements a promise-like interface in ES6, you can use the functions in this library in two different ways:

With async/await:

```js
//1. async/await
const foo = await client.get(id);

//Do something with the object
```

With promises:

```js
const foo = client.get(id).then((shop) => {
    //Do something with the object.
}); 
```

Both methods are supported and the results won't differ. The only difference is an `await`ed method will throw an error if the method fails, where a promise would just fail silently unless you use `.catch`.

For the sake of being concise, all examples in this doc will use async/await.

## Client vs configureDatabase

Davenport exports a `configureDatabase` function that can help you create a database, add indexes, set up design documents with views, and then returns a client ready to interact with that database. It will also check that your CouchDB server is at least version 2.0, which is required for many of the functions used by Davenport.

```js
// ES6
import { configureDatabase } from "davenport";

// require
const configureDatabase = require("davenport").configureDatabase;

// Configure the database with an index on the 'foo' object property, and a view that lists all foos greater than 5.
const designDoc = {
    name: "list",
    views: [{
        name: "only-foos-greater-than-5",
        map: function (doc: TestObject) {
            if (doc.foo > 5) {
                emit(doc._id, doc);
            }
        }.toString(),
        reduce: "_count"
    }]
}

const client = await configureDatabase(DB_URL, {
    name: "my-foo-database",
    designDocs: [designDoc]
})
```

You don't need to use the `configureDatabase` function to interact with your database, though. If you have no need for setting up design docs or indexes, just instantiate a new `Client` while passing in a database URL and database name.

```js
import Client from "davenport";

const client = new Client(DB_URL, "my-foo-database");
```

## Typescript declarations

Using TypeScript? The TypeScript compiler will automatically pull in Davenport definitions for you when you install Davenport, **as long as you're using TypeScript 2+**. 

Pass your `CouchDoc` extending interface to the `configureDatabase` and `new Client` functions to get full TypeScript support for all client methods:

```ts
import Client, { CouchDoc } from "davenport";

interface Foo extends CouchDoc {
    foo: number,
    bar: number,
}

const client = new Client<Foo>(DB_URL, "my-foo-database");
const myFoo = await client.get(id);

// TypeScript automatically knows that variable `myFoo` is a Foo object.
```