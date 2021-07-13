const NALHandler = require('./NALHandler.js');
exports.NALHandler = NALHandler;

exports.handlers = {
    async fetch(request, env) {
        try {
            return await handleRequest(request, env);
        } catch (e) {
            return new Response(e.message);
        }
    },
}

async function handleRequest(request, env) {
    let id;
    let obj;

    id = env.NALHandler.idFromName(NALHandler.endpoint(request).do_name);
    obj = env.NALHandler.get(id);

    return await obj.fetch(request);
}

