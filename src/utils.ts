import { ClientOptions } from './types.js';

/**
 * Indicates whether the request was a success or not (between 200-300).
 */
export function isOkay(response: Response) {
  return response.status >= 200 && response.status < 300;
}

/**
 * Logs a warning if warnings are enabled.
 */
export function warn(options: ClientOptions | undefined, ...args: any[]) {
  if (options && options.warnings !== false) {
    (options.logger?.warn || console.warn)(...args);
  }
}
