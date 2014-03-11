/**************************************************************************************************
 *
 * Copyright (c) 2014 Digium, Inc.
 * All Rights Reserved. Licensed Software.
 *
 * @authors : Erin Spiceland <espiceland@digium.com>
 */

/*global brightstream: false */
/**
 * Create a new Presentable.
 * @author Erin Spiceland <espiceland@digium.com>
 * @class
 * @constructor
 * @augments brightstream.EventEmitter
 * @classdesc Presentable class
 * @param {string} client
 * @param {string} id
 * @returns {brightstream.Presentable}
 */
brightstream.Presentable = function (params) {
    "use strict";
    params = params || {};
    var client = params.client;
    var that = brightstream.EventEmitter(params);
    delete that.client;
    that.className = 'brightstream.Presentable';

    var sessions = [];
    var presence = 'unavailable';

    /**
     * Return the user ID
     * @memberof! brightstream.Presentable
     * @method brightstream.Presentable.getID
     * @return {string}
     */
    var getID = that.publicize('getID', function () {
        return that.id;
    });

    /**
     * Get the name.
     * @memberof! brightstream.Presentable
     * @method brightstream.Presentable.getName
     * @return {string}
     */
    var getName = that.publicize('getName', function () {
        return that.name;
    });

    /**
     * Set the presence on the object and the session
     * @memberof! brightstream.Presentable
     * @method brightstream.Presentable.setPresence
     * @param {string} presence
     * @param {string} connectionId
     * @fires brightstream.Presentable#presence
     */
    var setPresence = that.publicize('setPresence', function (params) {
        params = params || {};
        params.presence = params.presence || 'available';
        params.connectionId = params.connectionId || 'local';

        sessions[params.connectionId] = {
            connectionId: params.connectionId,
            presence: params.presence
        };

        if (typeof that.resolvePresence === 'function') {
            presence = that.resolvePresence({sessions: sessions});
        } else {
            presence = params.presence;
        }

        /**
         * @event brightstream.Presentable#presence
         * @type {brightstream.Event}
         * @property {string} presence
         */
        that.fire('presence', {
            presence: presence
        });
    });

    /**
     * Get the presence.
     * @memberof! brightstream.Presentable
     * @method brightstream.Presentable.getPresence
     * @returns {string}
     */
    var getPresence = that.publicize('getPresence', function () {
        return presence;
    });

    return that;
}; // End brightstream.Presentable

/**
 * Create a new Endpoint.
 * @author Erin Spiceland <espiceland@digium.com>
 * @constructor
 * @augments brightstream.Presentable
 * @classdesc Endpoint class
 * @param {string} client
 * @param {string} id
 * @returns {brightstream.Endpoint}
 */
brightstream.Endpoint = function (params) {
    "use strict";
    params = params || {};
    var client = params.client;
    var that = brightstream.Presentable(params);
    delete that.client;
    that.className = 'brightstream.Endpoint';
    that.directConnection = null;
    var sessions = {};

    var signalingChannel = brightstream.getClient(client).getSignalingChannel();

    /**
     * Send a message to the endpoint. If a DirectConnection exists, send peer-to-peer. If not, send it through
     * the infrastructure.
     * @memberof! brightstream.Endpoint
     * @method brightstream.Endpoint.sendMessage
     * @param {string} message
     * @param {string} [connectionId]
     * @param {function} [onSuccess] - Success handler for this invocation of this method only.
     * @param {function} [onError] - Error handler for this invocation of this method only.
     * @returns {Promise<undefined>}
     */
    var sendMessage = that.publicize('sendMessage', function (params) {
        params = params || {};

        return signalingChannel.sendMessage({
            connectionId: params.connectionId,
            message: params.message,
            recipient: that,
            onSuccess: params.onSuccess,
            onError: params.onError
        });
    });

    /**
     * Send a signal to the endpoint.
     * @memberof! brightstream.Endpoint
     * @method brightstream.Endpoint.sendSignal
     * @param {object|string} signal
     * @param {string} [connectionId]
     * @param {function} [onSuccess] - Success handler for this invocation of this method only.
     * @param {function} [onError] - Error handler for this invocation of this method only.
     * @returns {Promise<undefined>}
     */
    var sendSignal = that.publicize('sendSignal', function (params) {
        log.debug('Endpoint.sendSignal, no support for custom signaling profiles.');
        params = params || {};
        var deferred = brightstream.makeDeferred(params.onSuccess, params.onError);

        if (!params.signal) {
            deferred.reject(new Error("Can't send a signal without a 'signal' paramter."));
        }

        signalingChannel.sendSignal({
            connectionId: params.connectionId,
            signal: params.signal,
            recipient: that,
            onSuccess: params.onSuccess,
            onError: params.onError
        }).done(function () {
            deferred.resolve();
        }, function (err) {
            deferred.reject(err);
        });

        return deferred.promise;
    });

    /**
     * Create a new Call for a voice and/or video call. If initiator is set to true,
     * the Call will start the call.
     * @memberof! brightstream.Endpoint
     * @method brightstream.Endpoint.call
     * @param {RTCServers} [servers]
     * @param {RTCConstraints} [constraints]
     * @param {string} [connectionId]
     * @param {boolean} [initiator] Whether the logged-in user initiated the call.
     * @returns {brightstream.Call}
     */
    var call = that.publicize('call', function (params) {
        var call = null;
        var clientObj = brightstream.getClient(client);
        var combinedCallSettings = clientObj.getCallSettings();
        var user = clientObj.user;

        log.trace('Endpoint.call');
        log.debug('Default callSettings is', combinedCallSettings);
        if (params.initiator === undefined) {
            params.initiator = true;
        }

        if (!that.id) {
            log.error("Can't start a call without endpoint ID!");
            return;
        }

        // Apply call-specific callSettings to the app's defaults
        combinedCallSettings.constraints = params.constraints || combinedCallSettings.constraints;
        combinedCallSettings.servers = params.servers || combinedCallSettings.servers;
        log.debug('Final callSettings is', combinedCallSettings);

        params.callSettings = combinedCallSettings;
        params.client = client;
        params.remoteEndpoint = that;

        params.signalOffer = function (signalParams) {
            signalingChannel.sendSDP({
                type: 'offer',
                target: 'call',
                recipient: that,
                sdpObj: signalParams.sdp
            });
        };
        params.signalConnected = function (signalParams) {
            signalingChannel.sendConnected({
                target: 'call',
                connectionId: signalParams.connectionId,
                recipient: that
            });
        };
        params.signalAnswer = function (signalParams) {
            signalingChannel.sendSDP({
                type: 'answer',
                target: 'call',
                connectionId: signalParams.connectionId,
                recipient: that,
                sdpObj: signalParams.sdp
            });
        };
        params.signalCandidate = function (signalParams) {
            signalingChannel.sendCandidate({
                target: 'call',
                connectionId: signalParams.connectionId,
                recipient: that,
                candObj: signalParams.candidate
            });
        };
        params.signalTerminate = function (signalParams) {
            signalingChannel.sendBye({
                target: 'call',
                connectionId: signalParams.connectionId,
                recipient: that
            });
        };
        params.signalReport = function (signalParams) {
            signalParams.report.target = 'call';
            log.debug("Not sending report");
            log.debug(signalParams.report);
        };
        call = brightstream.Call(params);

        if (params.initiator === true) {
            call.answer();
        }
        user.addCall({
            call: call,
            endpoint: that
        });

        // Don't use params.onHangup here. Will overwrite the developer's callback.
        call.listen('hangup', function hangupListener(evt) {
            user.removeCall({id: call.id});
        }, true);
        return call;
    });

    /**
     * Create a new DirectConnection. If initiator is set to true, the Call will start the call.
     * @memberof! brightstream.Endpoint
     * @method brightstream.Endpoint.getDirectConnection
     * @param {function} [onOpen]
     * @param {function} [onClose]
     * @param {function} [onMessage]
     * @param {RTCServers} [servers]
     * @param {string} [connectionId]
     * @param {boolean} [initiator] Whether the logged-in user initiated the call.
     * @returns {brightstream.Call}
     */
    var getDirectConnection = that.publicize('getDirectConnection', function (params) {
        var directConnection = null;
        var clientObj = brightstream.getClient(client);
        var combinedConnectionSettings = clientObj.getCallSettings();
        var user = clientObj.user;
        params = params || {};

        log.trace('Endpoint.getDirectConnection');

        if (that.directConnection) {
            return that.directConnection;
        }

        if (params.initiator === undefined) {
            params.initiator = true;
        }

        if (!that.id) {
            log.error("Can't start a direct connection without endpoint ID!");
            return;
        }

        // Apply connection-specific callSettings to the app's defaults
        combinedConnectionSettings.servers = params.servers || combinedConnectionSettings.servers;

        params.connectionSettings = combinedConnectionSettings;
        params.client = client;
        params.remoteEndpoint = that;

        params.signalOffer = function (signalParams) {
            signalingChannel.sendSDP({
                type: 'offer',
                target: 'directConnection',
                recipient: that,
                sdpObj: signalParams.sdp
            });
        };
        params.signalConnected = function (signalParams) {
            signalingChannel.sendConnected({
                target: 'directConnection',
                connectionId: signalParams.connectionId,
                recipient: that
            });
        };
        params.signalAnswer = function (signalParams) {
            signalingChannel.sendSDP({
                target: 'directConnection',
                type: 'answer',
                connectionId: signalParams.connectionId,
                recipient: that,
                sdpObj: signalParams.sdp
            });
        };
        params.signalCandidate = function (signalParams) {
            signalingChannel.sendCandidate({
                target: 'directConnection',
                connectionId: signalParams.connectionId,
                recipient: that,
                candObj: signalParams.candidate
            });
        };
        params.signalTerminate = function (signalParams) {
            signalingChannel.sendBye({
                target: 'directConnection',
                connectionId: signalParams.connectionId,
                recipient: that
            });
        };
        params.signalReport = function (signalParams) {
            signalParams.report.target = 'directConnection';
            log.debug("Not sending report");
            log.debug(signalParams.report);
        };
        directConnection = that.directConnection = brightstream.DirectConnection(params);

        if (params.initiator === true) {
            directConnection.accept({
                onOpen: params.onOpen,
                onClose: params.onClose,
                onMessage: params.onMessage
            });
        } else {
            /**
             * @event brightstream.User#direct-connection
             * @type {brightstream.Event}
             * @property {brightstream.DirectConnection}
             */
            clientObj.user.fire('direct-connection', {
                directConnection: directConnection,
                endpoint: that
            });
            if (!clientObj.user.hasListeners('direct-connection')) {
                log.warn("Got an incoming direct connection with no handlers to accept it!");
                directConnection.reject();
            }
        }

        directConnection.listen('close', function (evt) {
            that.directConnection.ignore();
            that.directConnection = undefined;
        }, true);

        return directConnection;
    });

    /**
     * Find the presence out of all known connections with the highest priority (most availability)
     * and set it as the endpoint's resolved presence.
     * @memberof! brightstream.Endpoint
     * @method brightstream.Endpoint.setPresence
     * @param {array} sessions - Endpoint's sessions
     * @private
     * @returns {string}
     */
    var resolvePresence = that.publicize('resolvePresence', function (params) {
        var presence;
        var options = ['chat', 'available', 'away', 'dnd', 'xa', 'unavailable'];
        params = params || {};
        var connectionIds = Object.keys(params.sessions);

        /**
         * Sort the connectionIds array by the priority of the value of the presence of that
         * connectionId. This will cause the first element in the sessionsId to be the id of the
         * session with the highest priority presence so we can access it by the 0 index.
         * TODO: If we don't really care about the sorting and only about the highest priority
         * we could use Array.prototype.every to improve this algorithm.
         */
        connectionIds = connectionIds.sort(function sorter(a, b) {
            var indexA = options.indexOf(params.sessions[a].presence);
            var indexB = options.indexOf(params.sessions[b].presence);
            // Move it to the end of the list if it isn't one of our accepted presence values
            indexA = indexA === -1 ? 1000 : indexA;
            indexB = indexB === -1 ? 1000 : indexB;
            return indexA < indexB ? -1 : (indexB < indexA ? 1 : 0);
        });

        presence = connectionIds[0] ? params.sessions[connectionIds[0]].presence : 'unavailable';

        return presence;
    });

    return that;
}; // End brightstream.Endpoint

/**
 * Create a new User.
 * @author Erin Spiceland <espiceland@digium.com>
 * @constructor
 * @augments brightstream.Presentable
 * @classdesc User class
 * @param {string} client
 * @param {Date} timeLoggedIn
 * @param {boolean} loggedIn
 * @param {string} token
 * @returns {brightstream.User}
 */
brightstream.User = function (params) {
    "use strict";
    params = params || {};
    var client = params.client;
    var that = brightstream.Presentable(params);
    var superClass = {
        setPresence: that.setPresence
    };
    delete that.client;
    that.className = 'brightstream.User';

    var calls = [];
    var presenceQueue = [];
    var signalingChannel = brightstream.getClient(client).getSignalingChannel();

    /**
     * Override Presentable.setPresence to send presence to the server before updating the object.
     * @memberof! brightstream.User
     * @method brightstream.User.setPresence
     * @param {string} presence
     * @param {function} onSuccess
     * @param {function} onError
     * @return {Promise<undefined>}
     */
    var setPresence = that.publicize('setPresence', function (params) {
        params = params || {};
        params.presence = params.presence || "available";
        log.info('sending my presence update ' + params.presence);

        return signalingChannel.sendPresence({
            presence: params.presence,
            onSuccess: function (p) {
                superClass.setPresence(params);
                if (typeof params.onSuccess === 'function') {
                    params.onSuccess(p);
                }
            },
            onError: params.onError
        });
    });

    /**
     * Get all current calls.
     * @memberof! brightstream.User
     * @method brightstream.User.getCalls
     * @returns {Array<brightstream.Call>}
     */
    var getCalls = that.publicize('getCalls', function (params) {
        return calls;
    });

    /**
     * Get the Call with the endpoint specified.
     * @memberof! brightstream.User
     * @method brightstream.User.getCall
     * @param {string} id - Endpoint ID
     * @param {boolean} create - whether or not to create a new call if the specified endpointId isn't found
     * @returns {brightstream.Call}
     */
    var getCall = that.publicize('getCall', function (params) {
        var call = null;
        var endpoint = null;
        var callSettings = null;
        var clientObj = brightstream.getClient(client);

        calls.forEach(function findCall(one) {
            if (one.remoteEndpoint.getID() === params.id) {
                if (one.getState() >= 6) { // ended or media error
                    return;
                }
                call = one;
            }
        });

        if (call === null && params.create === true) {
            endpoint = clientObj.getEndpoint({id: params.id});
            try {
                callSettings = clientObj.getCallSettings();
                call = endpoint.call({
                    callSettings: callSettings,
                    initiator: false
                });
            } catch (e) {
                log.error("Couldn't create Call: " + e.message);
            }
        }
        return call;
    });

    /**
     * Associate the call or direct connection with this user.
     * @memberof! brightstream.User
     * @method brightstream.User.addCall
     * @param {brightstream.Call} call
     * @fires brightstream.User#call
     * @todo TODO rename this something else
     */
    var addCall = that.publicize('addCall', function (params) {
        if (calls.indexOf(params.call) === -1) {
            calls.push(params.call);
            /**
             * @event brightstream.User#call
             * @type {brightstream.Event}
             * @property {brightstream.Call} call
             * @property {brightstream.Endpoint} endpoint
             */
            if (params.call.className === 'brightstream.Call') {
                if (!params.call.initiator && !that.hasListeners('call')) {
                    log.warn("Got an incoming call with no handlers to accept it!");
                    params.call.reject();
                    return;
                }
                that.fire('call', {
                    endpoint: params.endpoint,
                    call: params.call
                });
            }
        }
    });

    /**
     * Remove the call or direct connection.
     * @memberof! brightstream.User
     * @method brightstream.User.removeCall
     * @param {string} [id] Call or DirectConnection id
     * @param {brightstream.Call} [call] Call or DirectConnection
     * @todo TODO rename this something else
     */
    var removeCall = that.publicize('removeCall', function (params) {
        var match = false;
        if (!params.id && !params.call) {
            throw new Error("Must specify endpointId of Call to remove or the call itself.");
        }

        // Loop backward since we're modifying the array in place.
        for (var i = calls.length - 1; i >= 0; i -= 1) {
            if (calls[i].id === params.id ||
                    (params.call && calls[i] === params.call)) {
                calls.splice(i);
                match = true;
            }
        }

        if (!match) {
            log.warn("No call removed.");
        }
    });


    /**
     * Set presence to available.
     * @memberof! brightstream.User
     * @method brightstream.User.setOnline
     * @param {string}
     */
    var setOnline = that.publicize('setOnline', function (params) {
        params = params || {};
        params.presence = params.presence || 'available';
        return that.setPresence(params);
    });

    return that;
}; // End brightstream.User

