#!/usr/bin/env node

var H = require ( 'highland' );
var R = require ( 'ramda' );
var P = require ( 'path' );
var F = require ( 'fs' );
var rr = require ( 'recursive-readdir' );
var B = require ( 'handlebars' );
var G = require ( 'glob' );
var Q = require ( 'request' );
var I = require ( 'inspect-log' );

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
    console.log ( 'Usage: template-deploy <type> <version> <context>' );
    process.exit ( 1 );
}

B.registerHelper ( 'markdown', function ( md, options ) {
    if ( md ) {
        return M.toHTML ( md );
    }
} );

B.registerHelper ( 'and', function ( a, b, options ) {
    if ( a && b ) {
      return options.fn ( this );
    } else {
      return options.inverse ( this );
    }
} );

B.registerHelper ( 'or', function ( a, b, options ) {
    if ( a || b ) {
        return options.fn ( this );
    } else {
        return options.inverse ( this );
    }
} );

B.registerHelper ( 'compare', function ( left, operator, right, options ) {
    if ( arguments.length < 3 ) {
       throw new Error ( 'Handlerbars Helper "compare" needs 2 parameters' );
    }

    if ( options === undefined ) {
       options = right;
       right = operator;
       operator = '===';
    }

    var operators = {
       '==':     function ( l, r ) { return l == r; },
       '===':    function ( l, r ) { return l === r; },
       '!=':     function ( l, r ) { return l != r; },
       '!==':    function ( l, r ) { return l !== r; },
       '<':      function ( l, r ) { return l < r; },
       '>':      function ( l, r ) { return l > r; },
       '<=':     function ( l, r ) { return l <= r; },
       '>=':     function ( l, r ) { return l >= r; },
       'typeof': function ( l, r ) { return typeof l == r; }
    };

    if ( !operators[operator] ) {
      throw new Error ( 'Handlerbars Helper "compare" doesn\'t know the operator ' + operator );
    }

    var result = operators[operator] ( left, right );

    if ( result ) {
      return options.fn ( this );
    } else {
      return options.inverse ( this );
    }
} );

H ( [ P.resolve ( './templateConf.js' ) ] )
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
    .map ( R.ifElse ( R.always ( R.isNil ( process.argv[2] ) ), R.identity, R.prop ( process.argv[2] ) ) )
    .flatMap ( function ( config ) {
        return H ( [ P.resolve ( './' ) ] )
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
                var pathComponents = R.reject ( R.equals ( '' ), R.split ( P.sep, R.replace ( P.resolve ( './' ), '', filename ) ) );

                return H ( [ {
                    type: pathComponents[0],
                    version: R.init ( R.split ( '.', pathComponents[4] ) ).join ( '.' ),
                    context: pathComponents[3],
                    filename: filename
                } ] )
                    .flatMap ( function ( parms ) {
                        var templateParms = R.pick ( [ 'type', 'version', 'context' ] );

                        return H.wrapCallback ( Q )( config.apiUrl + '/templates?type=' + parms.type + '&version=' + parms.version + '&context=' + parms.context )
                            .pluck ( 'body' )
                            .map ( JSON.parse )
                            .reject ( R.isEmpty )
                            .map ( R.head )
                            .map ( function ( template ) {
                                return {
                                    url: config.apiUrl + '/templates/' + template.id,
                                    method: 'put',
                                    json: templateParms ( parms )
                                };
                            } )
                            .otherwise ( H ( [ {
                                url: config.apiUrl + '/templates',
                                method: 'post',
                                json: templateParms ( parms )
                            } ] ) )
                            .flatMap ( function ( queryParms ) {
                                return H.wrapCallback ( F.readFile )( parms.filename )
                                    .invoke ( 'toString', [ 'utf8' ] )
                                    .map ( function ( template ) {
                                        var templateCompiled;

                                        if ( config.data ) {
                                            try {
                                                templateCompiled = B.compile ( template.toString ( 'utf8' ) )( config.data );
                                            } catch ( error ) {
                                                templateCompiled = template;
                                            }
                                        } else {
                                            templateCompiled = template;
                                        }

                                        return R.merge ( queryParms, {
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
