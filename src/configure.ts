import { CouchDoc, DatabaseConfiguration, ClientOptions, DesignDoc } from './types.js';
import { Client } from './client.ts';
import { isOkay, warn } from './utils.ts';
import { DavenportError } from './error.ts';

/**
 * Configures a Davenport client and database by validating the CouchDB version, creating indexes and design documents, and then returning a client to interact with the database.
 */
export async function configureDatabase<DocType extends CouchDoc>(
  databaseUrl: string,
  configuration: DatabaseConfiguration<DocType>,
  options?: ClientOptions,
): Promise<Client<DocType>> {
  const client = new Client<DocType>(databaseUrl, configuration.name, options);
  const dbInfoResponse = await client.request(databaseUrl, { method: 'GET' });

  if (!isOkay(dbInfoResponse)) {
    throw new Error(
      `Failed to connect to CouchDB instance at ${databaseUrl}. ${dbInfoResponse.status} ${dbInfoResponse.statusText}`,
    );
  }

  const infoBody = (await dbInfoResponse.json()) as { version: string };
  const version = parseInt(infoBody.version);

  if (version < 2) {
    warn(
      options,
      `Warning: Davenport expects your CouchDB instance to be running CouchDB 2.0 or higher. Version detected: ${version}. Some database methods may not work.`,
    );
  }

  const putResult = await client.request(`${databaseUrl}/${configuration.name}`, { method: 'PUT' });
  const preconditionFailed = 412; /* Precondition Failed - Database already exists. */

  if (putResult.status !== preconditionFailed && !isOkay(putResult)) {
    const body = await putResult.text();
    throw new DavenportError(`${putResult.status} ${putResult.statusText} ${body}`, putResult, body);
  }

  if (Array.isArray(configuration.indexes) && configuration.indexes.length > 0) {
    const data = {
      index: {
        fields: configuration.indexes,
      },
      name: `${configuration.name}-indexes`,
    };
    const result = await client.request(`${databaseUrl}/${configuration.name}/_index`, {
      method: 'POST',
      body: data,
    });

    if (!isOkay(result)) {
      const body = await result.text();
      throw new DavenportError(`Error creating CouchDB indexes on database ${configuration.name}.`, result, body);
    }
  }

  if (Array.isArray(configuration.designDocs) && configuration.designDocs.length > 0) {
    await Promise.all(
      configuration.designDocs.map(async (designDoc) => {
        const url = `${databaseUrl}/${configuration.name}/_design/${designDoc.name}`;
        const getDocResponse = await client.request(url, { method: 'GET' });
        const okay = isOkay(getDocResponse);
        let docFromDatabase: DesignDoc;

        if (!okay && getDocResponse.status !== 404) {
          const body = await getDocResponse.text();
          warn(
            options,
            `Davenport: Failed to retrieve design doc "${designDoc.name}". ${getDocResponse.status} ${getDocResponse.statusText}`,
            body,
          );
          return;
        }

        if (!okay) {
          docFromDatabase = {
            _id: `_design/${designDoc.name}`,
            _rev: undefined,
            language: 'javascript',
            views: {},
          };
        } else {
          docFromDatabase = await getDocResponse.json();
        }

        const docViews = designDoc.views;
        let shouldUpdate = false;

        docViews.forEach((view) => {
          if (
            !docFromDatabase.views ||
            !docFromDatabase.views[view.name] ||
            docFromDatabase.views[view.name].map !== view.map ||
            docFromDatabase.views[view.name].reduce !== view.reduce
          ) {
            docFromDatabase.views = Object.assign({}, docFromDatabase.views, {
              [view.name]: {
                map: view.map,
                reduce: view.reduce,
              },
            });

            shouldUpdate = true;
          }
        });

        if (shouldUpdate) {
          warn(
            options,
            `Davenport: Creating or updating design doc "${designDoc.name}" for database "${configuration.name}".`,
          );

          const result = await client.request(url, {
            method: 'PUT',
            body: docFromDatabase,
          });

          if (!isOkay(result)) {
            const body = await result.text();
            warn(
              options,
              `Davenport: Could not create or update CouchDB design doc "${designDoc.name}" for database "${configuration.name}". ${result.status} ${result.statusText}`,
              body,
            );
          }
        }
      }),
    );
  }

  return client;
}
