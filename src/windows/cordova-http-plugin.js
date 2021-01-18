/*
* mobileX fork: Copied from browser platform and modified to use WinJS HttpClient
*/

// @ts-check
/// <reference types="../../winrt-uwp" />

// @ts-ignore
var cordovaProxy = require('cordova/exec/proxy');
// @ts-ignore
var jsUtil = require('./js-util');

/** @type {{ [reqId: number]: Windows.Foundation.IPromiseWithIAsyncOperationWithProgress<Windows.Web.Http.HttpResponseMessage, Windows.Web.Http.HttpProgress> }} */
var reqMap = {};

/**
 * @typedef {{ [name: string]: string }} HeaderMap
 */

/**
 * @param {any} data
 * @returns {string}
 */
function serializeJsonData(data) {
  try {
    return JSON.stringify(data);
  } catch (err) {
    return null;
  }
}

/**
 * @param {string} key
 * @param {any} value
 * @returns {string}
 */
function serializePrimitive(key, value) {
  if (value === null || value === undefined) {
    return encodeURIComponent(key) + '=';
  }

  return encodeURIComponent(key) + '=' + encodeURIComponent(value);
}

/**
 * @param {string} key
 * @param {any} values
 * @returns {string}
 */
function serializeArray(key, values) {
  return values.map(function (value) {
    return encodeURIComponent(key) + '[]=' + encodeURIComponent(value);
  }).join('&');
}

/**
 * @param {any} params
 * @return {string}
 */
function serializeParams(params) {
  if (params === null) return '';

  return Object.keys(params).map(function (key) {
    if (jsUtil.getTypeOf(params[key]) === 'Array') {
      return serializeArray(key, params[key]);
    }

    return serializePrimitive(key, params[key]);
  }).join('&');
}

/**
 * @param {any} data
 * @return {Windows.Web.Http.HttpMultipartFormDataContent}
 */
function processMultipartData(data) {
  if (!data) return null;

  var fd = new Windows.Web.Http.HttpMultipartFormDataContent();

  for (var i = 0; i < data.buffers.length; ++i) {
    var buffer = data.buffers[i];
    var name = data.names[i];
    var fileName = data.fileNames[i];
    var type = data.types[i];

    fd.add(new Windows.Web.Http.HttpStringContent(atob(buffer)), name);
  }

  return fd;
}

/**
 * @param {number} reqId
 * @param {Function} cb
 */
function injectRequestIdHandler(reqId, cb) {
  return function (response) {
    delete reqMap[reqId];
    cb(response);
  }
}

/**
 * @param {Windows.Web.Http.HttpRequestMessage} request
 * @param {HeaderMap} headers
 */
function setHeaders(request, headers) {
  Object.keys(headers).forEach(function (key) {
    // Content-Type is set through the API's content object
    if (key.toLowerCase() === 'content-type') return;
    try {
      request.headers.append(key, headers[key]);
    } catch(error) {
      console.error('Error setting header', error);
    }
  });
}

/**
 * @param {string} method
 * @param {boolean} withData
 * @param {any[]} opts
 * @param {Function} success
 * @param {Function} failure
 */
async function sendRequest(method, withData, opts, success, failure) {
  var data;
  /** @type {string} */
  var serializer;
  /** @type {HeaderMap} */
  var headers;
  /** @type {number} */
  var timeout;
  /** @type {boolean} */
  var followRedirect;
  /** @type {string} */
  var responseType;
  /** @type {number} */
  var reqId;
  /** @type {string} */
  var url = opts[0];

  if (withData) {
    data = opts[1];
    serializer = opts[2];
    headers = opts[3];
    timeout = opts[4];
    followRedirect = opts[5];
    responseType = opts[6];
    reqId = opts[7];
  } else {
    headers = opts[1];
    timeout = opts[2];
    followRedirect = opts[3];
    responseType = opts[4];
    reqId = opts[5];
  }

  var onSuccess = injectRequestIdHandler(reqId, success);
  var onFail = injectRequestIdHandler(reqId, failure);

  const httpClient = new Windows.Web.Http.HttpClient();
  const request = new Windows.Web.Http.HttpRequestMessage(
    Windows.Web.Http.HttpMethod[method],
    new Windows.Foundation.Uri(url)
  )

  switch (serializer) {
    case 'json':
      const processedData = serializeJsonData(data)

      if (processedData === null) {
        return onFail('advanced-http: failed serializing data');
      }

      request.content = new Windows.Web.Http.HttpStringContent(processedData);
      request.content.headers.contentType.mediaType = 'application/json'
      request.content.headers.contentType.charSet = 'utf8';
      break;

    case 'utf8':
      request.content = new Windows.Web.Http.HttpStringContent(data.text);
      request.content.headers.contentType.mediaType = 'text/plain';
      request.content.headers.contentType.charSet = 'utf8';
      break;

    case 'urlencoded':
      request.content = new Windows.Web.Http.HttpStringContent(serializeParams(data));
      request.content.headers.contentType.mediaType = 'application/x-www-form-urlencoded';
      break;

    case 'multipart':
      request.content = processMultipartData(data);
      break;

    case 'raw':
      request.content = new Windows.Web.Http.HttpStringContent(data);
      request.content.headers.contentType.mediaType = 'application/octet-stream'
      break;
  }

  setHeaders(request, headers);

  const responsePromise = httpClient.sendRequestAsync(request)
  reqMap[reqId] = responsePromise;

  try {
    const response = await responsePromise;
    response.ensureSuccessStatusCode();
    const responseHeaders = JSON.parse(JSON.stringify(response.headers));
    const responseContent = await response.content.readAsStringAsync();
    onSuccess({
      url: (response.headers.location && response.headers.location.absoluteUri)
        || url,
      status: response.statusCode,
      data: responseContent,
      headers: responseHeaders,
    });
  } catch (error) {
    onFail({
      error: error.message || 'advanced-http: please check console for error messages'
    });
  }
}

/**
 *
 * @param {[reqId: number]} opts
 * @param {Function} success
 * @param {Function} failure
 */
function abort(opts, success, failure) {
  var reqId = opts[0];
  var result = false;

  var response = reqMap[reqId];
  if(response){
    try {
      response.cancel();
      result = true;
    } catch (error) {
      // do nothing
    }
  }

  success({aborted: result});
}

var windowsInterface = {
  get: function (success, failure, opts) {
    return sendRequest('get', false, opts, success, failure);
  },
  head: function (success, failure, opts) {
    return sendRequest('head', false, opts, success, failure);
  },
  delete: function (success, failure, opts) {
    return sendRequest('delete', false, opts, success, failure);
  },
  post: function (success, failure, opts) {
    return sendRequest('post', true, opts, success, failure);
  },
  put: function (success, failure, opts) {
    return sendRequest('put', true, opts, success, failure);
  },
  patch: function (success, failure, opts) {
    return sendRequest('patch', true, opts, success, failure);
  },
  abort: function (success, failure, opts) {
    return abort(opts, success, failure);
  },
  uploadFile: function (success, failure, opts) {
    return failure('advanced-http: function "uploadFile" not supported on windows platform');
  },
  uploadFiles: function (success, failure, opts) {
    return failure('advanced-http: function "uploadFiles" not supported on windows platform');
  },
  downloadFile: function (success, failure, opts) {
    return failure('advanced-http: function "downloadFile" not supported on windows platform');
  },
  setServerTrustMode: function (success, failure, opts) {
    return failure('advanced-http: function "setServerTrustMode" not supported on windows platform');
  },
  setClientAuthMode: function (success, failure, opts) {
    return failure('advanced-http: function "setClientAuthMode" not supported on windows platform');
  }
};

module.exports = windowsInterface;
cordovaProxy.add('CordovaHttpPlugin', windowsInterface);
