#!/usr/bin/env python3
"""Synthesise a 30-second news-beat bed for the reel.

No samples, no licences, no API: raw oscillators and noise shaped by hand.
Writes reel/public/music/bed.wav (44.1 kHz stereo), which ffmpeg then turns
into bed.mp3.

    python3 reel/scripts/make_bed.py
"""
import math
import random
import struct
import wave
from pathlib import Path

SR = 44100
BPM = 124.0
BEAT = 60.0 / BPM
DUR = 30.0
N = int(SR * DUR)
random.seed(7)


def env(t, attack, decay):
    if t < 0:
        return 0.0
    a = min(1.0, t / attack) if attack > 0 else 1.0
    return a * math.exp(-t / decay)


def add(buf, start, samples):
    i = int(start * SR)
    for k, v in enumerate(samples):
        j = i + k
        if 0 <= j < N:
            buf[j] += v


def kick(dur=0.32, amp=1.0):
    out = []
    for k in range(int(dur * SR)):
        t = k / SR
        freq = 118 * math.exp(-t * 26) + 44
        out.append(math.sin(2 * math.pi * freq * t) * env(t, 0.002, 0.12) * amp)
    return out


def clap(dur=0.16, amp=0.5):
    out = []
    for k in range(int(dur * SR)):
        t = k / SR
        n = random.uniform(-1, 1)
        out.append((n * 0.55 + math.sin(2 * math.pi * 1650 * t) * 0.45) * env(t, 0.001, 0.045) * amp)
    return out


def hat(dur=0.05, amp=0.18):
    out, prev = [], 0.0
    for k in range(int(dur * SR)):
        t = k / SR
        n = random.uniform(-1, 1)
        hp = n - prev * 0.92  # cheap high-pass
        prev = n
        out.append(hp * env(t, 0.0005, 0.014) * amp)
    return out


def bass(freq, dur, amp=0.42):
    out = []
    for k in range(int(dur * SR)):
        t = k / SR
        v = math.sin(2 * math.pi * freq * t)
        v += 0.42 * math.sin(4 * math.pi * freq * t)
        v += 0.18 * math.sin(6 * math.pi * freq * t)
        out.append(math.tanh(v * 1.6) * env(t, 0.006, 0.22) * amp)
    return out


def pluck(freq, dur=0.22, amp=0.16):
    out = []
    for k in range(int(dur * SR)):
        t = k / SR
        v = math.sin(2 * math.pi * freq * t) + 0.3 * math.sin(6 * math.pi * freq * t)
        out.append(v * env(t, 0.003, 0.09) * amp)
    return out


def riser(dur=1.2, amp=0.22):
    out, prev = [], 0.0
    for k in range(int(dur * SR)):
        t = k / SR
        n = random.uniform(-1, 1)
        hp = n - prev * (0.55 - 0.4 * (t / dur))
        prev = n
        out.append(hp * (t / dur) ** 2 * amp)
    return out


def note(name):
    names = {'A1': 55.0, 'C2': 65.41, 'D2': 73.42, 'E2': 82.41, 'G2': 98.0,
             'A2': 110.0, 'C3': 130.81, 'D3': 146.83, 'E3': 164.81, 'G3': 196.0}
    return names[name]


def main():
    buf = [0.0] * N
    bars = int(DUR / (BEAT * 4)) + 1
    bassline = [['A1', 'A1', 'C2', 'E2'], ['A1', 'A1', 'D2', 'G2'],
                ['C2', 'C2', 'E2', 'G2'], ['D2', 'D2', 'E2', 'A2']]
    arp = ['A2', 'C3', 'E3', 'G3', 'E3', 'C3', 'D3', 'G3']

    for bar in range(bars):
        b0 = bar * 4 * BEAT
        for beat in range(4):
            t = b0 + beat * BEAT
            if beat in (0, 2):
                add(buf, t, kick())
            if beat in (1, 3):
                add(buf, t, clap())
            add(buf, t + BEAT * 0.5, hat())
            add(buf, t, hat(amp=0.1))
            add(buf, t, bass(note(bassline[bar % 4][beat]), BEAT * 0.46))
        for eighth in range(8):
            if eighth % 2 == 1:
                add(buf, b0 + eighth * BEAT * 0.5, pluck(note(arp[(bar * 8 + eighth) % 8])))

    for at in (0.0, 14.5, 28.2):
        add(buf, at, riser())

    # gentle master: tanh curve, then normalise to about -1 dBFS
    peak = max(abs(x) for x in buf) or 1.0
    scale = 0.89 / peak
    frames = bytearray()
    for x in buf:
        v = math.tanh(x * scale * 1.8)
        s = int(max(-1.0, min(1.0, v)) * 32767)
        frames += struct.pack('<hh', s, s)

    out = Path(__file__).resolve().parents[1] / 'public' / 'music' / 'bed.wav'
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))
    print(f'wrote {out} ({out.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
