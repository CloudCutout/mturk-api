////////////////////////////////////////////////////
//                   Imports
////////////////////////////////////////////////////
var PromiseThrottle = require('promise-throttle');
var parseXML = require('xml2js').parseString;
var querystring = require('querystring');
var CryptoJS = require('crypto-js');
var Promise = require('promise');
const https = require('https');

var PRODUCTION = 'mechanicalturk.amazonaws.com';
var SANDBOX = 'mechanicalturk.sandbox.amazonaws.com';
var SERVICE = 'AWSMechanicalTurkRequester';
var VERSION = '2014-08-15';
var METHOD = 'POST';

var specialResponses = {};
specialResponses['CreateQualificationType'] = 'QualificationType';
specialResponses['CreateHIT'] = 'HIT';
specialResponses['GetHIT'] = 'HIT';

var promiseThrottle = new PromiseThrottle({
    requestsPerSecond: 3,           // up to 1 request per second
    promiseImplementation: Promise  // the Promise library you are using
});



function MTurkAPI() {

    var api = this;

    api.createClient = function(options) {

        var client = {};
        // add some items to the queue
        client.req = function (operation, params) {
            return new Promise(function(resolve, reject){
                promiseThrottle.add(throttledRequest.bind(this, client, options, operation, params))
                .then(resolve)
                .catch(reject);
            })
        };

        client.isValidResponse = function(response){
            var result = {};
            result.errorType =  [];
            result.errorMessage = null;
            result.isValid = null;

            var responseKey = Object.keys(response)[0];
            var charIndex = responseKey.indexOf("Response");
            var operationName = responseKey.slice(0, charIndex)

            //Check for operation request errors
            var responseProperty = operationName + 'Response';
            var hasResponse = response.hasOwnProperty(responseProperty);
            var responseGroup = hasResponse? response[operationName + 'Response'] : null;
            var operationRequest = responseGroup? responseGroup.OperationRequest[0] : null;
            var operationErrors = operationRequest? operationRequest.hasOwnProperty('Errors') : null;
            var operationError = operationErrors? true : false;
            var error = operationError? operationRequest.Errors[0].Error[0]: null;
            var errCode = error? error.Code[0] : '';
            var errMsg = error? error.Message[0] : '';
            var errKey = error && error.hasOwnProperty('Data')? error.Data[0].Key : '';
            var errVal = error && error.hasOwnProperty('Data')? error.Data[0].Value : '';
            var errData = errKey && errVal? errKey +': '+errVal : '';
            result.errorMessage = error? errCode +' - '+ errMsg + ' - '+ errData: '';
            result.isValid = error? false : true;
            if(error){return result}


            //Check for result errors
            var specialCase = specialResponses.hasOwnProperty(operationName);
            var resultProperty = specialCase ? specialResponses[operationName] : operationName + 'Result';
            var hasResult = responseGroup.hasOwnProperty(resultProperty);
            var requestResult = hasResult? responseGroup[resultProperty][0].Request[0] : null;
            var hasValidity = requestResult? requestResult.hasOwnProperty('IsValid'): null;
            var validResult = hasValidity? requestResult.IsValid[0] === 'True': false;
            var resultError = hasResult && !validResult;
            var error = resultError? requestResult.Errors[0].Error[0]: null;
            var errCode = error? error.Code[0] : '';
            var errMsg = error? error.Message[0] : '';
            var errKey = error && error.hasOwnProperty('Data')? error.Data[0].Key : '';
            var errVal = error && error.hasOwnProperty('Data')? error.Data[0].Value : '';
            var errData = errKey && errVal? errKey +': '+errVal : '';
            result.errorMessage = error? errCode +' - '+ errMsg + ' - '+ errData : '';
            result.isValid = error? false : true;
            return result;
        }

        return client;
    }

    return api;
}



function throttledRequest(client, options, operation, params){
    var params = params || {};
    params.RequestGroup = params.RequestGroup || 'Request, Minimal';
    params.Operation = operation;
    params.Version = VERSION;

    return new Promise(function(resolve, reject){
        var signedRequest = signRequest(options, params);
        signedRequest = querystring.stringify(signedRequest);
        var payloadSize = Buffer.byteLength(signedRequest);

        var reqOptions = {};
        reqOptions.host = options.sandbox? SANDBOX : PRODUCTION;
        reqOptions.method= METHOD;
        reqOptions.headers = {};
        reqOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        reqOptions.headers['Content-Length'] = payloadSize;

        var req = https.request(reqOptions, function(res) {

            if(res.statusCode !== 200){
                var error = new Error(res.statusCode +' - '+ res.statusMessage)
                reject(error);
            }

            var xmlBuffer = new Buffer([]);
            res.on('data', function(chunk) {
                xmlBuffer = Buffer.concat([xmlBuffer, chunk]);
            })

            res.on('end', function(){
                var xmlString = xmlBuffer.toString('utf-8');
                convertXMLToJSON(xmlString).then(function(JSONResponse){
                    var test = client.isValidResponse(JSONResponse);
                    test.isValid? resolve(JSONResponse) : reject(new Error(test.errorMessage))
                }).catch(reject);
            })

            res.on('error', reject)
        });

        req.write(signedRequest);
        req.end();
    })
};


function convertXMLToJSON(xml){
    return new Promise(function(resolve, reject){
        parseXML(xml, function (err, response) {
            err? reject(err) : resolve(response);
        });
    })
};

function signRequest(credentials, params){
    params.AWSAccessKeyId=  credentials.access;
    params.Timestamp = new Date().toISOString();
    var hmac = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA1, credentials.secret);
    hmac.update(SERVICE + params.Operation + params.Timestamp);
    params.Signature = hmac.finalize().toString(CryptoJS.enc.Base64);
    return params;
}

//EXPORT
module.exports = new MTurkAPI();
