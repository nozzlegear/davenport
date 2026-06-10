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
  error: 'conflict' | 'forbidden' | 'unauthorized';
  reason: string | 'Document update conflict.';
}

export type BulkResponse = (PostPutCopyResponse | BulkDocumentError)[];

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

export type Key = string | number | object;

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
    id: string;
    key: string;
    value: {
      rev: string;
    };
    doc: T;
  }[];
  offset: number;
  total_rows: number;
}

export interface DbSizes {
  file: number;
  external: number;
  active: number;
}

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

export interface CouchResponse extends BasicCouchResponse {
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
  sort?: object[];
  limit?: number;
  skip?: number;
  use_index?: object;
  selector: Partial<T> | DocSelector<T>;
}

export interface CouchDBView {
  map: string;
  reduce?: string;
}

export interface DesignDoc extends CouchDoc {
  views: { [name: string]: CouchDBView };
  language: 'javascript';
}

export interface DesignDocConfiguration {
  name: string;
  views: ({ name: string } & CouchDBView)[];
}

export interface DatabaseConfiguration<T> {
  name: string;
  indexes?: (keyof T)[];
  designDocs?: DesignDocConfiguration[];
}

export interface Logger {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
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
