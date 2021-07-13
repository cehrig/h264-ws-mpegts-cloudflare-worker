#include <libwebsockets.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include "h264-ws.h"

pthread_mutex_t mtx;
static struct lws *web_socket = NULL;

// this should be enough for a handful of NALUs
#define EXAMPLE_RX_BUFFER_BYTES (5000000)

int g_wrote = 0;

int write_ws(struct lws *wsi, unsigned char *buf, size_t len, enum lws_write_protocol proto)
{
    int wrote;

    unsigned char lws_buf[LWS_SEND_BUFFER_PRE_PADDING + len];
    unsigned char *p = &lws_buf[LWS_SEND_BUFFER_PRE_PADDING];
    memcpy(p, buf, len);

    wrote = lws_write(wsi, p, len, proto);

    g_wrote += wrote;
    fprintf(stderr, "wrote: %d (ring len: %d) g_wrote: %d\n", wrote, ring_in(nalu_ring), g_wrote-5);


    if (wrote != len) {
        return -1;
    }

    return wrote;
}

static int callback_example(struct lws *wsi, enum lws_callback_reasons reason, void *user, void *in, size_t len )
{
    switch( reason )
    {
        case LWS_CALLBACK_CLIENT_ESTABLISHED:
            lws_callback_on_writable(wsi);
            break;

        case LWS_CALLBACK_CLIENT_RECEIVE:
            if (debug) {
                write(STDERR_FILENO, in, len);
                fprintf(stderr, "\n");
            }

            if (!strcmp(in, "done")) {
                pthread_mutex_unlock(&mtx);
            }

            lws_callback_on_writable(wsi);
            break;

        case LWS_CALLBACK_CLIENT_WRITEABLE:
        {
            unsigned int *msg_num = (unsigned int *)user;
            t_nalu *nalu;
            unsigned int nalu_ct;
            unsigned char *buf;

            buf = NULL;
            size_t buf_len = 0;
            nalu_ct = 0;

            if (*msg_num == 0) {
                write_ws(wsi, (unsigned char *)"start", 5, LWS_WRITE_TEXT);
            }

            if (pthread_mutex_trylock(&mtx)) {
                break;
            }

            *msg_num += 1;

            while (nalu_ct < WS_CHUNKSIZ) {
                ring_sem_wait(nalu_ring);
                if ((nalu = ring_pull(nalu_ring)) == NULL) {
                    continue;
                }

                buf = realloc(buf, buf_len + nalu->len);
                memcpy(buf + buf_len, nalu->buf, nalu->len);
                buf_len += nalu->len;

                free(nalu->buf);
                free(nalu);

                nalu_ct++;
            }

            if (write_ws(wsi, buf, buf_len, LWS_WRITE_BINARY) < 0) {
                exit(1);
            }

            free(buf);
            break;
        }

        case LWS_CALLBACK_CLOSED:
        case LWS_CALLBACK_CLIENT_CONNECTION_ERROR:
        case 75:
            fprintf(stderr, "conn error\n");
            pthread_mutex_unlock(&mtx);
            web_socket = NULL;
            break;

        default:
            break;
    }

    return 0;
}

enum protocols
{
    PROTOCOL_EXAMPLE = 0,
    PROTOCOL_COUNT
};

static struct lws_protocols protocols[] =
        {
                {
                        "example-protocol",
                        callback_example,
                              0,
                        EXAMPLE_RX_BUFFER_BYTES,
                        0,
                        NULL,
                        EXAMPLE_RX_BUFFER_BYTES
                },
                { NULL, NULL, 0, 0 } /* terminator */
        };

char * get_path(char *do_name)
{
    char *path = calloc(strlen(do_name) + 2, sizeof(unsigned char));
    sprintf(path, "/%s", do_name);

    return path;
}

void *ws_connect(void *data)
{
    t_ws_options *ws_options = (t_ws_options *)data;
    unsigned int msg_num = 0;

    pthread_mutex_init(&mtx, NULL);

    struct lws_context_creation_info info;
    memset(&info, 0, sizeof(info));

    info.options = LWS_SERVER_OPTION_DO_SSL_GLOBAL_INIT;
    info.port = CONTEXT_PORT_NO_LISTEN;
    info.protocols = protocols;
    info.gid = -1;
    info.uid = -1;

    struct lws_context *context = lws_create_context( &info );

    while(1)
    {
        /* Connect if we are not connected to the server. */
        if(!web_socket)
        {
            struct lws_client_connect_info ccinfo = {0};
            ccinfo.context = context;
            ccinfo.address = ws_options->worker_host;
            ccinfo.port = 443;
            ccinfo.path = get_path(ws_options->do_name);
            ccinfo.host = ccinfo.address;
            ccinfo.origin = ccinfo.address;
            ccinfo.protocol = "wss";
            ccinfo.ssl_connection = LCCSCF_USE_SSL;
            ccinfo.userdata = (void *)&msg_num;
            web_socket = lws_client_connect_via_info(&ccinfo);
        }

        lws_callback_on_writable(web_socket);

        lws_service( context, /* timeout_ms = */ 0 );
        usleep(100000);
    }

    lws_context_destroy( context );

    return NULL;
}

