declare const emit: (key: string, value) => void;

export interface Logger {
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
}

/**
 * Logs a warning if warnings are enabled.
 */
function warn(options: ClientOptions | undefined, ...args: any[]) {
    if (options && options.warnings !== false) {
        (options.logger?.warn || console.warn)(...args);
    }
}

/**
 * Indicates whether the request was a success or not (between 200-300).
 */
function isOkay(response: Response) {
    return response.status >= 200 && response.status < 300;
}

/**
 * Determines whether an object is a DavenportError.
 */
export function isDavenportError(error: any): error is DavenportError {
    return !!error && error.isDavenport === true;
}

/**
 * A generic view document for listing and counting all objects in the database.
 */
export const GENERIC_LIST_VIEW = {
    "name": "all",
    "map": function (doc: any) { emit(doc._id, doc); }.toString(),
    "reduce": "_count"
}

/**
 * Configures a Davenport client and database by validating the CouchDB version, creating indexes and design documents, and then returning a client to interact with the database.
 */
export async function configureDatabase<DocType extends CouchDoc>(databaseUrl: string, configuration: DatabaseConfiguration<DocType>, options?: ClientOptions): Promise<Client<DocType>> {
    const client = new Client<DocType>(databaseUrl, configuration.name, options);
    const dbInfoResponse = await client.request(databaseUrl, { method: "GET" });

    if (!isOkay(dbInfoResponse)) {
        throw new Error(`Failed to connect to CouchDB instance at ${databaseUrl}. ${dbInfoResponse.status} ${dbInfoResponse.statusText}`);
    }

    const infoBody = await dbInfoResponse.json() as { version: string };
    const version = parseInt(infoBody.version);

    if (version < 2) {
        warn(options, `Warning: Davenport expects your CouchDB instance to be running CouchDB 2.0 or higher. Version detected: ${version}. Some database methods may not work.`)
    }

    const putResult = await client.request(`${databaseUrl}/${configuration.name}`, { method: "PUT" });
    const preconditionFailed = 412; /* Precondition Failed - Database already exists. */

    if (putResult.status !== preconditionFailed && !isOkay(putResult)) {
        const body = await putResult.text();
        throw new DavenportError(`${putResult.status} ${putResult.statusText} ${body}`, putResult, body);
    }

    if (Array.isArray(configuration.indexes) && configuration.indexes.length > 0) {
        const data = {
            index: {
                fields: configuration.indexes
            },
            name: `${configuration.name}-indexes`,
        };
        const result = await client.request(`${databaseUrl}/${configuration.name}/_index`, {
            method: "POST",
            body: data,
        });

        if (!isOkay(result)) {
            const body = await result.text();
            throw new DavenportError(`Error creating CouchDB indexes on database ${configuration.name}.`, result, body);
        }
    }

    if (Array.isArray(configuration.designDocs) && configuration.designDocs.length > 0) {
        await Promise.all(configuration.designDocs.map(async designDoc => {
            const url = `${databaseUrl}/${configuration.name}/_design/${designDoc.name}`;
            const getDocResponse = await client.request(url, { method: "GET" });
            const okay = isOkay(getDocResponse);
            let docFromDatabase: DesignDoc;

            if (!okay && getDocResponse.status !== 404) {
                const body = await getDocResponse.text();
                warn(options, `Davenport: Failed to retrieve design doc "${designDoc.name}". ${getDocResponse.status} ${getDocResponse.statusText}`, body);
                return;
            }

            if (!okay) {
                docFromDatabase = {
                    _id: `_design/${designDoc.name}`,
                    _rev: undefined,
                    language: "javascript",
                    views: {}
                }
            } else {
                docFromDatabase = await getDocResponse.json();
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
                warn(options, `Davenport: Creating or updating design doc "${designDoc.name}" for database "${configuration.name}".`);

                const result = await client.request(url, {
                    method: "PUT",
                    body: docFromDatabase,
                });

                if (!isOkay(result)) {
                    const body = await result.text();
                    warn(options, `Davenport: Could not create or update CouchDB design doc "${designDoc.name}" for database "${configuration.name}". ${result.status} ${result.statusText}`, body);
                }
            }
        }));
    }

    return client;
}

/**
 * A client for interacting with a CouchDB instance. Use this when you don't want or need to use the `configureClient` function to create a database and set up design docs or indexes.
 */
export class Client<T extends CouchDoc> {
    constructor(private baseUrl: string, private databaseName: string, private options: ClientOptions = { warnings: true }) {
        this.databaseUrl = this.baseUrl.endsWith("/") ? `${this.baseUrl}${this.databaseName}/` : `${this.baseUrl}/${this.databaseName}/`;
    }

    private databaseUrl: string;

    private getOption(name: keyof ClientOptions) {
        if (!this.options) {
            return undefined;
        }

        return this.options[name];
    }

    /**
     * Executes a fetch request with the given options.
     */
    public async request(url: string, requestOptions: { method: string, body?: any, params?: any, headers?: any }): Promise<Response> {
        const fullUrl = new URL(url);
        if (requestOptions.params) {
            Object.keys(requestOptions.params).forEach(key => {
                const value = requestOptions.params[key];
                if (value !== undefined) {
                    fullUrl.searchParams.append(key, typeof value === "string" ? value : JSON.stringify(value));
                }
            });
        }

        const headers = new Headers(requestOptions.headers);
        if (!headers.has("Content-Type") && requestOptions.body) {
            headers.set("Content-Type", "application/json");
        }

        if (this.options.username || this.options.password) {
            const auth = btoa(`${this.options.username || ""}:${this.options.password || ""}`);
            headers.set("Authorization", `Basic ${auth}`);
        }

        return fetch(fullUrl.toString(), {
            method: requestOptions.method,
            headers,
            body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
        });
    }

    /**
     * Checks that the response is okay. If not, a DavenPort error is thrown.
     */
    private async checkErrorAndGetBody(result: Response) {
        if (!isOkay(result)) {
            const body = await result.text();
            const message = `Error with ${result.status} request for CouchDB database ${this.databaseName} at ${result.url}. ${result.status} ${result.statusText}`;

            throw new DavenportError(message, result, body);
        }

        return result.json();
    };

    /**
     * Find matching documents according to the selector.
     */
    public async find(options: FindOptions<T>): Promise<T[]> {
        const result = await this.request(`${this.databaseUrl}_find`, {
            method: "POST",
            body: options,
        });

        const body = await this.checkErrorAndGetBody(result);

        if (body.warning && !!this.getOption("warnings")) {
            warn(this.options, "Davenport warning: Davenport.find result contained warning:", body.warning);
        }

        return body.docs;
    }

    /**
     * Lists documents in the database. Warning: this result WILL list design documents, and it will force the `include_docs` option to false. If you need to include docs, use .listWithDocs.
     */
    public async listWithoutDocs(options: ListOptions = {}): Promise<ListResponse<{ rev: string }>> {
        const result = await this.request(`${this.databaseUrl}_all_docs`, {
            method: "GET",
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
        const result = await this.request(`${this.databaseUrl}_all_docs`, {
            method: "GET",
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
        const result = await this.request(`${this.databaseUrl}_all_docs`, {
            method: "GET",
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
    public async countBySelector(selector: any): Promise<number> {
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
        const result = await this.request(this.databaseUrl + id, {
            method: "GET",
            params: { rev }
        });
        const body = await this.checkErrorAndGetBody(result);

        return body;
    }

    /**
     * Inserts, updates or deletes multiple documents at the same time. 
     * 
     * Omitting the `_id` property from a document will cause CouchDB to generate the id itself.
     * 
     * When updating a document, the `_rev` property is required.
     * 
     * To delete a document, set the `_deleted` property to `true`. 
     * 
     * Note that CouchDB will return in the response an id and revision for every document passed as content to a bulk insert, even for those that were just deleted.  
     * 
     * If the `_rev` does not match the current version of the document, then that particular document will not be saved and will be reported as a conflict, but this does not prevent other documents in the batch from being saved. 
     * 
     * If the `newEdits` arg is `false` (to push existing revisions instead of creating new ones) the response will not include entries for any of the successful revisions (since their rev IDs are already known to the sender), only for the ones that had errors. Also, the `"conflict"` error will never appear, since in this mode conflicts are allowed. 
     * 
     * @param docs An array of documents that will be inserted, updated or deleted.
     * @param newEdits A boolean that determines whether to allow new edits or not. 
     */
    public async bulk(docs: T[], newEdits = true): Promise<BulkResponse> {
        const result = await this.request(this.databaseUrl + "_bulk_docs", {
            method: "POST",
            body: { docs },
            params: { new_edits: newEdits }
        })
        const body = await this.checkErrorAndGetBody(result);

        return body;
    }

    /**
     * Creates a document with a random id. By CouchDB convention, this will only return the id and revision id of the new document, not the document itself.
     */
    public async post(data: T): Promise<PostPutCopyResponse> {
        const result = await this.request(this.databaseUrl, {
            method: "POST",
            body: data,
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
        if (!rev && !!this.getOption("warnings")) {
            warn(this.options, `Davenport warning: no revision specified for Davenport.put function with id ${id}. This may cause a document conflict error.`);
        }

        const result = await this.request(this.databaseUrl + id, {
            method: "PUT",
            body: data,
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
        const result = await this.request(this.databaseUrl + id, {
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
            warn(this.options, `Davenport warning: no revision specified for Davenport.delete function with id ${id}. This may cause a document conflict error.`);
        }

        const result = await this.request(this.databaseUrl + id, {
            method: "DELETE",
            params: { rev }
        });

        await this.checkErrorAndGetBody(result);
    }

    /**
     * Checks that a document with the given id exists.
     */
    public async exists(id: string): Promise<boolean> {
        const result = await this.request(this.databaseUrl + id, { method: "HEAD" });

        return result.status === 200;
    }

    /**
     * Checks that a document that matches the field value exists.
     */
    public async existsByFieldValue(value: any, field: keyof T): Promise<boolean> {
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
     * Executes a view with the given designDocName and viewName. Will not reduce by default, pass in the { reduce: true } option to reduce.
     */
    public async view<DocType>(designDocName: string, viewName: string, options: ViewOptions = { reduce: false }): Promise<ViewResult<DocType>> {
        // Ensure reduce is set to false unless explicitly set by the caller.
        const viewOptions = { ...options };
        if (typeof (viewOptions.reduce) !== "boolean") {
            viewOptions.reduce = false;
        }

        const result = await this.request(`${this.databaseUrl}_design/${designDocName}/_view/${viewName}`, {
            method: "GET",
            params: this.encodeOptions(viewOptions),
        });
        const body = await this.checkErrorAndGetBody(result);

        return body;
    }

    /**
     * Executes a view with the given designDocName and viewName. This method will never reduce the result.
     */
    public async viewWithDocs<DocType>(designDocName: string, viewName: string, options: ViewOptions = { reduce: false }): Promise<ViewResultWithDocs<DocType>> {
        const result = await this.request(`${this.databaseUrl}_design/${designDocName}/_view/${viewName}`, {
            method: "GET",
            params: { ...this.encodeOptions(options), reduce: false, include_docs: true }
        });
        const body = await this.checkErrorAndGetBody(result);

        return body;
    }

    /**
     * Creates the database associated with this client.
     */
    public async createDb(url: string = this.databaseUrl): Promise<CreateDatabaseResponse> {
        const result = await this.request(url, { method: "PUT" });

        if (result.status === 412) {
            return {
                ok: true,
                alreadyExisted: true
            }
        }

        const body: BasicCouchResponse = await this.checkErrorAndGetBody(result);

        return {
            ...body,
            alreadyExisted: false
        }
    }

    /**
     * Deletes the database associated with this client.
     */
    public async deleteDb(url: string = this.databaseUrl): Promise<BasicCouchResponse> {
        const result = await this.request(url, { method: "DELETE" });

        return await this.checkErrorAndGetBody(result);
    }

    /**
     * Returns database info for the given database.
     */
    public async getDbInfo(url: string = this.databaseUrl): Promise<DbInfo> {
        const result = await this.request(url, { method: "GET" });

        return await this.checkErrorAndGetBody(result);
    }

    private encodeOptions(options: ListOptions): object {
        let keys = Object.getOwnPropertyNames(options || {}) as (keyof ListOptions)[];

        return keys.reduce((requestOptions: any, key) => {
            switch (key) {
                case "keys":
                case "key":
                case "start_key":
                case "end_key":
                    requestOptions[key] = JSON.stringify((options as any)[key]);

                    break;

                default:
                    requestOptions[key] = (options as any)[key];

                    break;
            }

            return requestOptions;
        }, {});
    }
}

export default Client;

export class DavenportError extends Error {
    constructor(message: string, public fullResponse: Response, public body: any) {
        super(message);

        this.status = fullResponse.status;
        this.statusText = fullResponse.statusText;
        this.url = fullResponse.url;
    }

    public readonly isDavenport = true;

    public status: number;

    public statusText: string;

    public url: string;
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

export interface BulkDocumentError {
    id: string;
    error: "conflict" | "forbidden" | "unauthorized";
    reason: string | "Document update conflict.";
}

export type BulkResponse = (PostPutCopyResponse | BulkDocumentError)[]

export interface ViewOptions extends ListOptions {
    reduce?: boolean;
    group?: boolean;
    group_level?: number;
}

export interface ViewResult<DocType> {
    offset?: number;
    total_rows?: number;
    rows: ViewRow<DocType>[];
}

export interface ViewRow<DocType> {
    id?: string;
    key?: any;
    value: DocType;
}

export interface ViewRowWithDoc<DocType> extends ViewRow<DocType> {
    doc: DocType;
}

export interface ViewResultWithDocs<DocType> {
    offset?: number;
    total_rows?: number;
    rows: ViewRowWithDoc<DocType>[];
}

export type Key = string | number | Object;

/**
 * Options for listing database results.
 */
export interface ListOptions {
    limit?: number;
    key?: Key;
    keys?: Key[];
    start_key?: Key | Key[];
    end_key?: Key | Key[];
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

export interface DbSizes {
    file: number;
    external: number;
    active: number
};

export interface DbOther {
    data_size?: number;
}

export interface DbInfo {
    db_name: string;
    update_seq: string;
    sizes: DbSizes;
    purge_seq: number;
    other?: DbOther;
    doc_del_count: number;
    doc_count: number;
    disk_size: number;
    disk_format_version: number;
    data_size: number;
    compact_running: boolean;
    instance_start_time: number;
}

export interface BasicCouchResponse {
    ok: boolean;
}

export interface CreateDatabaseResponse extends BasicCouchResponse {
    /**
     * Whether the database already existed when trying to create it. Determined by CouchDB returning a 412 Precondition Failed response.
     */
    alreadyExisted: boolean;
}

interface CouchResponse extends BasicCouchResponse {
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
    warnings?: boolean;

    /**
     * Custom logger interface.
     */
    logger?: Logger;

    /**
     * Username used to make requests with basic auth.
     */
    username?: string;

    /**
     * Password used to make requests with basic auth. 
     */
    password?: string;

    /**
     * Proxy configuration object.
     */
    proxy?: any;
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