const mux = require('./classes/Multiplexer.js')
const logger = require('./classes/Logger.js')
const Bytehelper = require('./classes/Bytehelper.js')

module.exports = class NALHandler {
    constructor(state, env) {
        this.state = state;
        this.logger = new logger(env.SLACK_URL || '');
        this.worker = env.HOSTNAME;

        // initialize instance of the multiplexer and pass interface to persistent storage
        this.mux = new mux(this.state.storage, this.logger, this.worker);

        // Cache API interface
        this.cache = caches.default;
    }

    async fetch(request) {
        let response;

        // let's initialize continuity counters
        if (!this.initializePromise) {
            this.initializePromise = this.mux.initialize()
        }
        await this.initializePromise;

        /*

        There are three endpoints we provide in the object
        - return playlist (aka. the manifest / m3u8)
        - return 'HLS segments'
        - read h264 bitstream via websockets
         */

        switch(NALHandler.endpoint(request).mode) {
            case 'html':
                response = this.html(request);
                break;

            case 'playlist.m3u8':
                response = this.playlist(request);

                break;
            case 'packet':
                response = await this.segment(request);
                break;

            case 'ingest':
                response = await this.websocket();
                break;

            case 'info':
                response = await this.info();
                break;

            default:
                response = new Response(`unknown endpoint. do_name: ${NALHandler.endpoint(request).do_name} endpoint: ${NALHandler.endpoint(request).mode} `, {
                    status: 500
                })
        }

        return response;
    }

    // parsing the right endpoint based on our request object
    static endpoint(request) {
        let url;
        let path;
        let do_name;
        let mode;
        let num;

        url = new URL(request.url);
        path = url.pathname.split('/');
        do_name = path[1] || 'fallback';
        mode = path[2] || 'playlist';
        num = path[3] || 1;

        return {
            do_name: do_name,
            mode: mode,
            num: num,
        }
    }

    // endpoint for ingesting the video
    async websocket() {
        // creating a websocket pair
        let pair = new WebSocketPair();

        // pass server-side to websocket handler
        await this.handle_ws(pair[1]);

        return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // this is ugly
    html(request) {
        return new Response(`
<link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css">
<link href="//vjs.zencdn.net/7.3.0/video-js.min.css" rel="stylesheet">
<script src="//vjs.zencdn.net/7.3.0/video.min.js"></script>

<div class="row">
        <video-js id=stream class="vjs-default-skin vjs-big-play-centered" width=500 controls autoplay muted>
                <source src="/${NALHandler.endpoint(request).do_name}/playlist.m3u8">
        </video-js>
</div>

<script>
        var player = videojs('stream');
        player.play();
</script>`, {
            headers: {
                'content-type': 'text/html'
            }
        });
    }

    // this is ugly too
    playlist(request) {
        const num_segments = 3;

        let segments;
        let start;
        let end;

        segments = this.mux.get_counter('storage');

        start = (segments - num_segments < 0) ? 0 : segments - num_segments;
        end = (start + num_segments > segments) ? segments : start + num_segments;

        let playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:3
#EXT-X-ALLOW-CACHE:YES
#EXT-X-MEDIA-SEQUENCE:${start}
`
        for (let i = start; i < end; i++) {
            playlist += `#EXTINF:3.000000,
/${NALHandler.endpoint(request).do_name}/packet/${i}.ts
`
        }

        return new Response(playlist, {
            headers: {
                'content-type': 'application/vnd.apple.mpegurl',
                'cache-control': 'no-transform',
                'content-length': playlist.length,
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    async segment(request) {
        let num;
        let segment;

        num = NALHandler.endpoint(request).num;
        num = num.replace('.ts', '');
        segment = await this.cache.match(`https://${this.worker}/packet/${num}`);

        return new Response(segment.body, {
            status: 200,
            headers: {
                'content-type': 'video/mp2t',
                'cache-control': 'no-transform',
            }
        })
    }

    // info endpoint showing several counters
    async info() {
        let raw_buf_size;
        let packetizer_buf_size;
        let segment_length;
        let segment_pos;

        let idr;
        let pat;
        let pmt;
        let picture;
        let ms;
        let program;
        let segment;
        let raw_buf_pos;
        let packetizer_packets;

        raw_buf_size = this.mux.buffer.length;
        packetizer_buf_size = this.mux.packetizer.buffer.length;
        segment_length = this.mux.packetizer.segment.length;
        segment_pos = this.mux.packetizer.segment_length;

        idr = this.mux.get_counter('idr');
        pat = this.mux.get_counter('pat');
        pmt = this.mux.get_counter('pmt');
        picture = this.mux.get_counter('picture');
        ms = this.mux.get_counter('ms');
        program = this.mux.get_counter('program');
        segment = this.mux.get_counter('storage');
        raw_buf_pos = this.mux.get_counter('raw_buf_pos');
        packetizer_packets = this.mux.get_counter('packetizer_packets');

        return new Response(`<script>setTimeout("location.reload(true);", 1000);</script><pre>
idr: ${idr} (mod 3: ${idr % 3}) (1 = 90 pictures have been added)
pat: ${pat} (mod 16: ${pat % 16})
pmt: ${pmt} (mod 16: ${pmt % 16})
picture: ${picture}
ms: ${ms}
prog: ${program}  (mod 16: ${program % 16})
segment: ${segment}
raw buf size: ${raw_buf_size}
raw buf pos: ${raw_buf_pos}
packetizer buf size: ${packetizer_buf_size}
packetizer packets: ${packetizer_packets}
segment size: ${segment_length}
segment pos: ${segment_pos}</pre>
        `, {
            headers: {
                'content-type': 'text/html'
            }
        });
    }

    async handle_ws(server) {
        let buffer;

        // accepting websocket connections
        server.accept();

        try {
            server.addEventListener("message", async msg => {
                try {
                    if (msg.data === "start") {
                        await this.mux.reset(0, 1);
                        return;
                    }

                    // move h.264 bitstream to uint8array
                    buffer = new Uint8Array(msg.data);

                    // and feed the multiplexer with this data
                    let muxer = await this.mux.push(buffer);

                    // the client is responsible for synchronizing ws frames, so we tell it we are ready to receive
                    // the next one
                    this.echo(server, `done`);

                } catch(ex) {
                    this.echo(server, {
                        message: ex.message,
                        stack: ex.stack
                    });
                }
            })
        } catch(ex) {
            this.echo(server, ex.message);
        }
    }

    echo(server, msg) {
        try {
            if (typeof msg !== 'string') {
                msg = JSON.stringify(msg);
            }
            server.send(msg);
        } catch(ex) {
            console.log(ex)
        }
    }
}