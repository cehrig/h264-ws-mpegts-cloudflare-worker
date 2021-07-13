#include <stdio.h>
#include <sys/select.h>
#include <sys/epoll.h>
#include <unistd.h>
#include <string.h>
#include <strings.h>
#include <stdlib.h>
#include <signal.h>
#include <error.h>
#include <errno.h>
#include <pthread.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include "h264-ws.h"

int debug = 0;

ssize_t _read(int fd, unsigned char *buf)
{
    ssize_t len = MIN_READ, r;
    ssize_t t = 0;
    int retry = 0;

    bzero(buf, MAX_READ);

    while (len > 0) {
        r = read(fd, buf+t, MAX_READ-t);

        if (!r) {
            return -1;
        }

        if (r < 0) {
            if (errno == EINTR) {
                continue;
            }

            if (++retry < 5) {
                continue;
            }

            return -1;
        }

        retry = 0;
        len -= r;
        t += r;
    }

    return t;
}


int is_nal(unsigned char *buf)
{
    // This works just fine with raspivid's raw h.264 although there might be an alternative nal start sequence
    if (buf[0] == 0x00 &&
        buf[1] == 0x00 &&
        buf[2] == 0x00 &&
        buf[3] == 0x01) {
        return buf[4];
    }

    return 0;
}

void free_nalu(t_nalu *nalu)
{
    if (nalu == NULL) {
        return;
    }

    if (nalu->buf != NULL) {
        free(nalu->buf);
    }

    free(nalu);
}

void process_nalu(unsigned char *nal, unsigned long len)
{
    int add_aud = 0;
    int type = nal[4] & 0x1F;

    // add AUD if SPS or non-IDR picture
    if (type == 7 || type == 1) {
        add_aud = 6;
    }

    t_nalu *nalu;
    nalu = malloc(sizeof(t_nalu));
    nalu->buf = calloc(len + add_aud, sizeof(unsigned char));
    nalu->len = len + add_aud;

    if (add_aud) {
        nalu->buf[0] = 0x00;
        nalu->buf[1] = 0x00;
        nalu->buf[2] = 0x00;
        nalu->buf[3] = 0x01;
        nalu->buf[4] = 0x09;
        nalu->buf[5] = 0xF0;
    }

    memcpy(nalu->buf+add_aud, nal, len);

    // add to ring buffer here
    ring_push(nalu_ring, nalu);


    int hdr;
    hdr = is_nal(nal);

    t_nal_unit unit;
    unit.f_zero_bit = nal[4] & 0x80;
    unit.nal_ref_idc = nal[4] & 0x60;
    unit.nal_unit_type = nal[4] & 0x1F;

    //fprintf(stderr, "zero_bit: %d, nal_ref_idc: %d, nal_unit_type: %d, len: %ld\n", nal[4] & 0x80, nal[4] & 0x60, nal[4] & 0x1F, len);
    // NALU sequence
    // AUD
    // 0x07 (sequence parameter set)
    // 0x08 (picture parameter set)
    // 0x05 (IDR picture)
    // AUD
    // 0x01 (non-IDR pictures) ...
}

size_t slice(unsigned char **buf, size_t len)
{
    unsigned char *stream = *buf;
    unsigned char *start = NULL;
    unsigned long nal_len;
    int i;

    for (i = 0; i < len-3; i++) {
        if (!is_nal(stream+i)) {
            continue;
        }

        if (start) {
            nal_len = *buf+i-start;
            process_nalu(start, nal_len);

            len -= nal_len;

            unsigned char *_buf = calloc(len, sizeof(unsigned char));
            memcpy(_buf, stream+i, len);
            *buf = _buf;

            free(stream);

            return slice(buf, len);
        }

        start = *buf+i;

    }

    return len;
}

void sighandler(int sig, siginfo_t *info, void *ucontext)
{
    // we are dead anyway
    ring_release(nalu_ring);

    // flush ringbuffer
    ring_free(nalu_ring);

    // bye
    signal (sig, SIG_DFL);
    raise(sig);
}

int tcp_connect(char *ip, int port)
{
    int cfd, flags, connect_timeo = 0, sock_error = 0;
    socklen_t len = sizeof(int);
    struct sockaddr_in sockaddr;
    struct timeval timeo;
    fd_set fdset;

    if ((cfd = socket(AF_INET, SOCK_STREAM, 0)) < 0) {
        error(1, errno, "connect");
    }

    bzero(&sockaddr, sizeof(struct sockaddr_in));
    sockaddr.sin_port = htons(port);
    sockaddr.sin_family = AF_INET;

    if (!inet_aton(ip, &sockaddr.sin_addr)) {
        error(1, errno, "inet_aton(%s)", ip);
    }

    // used for read and connect timeouts
    timeo.tv_sec = 0;
    timeo.tv_usec = 250000;

    // set socket non-blocking
    flags = fcntl(cfd, F_GETFL);
    fcntl(cfd, F_SETFL, flags | O_NONBLOCK);

    // setup select
    FD_ZERO(&fdset);
    FD_SET(cfd, &fdset);

    if (connect(cfd, (struct sockaddr *) &sockaddr, sizeof(struct sockaddr)) < 0) {
        if (errno != EINPROGRESS) {
            goto close_return;
        }

        for (connect_timeo = 0; connect_timeo < CONNECT_TIMEO; connect_timeo++) {
            if (select(cfd + 1, &fdset, NULL, NULL, &timeo) > 0) {
                break;
            }
        }
    }

    if (getsockopt(cfd, SOL_SOCKET, SO_ERROR, &sock_error, &len) < 0) {
        fprintf(stderr, "getsockopt(SO_ERROR)\n");
        goto close_return;
    }

    if (sock_error != 0) {
        fprintf(stderr, "socket error: %s\n", strerror(sock_error));
        goto close_return;
    }

    if (connect_timeo == CONNECT_TIMEO) {
        goto close_return;
    }

    // make socket blocking again
    fcntl(cfd, F_SETFL, flags);

    if (setsockopt(cfd, SOL_SOCKET, SO_RCVTIMEO, &timeo, sizeof(struct timeval)) < 0) {
        error(1, errno, "setsockopt");
    }

    return cfd;

close_return:
    close(cfd);
    return -1;
}

void tcp_read(int fd)
{
    int efd, nev, i;
    size_t t = 0;
    ssize_t r = 0;
    struct epoll_event ev, evs[1024];
    unsigned char buf[MAX_READ];
    unsigned char *stream = NULL;

    // setting up stdin epoll
    if ((efd = epoll_create1(0)) < 0) {
        error(1, errno, "epoll_create");
    }

    ev.events = EPOLLIN | EPOLLERR | EPOLLHUP;
    ev.data.fd = fd;

    if (epoll_ctl(efd, EPOLL_CTL_ADD, fd, &ev) == -1) {
        error(1, errno, "epoll_ctl(EPOLL_CTL_ADD)");
    }

    while (1) {
        if ((nev = epoll_wait(efd, evs, 1024, -1)) < 0) {
            error(1, errno, "epoll_wait");
        }

        for (i = 0; i < nev; i++) {
            if (evs[i].events & EPOLLHUP || evs[i].events & EPOLLERR) {
                //error(1, errno, "EPOLLHUP || EPOLLERR");
                return;
            }

            if ((r = _read(evs[i].data.fd, buf)) < 0) {
                if (stream != NULL) {
                    free(stream);
                }
                return;
            }

            if ((stream = realloc(stream, t + r)) == NULL) {
                error(1, errno, "realloc");
            }

            memcpy(stream+t, buf, r);

            t += r;
            t = slice(&stream, t);
        }
    }
}

int main(int argc, char **argv)
{
    pthread_t ws_thread;
    char *ip, *workers_host, *do_name;
    int port;
    t_ws_options ws_options;

    if (argc < 5) {
        error(1, 0, "usage: <IP> <Port> <Workers Host> <Ingest Path> <Optional: Debug flag>");
    }

    // set destination IP
    ip = argv[1];

    // set destination port
    if ((port = (int) strtol(argv[2], NULL, 10)) && errno == ERANGE) {
        error(1, errno, "strtol(port)");
    }

    // set workers hostname
    workers_host = argv[3];

    // set durable object name
    do_name = argv[4];

    if (argc == 6) {
        debug = 1;
    }

    ws_options.worker_host = workers_host;
    ws_options.do_name = do_name;

    // setting up sig handler
    sigset_t sa_mask;
    sigemptyset(&sa_mask);

    struct sigaction sig_action;
    sig_action.sa_sigaction = sighandler;
    sig_action.sa_mask = sa_mask;
    sig_action.sa_flags = 0;

    sigaction(SIGTERM, &sig_action, NULL);
    sigaction(SIGINT, &sig_action, NULL);

    // setting up ring buffer
    if ((nalu_ring = ring_init(RING_SIZ, 0)) == NULL) {
        error(1, errno, "ring_init");
    }

    // starting ws thread
    pthread_create(&ws_thread, NULL, ws_connect, (void *)&ws_options);

    int cfd;

    // read bitstream
    while(1) {
        if ((cfd = tcp_connect(ip, port)) < 0) {
            goto close_wait;
        }
        fprintf(stderr, "connected\n");
        tcp_read(cfd);

close_wait:
        close(cfd);
        usleep(200000);
    }
}

