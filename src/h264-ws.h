#ifndef WS_H
#define WS_H

#include <stdint.h>
#include <pthread.h>
#include <semaphore.h>

// connection timeout
#define CONNECT_TIMEO 5

// we write to ...
#define STDOUT_FD 1

// minimum number of bytes read from STDIN
#define MIN_READ 16384

// maximum number of bytes read from STDIN
#define MAX_READ 32768

// NALU ring buffer size
#define RING_SIZ 50

// NALU chunk size we send over the wire
#define WS_CHUNKSIZ 20

#define RING_IS_FULL(_ring) \
    (((_ring)->head + 1) % (_ring)->len == (_ring)->tail)

#define RING_IS_EMPTY(_ring) \
    (((_ring)->tail) == (_ring)->head)

#define RING_POS_INCREMENT(_p, _l) \
    ((_p) = ((_p)+1) % (_l))

typedef struct nal_unit {
    unsigned char f_zero_bit : 1;
    unsigned char nal_ref_idc : 2;
    unsigned char nal_unit_type : 5;
} t_nal_unit;

typedef struct nalu {
    unsigned char *buf;
    unsigned long len;
} t_nalu;

typedef struct nal_ring {
    t_nalu **nal;
    size_t tail;
    size_t head;
    size_t len;
    unsigned int in;
    unsigned int debug;
    sem_t sem;
    pthread_mutex_t mtx;
} t_nal_ring;

typedef struct ws_options {
    char *do_name;
    char *worker_host;
} t_ws_options;

extern t_nal_ring *nalu_ring;
extern int debug;

t_nal_ring *ring_init(int, int);
t_nalu * ring_push(t_nal_ring *, t_nalu *);
t_nalu * ring_pull(t_nal_ring *);
void ring_free(t_nal_ring *);
void ring_sem_wait(t_nal_ring *);
void ring_lock(t_nal_ring *);
void ring_release(t_nal_ring *);
unsigned int ring_in(t_nal_ring *);
void ring_print(t_nal_ring *);

void *ws_connect(void *);

#endif