import * as Remote from '../types/remote';

/**
 * Model of the HTTP Request I/O monad.
 * @param {Object} input Expected to be a map of configuration values.
 * @returns {Promise} Promise which resolves on completion.
 */
export default function HTTP_REQUEST (input = {}) {
  const MAX_TIME_MS = 250;
  const request = this;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject('Timeout!');
    }, MAX_TIME_MS);

    const remote = new Remote({
      authority: `${request.host}:${request.port}`
    });

    const options = await remote._OPTIONS('/');
    const result = await remote._GET(request.path);

    clearTimeout(timer);

    resolve({
      request, options, result
    });
  });

  return promise;
}
