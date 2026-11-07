"""Tavia's sounds, one per event (soft bells, 16-bit mono WAV, quiet enough for a shop)."""
import math, struct, sys, wave, os

RATE = 44100
out = sys.argv[1]

def render(notes, length, name, decay=4.2, level=.55):
    n = int(RATE * length)
    buf = [0.0] * n
    for start, f, dur, vol in notes:
        s0 = int(start * RATE)
        for i in range(int(dur * RATE)):
            t = i / RATE
            env = min(1, t / 0.005) * math.exp(-t * decay)
            v = (math.sin(2 * math.pi * f * t) + 0.35 * math.sin(2 * math.pi * f * 2.01 * t) * math.exp(-t * 7)
                 + 0.12 * math.sin(2 * math.pi * f * 3.02 * t) * math.exp(-t * 10))
            if s0 + i < n:
                buf[s0 + i] += v * env * vol
    peak = max(abs(x) for x in buf) or 1
    with wave.open(os.path.join(out, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(x / peak * level * 32767)) for x in buf))

C4, E4, F4, A4 = 261.63, 329.63, 349.23, 440.0
C5, E5, G5, A5 = 523.25, 659.25, 783.99, 880.0
C6, E6, G6 = 1046.5, 1318.5, 1568.0

# payment received: bright "ka-ching", three quick rising notes
render([(0, C6, .9, 1), (.09, G6, .9, .85), (.2, 2637.0, .7, .45)], 1.2, 'tavia_pay')
# new WhatsApp message: a soft "bloop" (low grace note into a warm one)
render([(0, E5, .5, .55), (.07, A5, 1.0, 1)], 1.1, 'tavia_msg', decay=6)
# charger in: rising power-up run
render([(0, C5, .8, .8), (.1, E5, .8, .85), (.2, G5, .8, .9), (.3, C6, 1.1, 1)], 1.5, 'tavia_charge')
# charger out: the same run falling
render([(0, C6, .7, .9), (.1, G5, .7, .85), (.2, E5, .7, .85), (.3, C5, 1.0, 1)], 1.4, 'tavia_unplug')
# battery low: two gentle low notes
render([(0, A4, .9, 1), (.28, F4, 1.0, 1)], 1.4, 'tavia_low')
# battery very low: three low pulses, more urgent
render([(0, E4, .35, 1), (.32, E4, .35, 1), (.64, C4, .9, 1)], 1.6, 'tavia_critical', decay=5, level=.65)
print('chimes done')
