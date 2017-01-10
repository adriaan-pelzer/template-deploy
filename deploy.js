#!/usr/bin/env node

var H = require ( 'highland' );
var R = require ( 'ramda' );
var P = require ( 'path' );
var F = require ( 'fs' );
var rr = require ( 'recursive-readdir' );
var G = require ( 'glob' );
var Q = require ( 'request' );
var I = require ( 'inspect-log' );
var c = require ( 'crypto' );

var errorIf = function ( pred, error ) {
    return H.wrapCallback ( function ( input, callBack ) {
        if ( pred ( input ) ) {
            return callBack ( error );
        }

        return callBack ( null, input );
    } );
};

var usage = function ( msg ) {
    console.log ( msg );
    console.log ( 'Usage: template-deploy <environment>' );
    process.exit ( 1 );
};

var B = {
    compile: R.curry ( function ( template, data ) {
        return R.reduce ( function ( template, keyValuePair ) {
            var key = keyValuePair[0], value = keyValuePair[1], re = new RegExp ( '{{' + key + '}}', 'g' );

            if ( R.type ( value ) !== 'String' && R.type ( value ) !== 'Number' ) {
                return template;
            }

            return R.replace ( re, value, template );
        }, template, R.toPairs ( data ) );
    } )
};

var cwd = './';

if ( process.argv.length < 3 ) {
    usage ( 'too few arguments' );
}

H ( [ P.resolve ( P.join ( cwd, 'templateConf.js' ) ) ] )
    .flatMap ( function ( configFile ) {
        return H.wrapCallback ( function ( configFile, callBack ) {
            F.exists ( configFile, function ( exists ) {
                if ( exists ) {
                    return callBack ( null, exists );
                }
                
                return callBack ( exists );
            } );
        } )( configFile )
            .flatMap ( errorIf ( R.isNil, "Config file does not exist" ) )
            .map ( R.always ( configFile ) );
    } )
    .map ( require )
    .map ( R.prop ( process.argv[2] ) )
    .flatMap ( function ( config ) {
        return H ( [ P.resolve ( process.argv[3] || cwd ) ] )
            .flatMap ( H.wrapCallback ( function ( path, callBack ) {
                rr ( path, config.Omit || [], callBack );
            } ) )
            .sequence ()
            .flatFilter ( function ( filename ) {
                return H ( config.Omit )
                    .flatMap ( H.wrapCallback ( G ) )
                    .collect ()
                    .map ( R.flatten )
                    .map ( R.map ( P.resolve ) )
                    .map ( R.contains ( filename ) )
                    .map ( R.not );
            } )
            .filter ( function ( filename ) {
                return filename.match ( /\.hbs$/ ) && filename.match ( '/private-assets/' ) && filename.match ( '/templates/' );
            } )
            .flatMap ( function ( filename ) {
                var pathComponents = R.reject ( R.equals ( '' ), R.split ( P.sep, R.replace ( P.resolve ( cwd ), '', filename ) ) );
                var hasSubcontext = R.type ( pathComponents[3].match ( ':' ) ) === 'Array';
                var context = R.head ( pathComponents[3].split ( ':' ) );
                var subcontext = hasSubcontext && R.head ( R.tail ( pathComponents[3].split ( ':' ) ) );

                return H ( [ {
                    type: pathComponents[0],
                    version: R.init ( R.split ( '.', pathComponents[4] ) ).join ( '.' ),
                    context: context,
                    subcontext: subcontext,
                    filename: filename
                } ] )
                    .flatMap ( function ( parms ) {
                        var parmsList = R.concat ( [ 'type', 'version', 'context' ], parms.subcontext ? [ 'subcontext' ] : [] );
                        var templateParms = R.pick ( parmsList );
                        var apiUrl = ( R.isEmpty ( R.match ( /^http/, config.apiUrl ) ) ? 'http:' : '' ) + config.apiUrl;

                        return H.wrapCallback ( Q )( {
                            url: [ apiUrl, 'templates' ].join ( '/' ),
                            qs: templateParms ( parms ),
                            json: true
                        } )
                            .flatMap ( H.wrapCallback ( ( response, callback ) => {
                                if ( response.statusCode !== 200 ) {
                                    return callback ( 'HTTP code ' + response.statusCode + ' returned: ' + JSON.stringify ( response.body ) );
                                }

                                return callback ( null, response.body );
                            } ) )
                            .reject ( R.isEmpty )
                            .map ( R.head )
                            .map ( function ( template ) {
                                return {
                                    url: apiUrl + '/templates/' + template.id,
                                    method: 'put',
                                    json: templateParms ( parms )
                                };
                            } )
                            .otherwise ( H ( [ {
                                url: apiUrl + '/templates',
                                method: 'post',
                                json: templateParms ( parms )
                            } ] ) )
                            .flatMap ( function ( queryParms ) {
                                return H.wrapCallback ( F.readFile )( parms.filename )
                                    .invoke ( 'toString', [ 'utf8' ] )
                                    .map ( function ( template ) {
                                        var templateCompiled, data, stringToSign, sig, s = c.createHash ( 'sha256' );

                                        if ( config.data ) {
                                            try {
                                                templateCompiled = B.compile ( template.toString ( 'utf8' ) )( config.data );
                                            } catch ( error ) {
                                                templateCompiled = template;
                                            }
                                        } else {
                                            templateCompiled = template;
                                        }

                                        data = JSON.stringify ( R.merge ( queryParms.json, {
                                            template: templateCompiled
                                        } ) );

                                        stringToSign = [
                                            config.google.client_secret,
                                            config.google.client_id,
                                            '/' + R.slice ( 3, Infinity, R.split ( '/', queryParms.url ) ).join ( '/' ),
                                            R.toUpper ( queryParms.method ),
                                            data
                                        ].join ( '' );

                                        s.update ( new Buffer ( stringToSign ) );
                                         
                                        return R.merge ( R.omit ( [ 'url', 'json' ], queryParms ), {
                                            url: queryParms.url + '?sig=' + s.digest ( 'hex' ),
                                            json: R.merge ( queryParms.json, {
                                                template: templateCompiled
                                            } )
                                        } );
                                    } );
                            } )
                            .flatMap ( H.wrapCallback ( Q ) );
                    } )
                    .flatMap ( H.wrapCallback ( function ( result, callBack ) {
                        if ( result.statusCode === 201 || result.statusCode === 200 ) {
                            return callBack ( null, filename + ' deployed successfully' );
                        }

                        return callBack ( filename + ' could not be deployed' );
                    } ) );
            } );

    } )
    .errors ( R.compose ( R.unary ( console.error ), R.add ( 'ERROR: ' ) ) )
    .each ( console.log );
