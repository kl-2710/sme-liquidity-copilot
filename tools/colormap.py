import colorsys, re
def parse(h):
    h=h.lstrip('#')
    if len(h) in (3,4): h=''.join(c*2 for c in h)
    r,g,b=(int(h[i:i+2],16)/255 for i in (0,2,4)); a=int(h[6:8],16)/255 if len(h)==8 else 1
    return r,g,b,a
TEXT={'color','-webkit-text-fill-color'}
ONDARK=re.compile(r'\.auth-hero|\.auth-brand|\.auth-copy|\.auth-points|\.ap-ic|\.auth-fine|\.tip\b|#tt|\.info:hover:after|\.info:focus:after|\.result|\.big\b|\.bigs|\.cover\.|\.toast|\.jsonrow|\.toolchip pre')
def token(hexv, prop, ondark=False):
    r,g,b,a=parse(hexv); hh,l,s=colorsys.rgb_to_hls(r,g,b); hue=hh*360
    textish = prop in TEXT
    bg = prop.startswith('background') or prop in ('fill','stop-color')
    if ondark and textish: return 'text-onBrand'
    if l<0.22:
        return 'text-primary' if textish else ('bg-brand' if bg else 'text-primary')
    neutral = s<0.22 or (25<hue<75 and s<0.45 and l>0.7)
    if neutral:
        if textish:
            return 'text-onBrand' if l>=0.85 else 'text-muted' if l>=0.58 else 'text-secondary' if l>=0.36 else 'text-primary'
        if l>=0.985: return 'bg-surface'
        if l>=0.955: return 'bg-subtle' if bg else 'border-default'
        if l>=0.9: return 'bg-hover' if bg else 'border-default'
        if l>=0.8: return 'border-default' if not bg else 'bg-subtle'
        if l>=0.6: return 'border-strong' if not bg else 'border-control'
        return 'text-muted' if l>=0.38 else 'text-secondary'
    if 200<hue<=300:
        if textish: return 'text-onBrand' if l>=0.85 else 'text-link'
        if l>=0.92: return 'bg-selected' if bg else 'border-default'
        if l>=0.8: return 'bg-selected' if bg else 'border-strong'
        return 'action-primary'
    if 160<=hue<=200:
        if textish: return 'text-onBrand' if l>=0.75 else 'status-success'
        return 'bg-subtle' if l>=0.85 else 'brand-accent'
    if 95<=hue<160:
        if textish: return 'text-onBrand' if l>=0.75 else 'status-success'
        return 'status-success-bg' if l>=0.85 else 'status-success'
    if 25<=hue<95:
        if textish: return 'text-onBrand' if l>=0.75 else 'status-warning'
        return 'status-warning-bg' if l>=0.86 else 'status-warning'
    if textish: return 'text-onBrand' if l>=0.8 else ('text-link' if 10<hue<25 and s<0.6 else 'status-error')
    if l>=0.86: return 'status-error-bg' if bg else 'status-error-bg'
    if 10<hue<25 and s<0.6: return 'action-primary'
    return 'status-error'
def repl(hexv, prop, ondark=False):
    r,g,b,a=parse(hexv)
    if a<0.999 and max(r,g,b)<0.35 and (max(r,g,b)-min(r,g,b))<0.2:
        return f'rgba(27,22,56,{round(a,3)})'   # neutral dark translucent: shadows / hover tints in Lilact ink
    if prop=='color' and hexv.lower() in('#fff','#ffffff') and not ondark: v='var(--lc-color-text-onAction)'
    else: v=f'var(--lc-color-{token(hexv,prop,ondark)})'
    if a<0.999: return f'color-mix(in srgb,{v} {round(a*100)}%,transparent)'
    return v
