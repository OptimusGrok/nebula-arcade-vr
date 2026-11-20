# Cabinet music loops for Nebula Arcade (numpy synthesis, same style as galactic-shop/music/gen.py).
# Each loop is an exact whole number of bars; note tails wrap to the start, so the loop is seamless.
# Output: <key>.mp3 (mono, 48 kbps, 22.05 kHz) + manifest.json with exact loop sample counts.
import numpy as np, scipy.io.wavfile as w, subprocess, json, os
from scipy.signal import lfilter
SR=22050
def f(m): return 440*2**((m-69)/12)
def osc(kind,fr,n):
    p=(fr*np.arange(n)/SR)%1
    if kind=='sq': return np.where(p<.5,1.,-1.)*.6
    if kind=='pl': return np.where(p<.25,1.,-1.)*.6
    if kind=='saw': return 2*p-1
    if kind=='tri': return 2*abs(2*p-1)-1
    return np.sin(2*np.pi*p)
class Song:
    def __init__(s,bpm,bars,seed): np.random.seed(seed); s.spb=60/bpm; s.n=int(round(bars*4*s.spb*SR)); s.buf=np.zeros(s.n)
    def add(s,beat,sig):
        i=int(round(beat*s.spb*SR))%s.n; s.buf[(np.arange(len(sig))+i)%s.n]+=sig
    def note(s,beat,m,dur,kind,vol,r=None,lpf=None):
        n=int((dur*s.spb+.25)*SR); r=r or dur*s.spb*.6; x=osc(kind,f(m),n)
        if lpf: x=lfilter([lpf],[1,lpf-1],x)
        t=np.arange(n)/SR; g=np.minimum(1,t/.005)*np.exp(-t/r); off=int(dur*s.spb*SR); g[off:]*=np.exp(-np.arange(n-off)/SR/.06)
        s.add(beat,x*g*vol)
    def kick(s,b,v=.8):
        n=int(.25*SR);t=np.arange(n)/SR; s.add(b,np.sin(2*np.pi*(50*t+3*(1-np.exp(-t*30))))*np.exp(-t*14)*v)
    def snare(s,b,v=.3):
        n=int(.18*SR);t=np.arange(n)/SR; s.add(b,(np.random.randn(n)*.7+np.sin(2*np.pi*190*t)*.4)*np.exp(-t*20)*v)
    def hat(s,b,v=.08):
        n=int(.04*SR); x=np.diff(np.random.randn(n+1)); s.add(b,x*np.exp(-np.arange(n)/SR*90)*v)
    def echo(s,beats,fb=.35):
        d=int(round(beats*s.spb*SR)); e=s.buf.copy(); y=s.buf.copy()
        for k in range(4): e=np.roll(e,d)*fb; y+=e
        s.buf=y
    def save(s,key):
        x=s.buf/np.max(np.abs(s.buf))*.9; x=np.tanh(x*1.2)/np.tanh(1.2)*.88
        w.write(key+'.wav',SR,(x*32767).astype(np.int16))
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',key+'.wav','-ac','1','-ar',str(SR),'-b:a','48k',key+'.mp3'],check=True)
        os.remove(key+'.wav'); return s.n
CH={'min':[0,3,7],'maj':[0,4,7]}
def tune(key,bpm,bars,seed,prog,lead,bass,arp,mel,drums='rock',echo=None,lpf=None):
    s=Song(bpm,bars,seed)
    for bar in range(bars):
        root,q=prog[bar%len(prog)]; b0=bar*4; ch=CH[q]
        for i in range(8): s.note(b0+i*.5,root-12+(12 if (i%2 and bass=='oct') else 0),.45,'tri',.55)
        if arp: 
            for i in range(16): s.note(b0+i*.25,root+12+(ch+[12])[i%4],.2,arp,.07,lpf=lpf)
        ph=mel[(bar%4)]
        for i,m in enumerate(ph):
            if m is not None: s.note(b0+i*.5,m,.45,lead,.18,lpf=lpf)
        if drums=='rock':
            for i in range(4): s.kick(b0+i) if i%2==0 else s.snare(b0+i)
            for i in range(8): s.hat(b0+i*.5)
        elif drums=='four':
            for i in range(4): s.kick(b0+i); s.hat(b0+i+.5,.1)
            s.snare(b0+1); s.snare(b0+3)
        elif drums=='slow':
            s.kick(b0); s.kick(b0+2.5); s.snare(b0+2,.2)
            for i in range(4): s.hat(b0+i+.5,.05)
        elif drums=='tick':
            for i in range(8): s.hat(b0+i*.5,.05)
    if echo: s.echo(echo)
    return s.save(key)
# vrtest-v5 (t458u): Rockfall Rush and Sky Tower had no cabinet loop at all (cabinet-music.js skipped them), so walking up to them was silent.
# Same kit style as cabinet-kit/audio/gen.py; run from the repo root: python3 tools/gen_cab_v5.py  -> audio/cab_rockfall.mp3, audio/cab_skytower.mp3
A,C,D,E,F,G=57,60,62,64,65,67
_=None
os.chdir('audio'); M={}
M['rockfall']=tune('rockfall',136,8,13,[(E,'min'),(E,'min'),(C,'maj'),(D,'maj')],'saw','oct','pl',
  [[76,_,74,76,79,_,76,74],[71,_,74,_,76,_,_,_],[72,_,76,79,_,76,72,_],[74,_,78,_,81,_,78,74]],'rock',lpf=.45)
M['skytower']=tune('skytower',126,8,14,[(D,'maj'),(G,'maj'),(E+12-12,'min'),(A,'maj')],'pl','single','tri',
  [[74,78,81,_,86,_,81,_],[79,83,86,_,83,_,79,_],[76,79,83,_,88,_,83,_],[81,85,88,_,_,_,85,_]],'four',echo=.5)
for k in M: os.replace(k+'.mp3','cab_'+k+'.mp3')
print(json.dumps({k:{'src':'audio/cab_'+k+'.mp3','samples':n,'rate':SR} for k,n in M.items()}))
