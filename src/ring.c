#include <stdlib.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>
#include "h264-ws.h"

t_nal_ring *nalu_ring;

t_nal_ring *ring_init(int len, int debug)
{
    t_nal_ring *ring;

    ring = malloc(sizeof(t_nal_ring));
    if (ring == NULL) {
        return NULL;
    }

    ring->nal = malloc(len * sizeof(t_nalu *));
    if (ring->nal == NULL) {
        ring_free(ring);
        return NULL;
    }

    if (sem_init(&ring->sem, 0, 0) < 0) {
        return NULL;
    }

    if (pthread_mutex_init(&ring->mtx, NULL)) {
        return NULL;
    }

    ring->len = len;
    ring->head = ring->tail = ring->in = 0;
    ring->debug = (debug) ? 1 : 0;

    return ring;
}

void ring_free(t_nal_ring *ring)
{
    if (ring == NULL) {
        return;
    }

    t_nalu *elem;

    while((elem = ring_pull(ring)) != NULL) {
        if (elem->buf != NULL) {
            free(elem->buf);
        }
        free(elem);
    }

    free(ring->nal);
    free(ring);
}

t_nalu * ring_push(t_nal_ring *ring, t_nalu *nalu)
{
    t_nalu *elem = NULL;

    if (ring == NULL) {
        goto unlock_return;
    }

    if (nalu == NULL) {
        goto unlock_return;
    }

    if (RING_IS_FULL(ring)) {
        ring_release(ring);
        // we now what we are talking about, so free NALU otherwise Uh Oh
        t_nalu *tail = ring_pull(ring);

        if (tail->buf != NULL) {
            free(tail->buf);
        }

        free(tail);
        ring_lock(ring);
    }

    elem = ring->nal[ring->head] = nalu;
    ring->in++;
    RING_POS_INCREMENT(ring->head, ring->len);
    sem_post(&ring->sem);

    if (ring->debug) {
        ring_print(ring);
    }

unlock_return:
    ring_release(ring);
    return elem;
}

void ring_sem_wait(t_nal_ring *ring)
{
    ring_lock(ring);
    sem_wait(&ring->sem);
    ring_release(ring);
}

t_nalu * ring_pull(t_nal_ring *ring)
{
    t_nalu * elem = NULL;
    ring_lock(ring);

    if (ring == NULL) {
        goto unlock_return;
    }

    if (RING_IS_EMPTY(ring)) {
        goto unlock_return;
    }

    elem = ring->nal[ring->tail];
    ring->in--;
    RING_POS_INCREMENT(ring->tail, ring->len);

    if (ring->debug) {
        ring_print(ring);
    }

unlock_return:
    ring_release(ring);
    return elem;
}

void ring_lock(t_nal_ring *ring)
{
    if (ring == NULL) {
        return;
    }

    pthread_mutex_lock(&ring->mtx);
}

void ring_release(t_nal_ring *ring)
{
    if (ring == NULL) {
        return;
    }

    pthread_mutex_unlock(&ring->mtx);
}

unsigned int ring_in(t_nal_ring *ring)
{
    unsigned int in = 0;

    ring_lock(ring);
    in = ring->in;
    ring_release(ring);

    return in;
}

void ring_print(t_nal_ring *ring)
{
    fprintf(stdout, "ring_buffer: ");
    for (int i = 0; i < ring->len; i++) {
        if (i == ring->head && i == ring->tail) {
            fprintf(stdout, "x");
            continue;
        }

        if (i == ring->head) {
            fprintf(stdout,"+");
            continue;
        }

        if (i == ring->tail) {
            fprintf(stdout, "o");
            continue;
        }

        fprintf(stdout, ".");
    }
    fprintf(stdout, "\n");
    fflush(stdout);
}