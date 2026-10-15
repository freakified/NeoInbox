"""Print samples compactly for labeling: python3 view.py NAME_PREFIX... [--chars N]"""
import json, re, sys, html, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../fixtures/real-mail/trips")
args = [a for a in sys.argv[1:] if not a.startswith("--")]
chars = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--chars=")), 1800))
def h2t(s):
    s = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", s)
    s = re.sub(r"(?s)<!--.*?-->", " ", s)
    s = re.sub(r"(?i)<(br|hr)\b[^>]*>", "\n", s)
    s = re.sub(r"(?i)</(p|div|tr|td|th|li|h[1-6]|table)>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return html.unescape(s)
def clean(t):
    t = re.sub(r"https?://\S+", "", t)
    t = re.sub(r"[\u200b-\u200f\u034f\u00ad\ufeff]", "", t)
    t = re.sub(r"[^\S\n]+", " ", t)
    t = re.sub(r"\s*\n\s*", "\n", t)
    t = re.sub(r"(?m)^[<|>\s]*$\n?", "", t)
    t = re.sub(r"(?m)^\[[^\]]*\.(png|gif|jpg)[^\]]*\]\n?", "", t)
    return t.strip()
names = []
for a in args:
    if os.path.exists(a): names += [l.split("\t")[0].strip() for l in open(a) if l.strip()]
    else: names.append(a)
for n in names:
    s = json.load(open(f"{ROOT}/{n}.json"))
    e = json.load(open(f"{ROOT}/{n}.expect.json"))["reservation"]
    # Senders often put real details only in one part: show the richer one.
    plain, rich = clean("\n".join(s["textParts"])), clean(h2t("\n".join(s["htmlParts"])))
    text = plain if len(plain) >= len(rich) else rich
    segs = "; ".join(f"{x['kind'][0].upper()} {x['start']}{'..'+x['end'] if 'end' in x else ''} {x.get('origin','')}-{x.get('destination','')}" for x in e["segments"]) or "-"
    print(f"=== {n}\nFROM {s['author']}\nSUBJ {s['subject']}\nDRAFT {segs} | #{','.join(e['codes'])}{' !' if e.get('cancelled') else ''}\n{clean(text)[:chars]}\n")
