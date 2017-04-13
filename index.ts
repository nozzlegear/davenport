import inspect from "logspect";
import AxiosLib, { AxiosResponse, } from "axios";

// Create an instance of Axios using our own defaults
const Axios = AxiosLib.create({
    // Like fetch, Axios should never throw an error if it receives a response
    validateStatus: (status) => true
})

declare const emit: (key: string, value) => void;

/**
 * Indicates whether the request was a success or not (between 200-300).
 */
function isOkay(response: AxiosResponse) {
    return response.status >= 200 && response.status < 300;
}

/**
 * Determines whether an object is a DavenportError.
 */
export function isDavenportError(error): error is DavenportError {
    return error.isDavenport;
}

/**
 * A generic view document for listing and counting all objects in the database.
 */
export const GENERIC_LIST_VIEW = {
    "name": "all",
    "map": function (doc) { emit(doc._id, doc); }.toString(),
    "reduce": "_count"
}

/**
 * Configures a Davenport client and database by validating the CouchDB version, creating indexes and design documents, and then returning a client to interact with the database.
 */
export async function configureDatabase<DocType extends CouchDoc>(databaseUrl: string, configuration: DatabaseConfiguration<DocType>, options?: ClientOptions): Promise<Client<DocType>> {
    const dbInfo = await Axios.get(databaseUrl);

    if (!isOkay(dbInfo)) {
        throw new Error(`Failed to connect to CouchDB instance at ${databaseUrl}. ${dbInfo.status} ${dbInfo.statusText}`);
    }

    const infoBody = dbInfo.data as { version: string };
    const version = parseInt(infoBody.version);

    if (version < 2) {
        inspect(`Warning: Davenport expects your CouchDB instance to be running CouchDB 2.0 or higher. Version detected: ${version}. Some database methods may not work.`)
    }

    const putResult = await Axios.put(`${databaseUrl}/${configuration.name}`);
    const preconditionFailed = 412; /* Precondition Failed - Database already exists. */

    if (putResult.status !== preconditionFailed && !isOkay(putResult)) {
        throw new DavenportError(`${putResult.status} ${putResult.statusText} ${putResult.data}`, putResult);
    }

    if (Array.isArray(configuration.indexes) && configuration.indexes.length > 0) {
        const data = {
            index: {
                fields: configuration.indexes
            },
            name: `${configuration.name}-indexes`,
        };
        const result = await Axios.post(`${databaseUrl}/${configuration.name}/_index`, data, {
            headers: {
                "Content-Type": "application/json"
            },
        });

        if (!isOkay(result)) {
            throw new DavenportError(`Error creating CouchDB indexes on database ${configuration.name}.`, result);
        }
    }

    if (Array.isArray(configuration.designDocs) && configuration.designDocs.length > 0) {
        await Promise.all(configuration.designDocs.map(async designDoc => {
            const url = `${databaseUrl}/${configuration.name}/_design/${designDoc.name}`;
            const getDoc = await Axios.get(url);
            const okay = isOkay(getDoc);
            let docFromDatabase: DesignDoc;

            if (!isOkay && getDoc.status !== 404) {
                inspect(`Davenport: Failed to retrieve design doc "${designDoc.name}". ${getDoc.status} ${getDoc.statusText}`, getDoc.data);
                return;
            }

            if (!isOkay) {
                docFromDatabase = {
                    _id: `_design/${designDoc.name}`,
                    language: "javascript",
                    views: {}
                }
            } else {
                docFromDatabase = getDoc.data;
            }

            const docViews = designDoc.views;
            let shouldUpdate = false;

            docViews.forEach(view => {
                if (!docFromDatabase.views || !docFromDatabase.views[view.name] || docFromDatabase.views[view.name].map !== view.map || docFromDatabase.views[view.name].reduce !== view.reduce) {
                    docFromDatabase.views = Object.assign({}, docFromDatabase.views, {
                        [view.name]: {
                            map: view.map,
                            reduce: view.reduce,
                        }
                    })

                    shouldUpdate = true;
                }
            });

            if (shouldUpdate) {
                inspect(`Davenport: Creating or updating design doc "${designDoc.name}".`);

                const result = await Axios.put(url, docFromDatabase, {
                    headers: {
                        "Content-Type": "application/json",
                    }
                });

                if (!isOkay(result)) {
                    inspect(`Davenport: Could not create or update CouchDB design doc "${designDoc.name}". ${result.status} ${result.statusText}`, result.data);
                }
            }

            return Promise.resolve();
        }));
    }

    return new Client<DocType>(databaseUrl, configuration.name, options);
}

/**
 * A client for interacting with a CouchDB instance. Use this when you don't want or need to use the `configureClient` function to create a database and set up design docs or indexes.
 */
export class Client<T extends CouchDoc> {
    constructor(private baseUrl: string, private databaseName: string, private options: ClientOptions = { warnings: true }) {
        this.databaseUrl = `${baseUrl}/${databaseName}/`;
    }

    private databaseUrl: string;

    private getOption(name: keyof ClientOptions) {
        if (!this.options) {
            return undefined;
        }

        return this.options[name];
    }

    /**
     * Checks that the Axios response is okay. If not, a DavenPort error is thrown.
     */
    private async checkErrorAndGetBody(result: AxiosResponse) {
        if (!isOkay(result)) {
            const message = `Error with ${result.config.method} request for CouchDB database ${this.databaseName} at ${result.config.url}. ${result.status} ${result.statusText}`;

            throw new DavenportError(message, result);
        }

        return result.data;
    };

    /**
     * Find matching documents according to the selector.
     */
    public async find(options: FindOptions<T>): Promise<T[]> {
        const result = await Axios.post(`${this.databaseUrl}/_find`, options, {
            headers: {
                "Content-Type": "application/json"
            },
        });

        const body = await this.checkErrorAndGetBody(result);

        if (body.warning && !!this.getOption("warnings")) {
            inspect("Davenport warning: Davenport.find result contained warning:", body.warning);
        }

        return body.docs;
    }

    /**
     * Lists documents in the database. Warning: this result WILL list design documents, and it will force the `include_docs` option to false. If you need to include docs, use .listWithDocs.
     */
    public async listWithoutDocs(options: ListOptions = {}): Promise<ListResponse<{ rev: string }>> {
        const result = await Axios.get(`${this.databaseUrl}/_all_docs`, {
            params: { ...this.encodeOptions(options), include_docs: false }
        });
        const body = await this.checkErrorAndGetBody(result) as AllDocsListResult<T>;

        return {
            offset: body.offset,
            total_rows: body.total_rows,
            rows: body.rows.map(r => r.value)
        }
    }

    /**
     * Lists documents in the database. Warning: this result WILL list design documents, and it will force the `include_docs` option to true. If you don't need to include docs, use .listWithoutDocs.
     */
    public async listWithDocs(options: ListOptions = {}): Promise<ListResponse<T>> {
        const result = await Axios.get(`${this.databaseUrl}/_all_docs`, {
            params: { ...this.encodeOptions(options), include_docs: true }
        });
        const body = await this.checkErrorAndGetBody(result) as AllDocsListResult<T>;

        return {
            offset: body.offset,
            total_rows: body.total_rows,
            rows: body.rows.map(r => r.doc)
        }
    }

    /**
     * Counts all documents in the database. Warning: this result WILL include design documents.
     */
    public async count(): Promise<number> {
        const result = await Axios.get(`${this.databaseUrl}/_all_docs`, {
            params: {
                limit: 0,
            }
        });
        const body = await this.checkErrorAndGetBody(result) as AllDocsListResult<T>;

        return body.total_rows;
    }

    /**
     * Counts all documents by the given selector. Warning: this uses more memory than a regular count, because it needs to pull in the _id field of all selected documents. For large queries, it's better to create a dedicated view and use the .view function.
     */
    public async countBySelector(selector: DocSelector<T>): Promise<number>
    public async countBySelector(selector: Partial<T>): Promise<number>
    public async countBySelector(selector): Promise<number> {
        const result = await this.find({
            fields: ["_id"],
            selector,
        })

        return result.length;
    }

    /**
     * Gets a document with the given id and optional revision id.
     */
    public async get(id: string, rev?: string): Promise<T> {
        const result = await Axios.get(this.databaseUrl + id, {
            params: { rev }
        });
        const body = await this.checkErrorAndGetBody(result);

        return body;
    }

    /**
     * Creates a document with a random id. By CouchDB convention, this will only return the id and revision id of the new document, not the document itself.
     */
    public async post(data: T): Promise<PostPutCopyResponse> {
        const result = await Axios.post(this.databaseUrl, data, {
            headers: {
                "Content-Type": "application/json"
            },
        });
        const body: CouchResponse = await this.checkErrorAndGetBody(result);

        return {
            id: body.id,
            rev: body.rev,
        }
    }

    /**
     * Updates or creates a document with the given id. By CouchDB convention, this will only return the id and revision id of the new document, not the document itself.
     */
    public async put(id: string, data: T, rev: string): Promise<PostPutCopyResponse> {
        if (!rev && !! this.getOption("warnings")) {
            inspect(`Davenport warning: no revision specified for Davenport.put function with id ${id}. This may cause a document conflict error.`);
        }

        const result = await Axios.put(this.databaseUrl + id, data, {
            headers: {
                "Content-Type": "application/json"
            },
            params: { rev }
        });
        const body: CouchResponse = await this.checkErrorAndGetBody(result);

        return {
            id: body.id,
            rev: body.rev,
        };
    }

    /**
     * Copies the document with the given id and assigns the new id to the copy. By CouchDB convention, this will only return the id and revision id of the new document, not the document itself.
     */
    public async copy(id: string, newId: string): Promise<PostPutCopyResponse> {
        const result = await Axios.request({
            url: this.databaseUrl + id,
            method: "COPY",
            headers: {
                Destination: newId
            },
        });
        const body: CouchResponse = await this.checkErrorAndGetBody(result);

        return {
            id: body.id,
            rev: body.rev,
        }
    }

    /**
     * Deletes the document with the given id and revision id.
     */
    public async delete(id: string, rev: string): Promise<void> {
        if (!rev && !!this.getOption("warnings")) {
            inspect(`Davenport warning: no revision specified for Davenport.delete function with id ${id}. This may cause a document conflict error.`);
        }

        const result = await Axios.delete(this.databaseUrl + id, {
            params: { rev }
        });

        await this.checkErrorAndGetBody(result);
    }

    /**
     * Checks that a document with the given id exists.
     */
    public async exists(id: string): Promise<boolean> {
        const result = await Axios.head(this.databaseUrl + id);

        return result.status === 200;
    }

    /**
     * Checks that a document that matches the field value exists.
     */
    public async existsByFieldValue(value, field: keyof T): Promise<boolean> {
        const findResult = await this.find({
            fields: ["_id"],
            limit: 1,
            selector: {
                [field]: value
            } as any
        });

        return findResult.length > 0;
    }

    /**
     * Checks that a document matching the selector exists.
     */
    public async existsBySelector(selector: DocSelector<T>): Promise<boolean> {
        const findResult = await this.find({
            fields: ["_id"],
            limit: 1,
            selector: selector as any,
        });

        return findResult.length > 0;
    }

    /**
     * Executes a view with the given designDocName and viewName. 
     */
    public async view<R>(designDocName: string, viewName: string, options: ViewOptions = {}): Promise<{ offset?: number, total_rows?: number, rows: R[] }> {
        const result = await Axios.get(`${this.databaseUrl}_design/${designDocName}/_view/${viewName}`, {
            params: this.encodeOptions(options),
        });
        const body = await this.checkErrorAndGetBody(result);

        return body;
    }

    private encodeOptions(options: ListOptions) : object {
        let requestOptions = {};

        for (var key in options) {
            if (key == "keys" || key == "key" || key == "startkey" || key == "endkey") {
                requestOptions[key] = JSON.stringify(options[key]);
            } else {
                requestOptions[key] = options[key];
            }
        }
        
        return requestOptions;
    }
}

export default Client;

export class DavenportError extends Error {
    constructor(message, public fullResponse: AxiosResponse) {
        super(message);

        this.status = fullResponse.status;
        this.statusText = fullResponse.statusText;
        this.body = fullResponse.data;
        this.url = fullResponse.headers.host || fullResponse.headers.HOST;
    }

    public readonly isDavenport = true;

    public status: number;

    public statusText: string;

    public url: string;

    public body: any;
}

export interface CouchDoc {
    /**
     * The object's database id.
     */
    _id?: string;

    /**
     * The object's database revision.
     */
    _rev?: string;
}

export interface PostPutCopyResponse {
    id: string;
    rev: string;
}

export interface ViewOptions extends ListOptions {
    reduce?: boolean;
    group?: boolean;
    group_level?: number;
}

/**
 * Options for listing database results.
 */
export interface ListOptions {
    limit?: number;
    key?: string;
    keys?: string[];
    start_key?: string | number;
    end_key?: string | number;
    inclusive_end?: boolean;
    descending?: boolean;
    skip?: number;
}

export interface AllDocsListResult<T> {
    rows: {
        id: string,
        key: string,
        value: {
            rev: string
        },
        doc: T
    }[],
    offset: number,
    total_rows: number
}

interface CouchResponse {
    ok: boolean;
    id: string;
    rev: string;
}

export interface ListResponse<T> {
    offset: number;
    total_rows: number;
    rows: T[];
}

export interface FindOptions<T> {
    fields?: string[];
    sort?: Object[];
    limit?: number;
    skip?: number;
    use_index?: Object;
    selector: Partial<T> | DocSelector<T>;
}

export interface CouchDBView {
    map: string;
    reduce?: string;
}

export interface DesignDoc extends CouchDoc {
    views: { [name: string]: CouchDBView };
    language: "javascript";
}

export interface DesignDocConfiguration {
    name: string,
    views: ({ name: string } & CouchDBView)[]
}

export interface DatabaseConfiguration<T> {
    name: string,
    indexes?: (keyof T)[],
    designDocs?: DesignDocConfiguration[],
}

export interface ClientOptions {
    /**
     * Whether the Davenport client should log warnings.
     */
    warnings: boolean;
}

export interface PropSelector {
    /**
     * Property is equal to this value.
     */
    $eq?: any;

    /**
     * Property is not equal to this value.
     */
    $ne?: any;
    
    /**
     * Property is greater than this value.
     */
    $gt?: any;

    /**
     * Property is greater than or equal to this value.
     */
    $gte?: any;

    /**
     * Property is less than this value.
     */
    $lt?: any;

    /**
     * Property is lesser than or equal to this value.
     */
    $lte?: any;
}

export type DocSelector<T> = Partial<Record<keyof T, PropSelector>>;