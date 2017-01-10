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

export function isDavenportError(error): error is DavenportError {
    return error.isDavenport;
}

export const GENERIC_LIST_VIEW = {
    "name": "all",
    "map": function (doc) { emit(doc._id, doc); }.toString(),
    "reduce": "_count"
}

export default async function configureClient<T extends CouchDoc>(databaseUrl: string, configuration: DatabaseConfiguration): Promise<Client<T>> {
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
        configuration.designDocs.forEach(async designDoc => {
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
        })
    };

    return new Client<T>(databaseUrl, configuration.name);
}

export class Client<T extends CouchDoc> {
    constructor(private baseUrl: string, private databaseName: string) {
        this.databaseUrl = `${baseUrl}/${databaseName}/`;
    }

    private databaseUrl: string;

    private async checkErrorAndGetBody(result: AxiosResponse) {
        if (!isOkay(result)) {
            const message = `Error with ${result.config.method} request for CouchDB database ${this.databaseName} at ${result.config.url}. ${result.status} ${result.statusText}`;

            if (result.status !== 404) {
                inspect(message, result.data);
            }

            throw new DavenportError(message, result);
        }

        return result.data;
    };

    public async find(options: FindOptions<T>): Promise<T[]> {
        const result = await Axios.post(`${this.databaseUrl}/_find`, options, {
            headers: {
                "Content-Type": "application/json"
            },
        });

        const body = await this.checkErrorAndGetBody(result);

        if (body.warning) {
            inspect("Davenport warning: Davenport.find result contained warning:", body.warning);
        }

        return body.docs;
    }

    public async list(options: ListOptions = {}): Promise<ListResponse<T>> {
        const result = await Axios.get(`${this.databaseUrl}/_all_docs`, {
            params: options
        });
        const body = await this.checkErrorAndGetBody(result) as AllDocsListResult<T>;

        return {
            offset: body.offset,
            total_rows: body.total_rows,
            rows: body.rows.map(r => r.doc)
        }
    }

    public async count(): Promise<number> {
        const result = await Axios.get(`${this.databaseUrl}/_all_docs`, {
            params: {
                limit: 0,
            }
        });
        const body = await this.checkErrorAndGetBody(result) as AllDocsListResult<T>;

        return body.total_rows;
    }

    public async countBySelector(selector: Partial<T>): Promise<number> {
        const result = await this.find({
            fields: ["_id"],
            selector,
        })

        return result.length;
    }

    public async get(id: string, rev?: string): Promise<T> {
        const result = await Axios.get(this.databaseUrl + id, {
            params: { rev }
        });
        const body = await this.checkErrorAndGetBody(result);

        return body;
    }

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

    public async put(id: string, data: T, rev: string): Promise<PostPutCopyResponse> {
        if (!rev) {
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

    public async delete(id: string, rev: string): Promise<void> {
        if (!rev) {
            inspect(`Davenport warning: no revision specified for Davenport.delete function with id ${id}. This may cause a document conflict error.`);
        }

        const result = await Axios.delete(this.databaseUrl + id, {
            params: { rev }
        });

        await this.checkErrorAndGetBody(result);
    }

    public async exists(id: string, field: keyof T): Promise<boolean> {
        if (!field || field === "_id") {
            const result = await Axios.head(this.databaseUrl + id);

            return result.status === 200;
        }

        const findResult = await this.find({
            fields: ["_id"],
            limit: 1,
            selector: {
                [field]: id
            } as any
        });

        return findResult.length > 0;
    }

    public async view<R>(designDocName: string, viewName: string, options: ViewOptions = {}): Promise<{rows: R[]}> {
        const result = await Axios.get(`${this.databaseUrl}_design/${designDocName}/_view/${viewName}`, {
            params: options,
        });
        const body = await this.checkErrorAndGetBody(result);

        return body;
    }
}

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
    selector: Partial<T>;
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
    views: ({name: string} & CouchDBView)[]
}

export interface DatabaseConfiguration {
    name: string,
    indexes?: string[],
    designDocs?: DesignDocConfiguration[],
}