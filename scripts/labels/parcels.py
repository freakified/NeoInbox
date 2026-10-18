"""Label the packages set compactly.

  python3 parcels.py list [PREFIX]          names of unreviewed samples
  python3 parcels.py view NAME... [--all]   tracking-relevant lines and links
  python3 parcels.py apply FILE             apply "NAME | PARCELS" lines

PARCELS: '-' for none, else ','-joined CARRIER[:NUMBER] (e.g. "yamato:638265388893",
"amazon" for a link-only parcel). Carriers: see Carrier in src/classifier/samples.ts.
"""
import glob, html, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../fixtures/real-mail/packages")
CARRIERS = {"ups", "usps", "fedex", "dhl", "ontrac", "yamato", "sagawa", "japanpost", "amazon", "yodobashi", "unknown"}

KEY = re.compile(
    r"track|追跡|伝票|送り状|お問い?合わ?せ\s*(?:No|番号)|荷物番号|配送番号|carrier|配送業者|運送会社|"
    r"\b1Z[0-9A-Z]{16}\b|\b\d[\d -]{9,}\d\b|\b[A-Z]{2}\d{9}[A-Z]{2}\b",
    re.I,
)
IMAGE = re.compile(r"\.(png|gif|jpe?g|svg)(\?|$)", re.I)
LINK = re.compile(
    r"track|ship-?track|progress-tracker|okurijo|reqCodeNo|kuronekoyamato|sagawa-exp|japanpost|"
    r"ups\.com|usps\.com|fedex\.com|dhl\.|ontrac|17track|aftership|narvar|parcelsapp",
    re.I,
)


def h2t(s):
    s = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", s)
    s = re.sub(r"(?s)<!--.*?-->", " ", s)
    s = re.sub(r"(?i)<(br|hr)\b[^>]*>", "\n", s)
    s = re.sub(r"(?i)</(p|div|tr|td|th|li|h[1-6]|table)>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return html.unescape(s)


def clean(t):
    t = re.sub(r"[​-‏͏­﻿ ]", "", t)
    t = re.sub(r"[^\S\n]+", " ", t)
    return [l.strip() for l in t.split("\n") if l.strip()]


def path_of(name):
    return f"{ROOT}/{name}.json"


def names(prefix=""):
    out = []
    for f in sorted(glob.glob(f"{ROOT}/**/*.json", recursive=True)):
        if f.endswith(".expect.json"):
            continue
        n = os.path.relpath(f, ROOT)[:-5]
        if n.startswith(prefix):
            out.append(n)
    return out


def expect(name):
    p = f"{ROOT}/{name}.expect.json"
    return json.load(open(p)) if os.path.exists(p) else {}


def view(name, show_all):
    s = json.load(open(path_of(name)))
    plain = clean("\n".join(s["textParts"]))
    rich = clean(h2t("\n".join(s["htmlParts"])))
    lines = plain if len("".join(plain)) >= len("".join(rich)) else rich
    lines = [re.sub(r"https?://\S+", "<url>", l)[:160] for l in lines]
    hits = lines if show_all else [l for l in lines if KEY.search(l)]
    seen, kept = set(), []
    for l in hits:
        if l not in seen:
            seen.add(l)
            kept.append(l)
    hrefs = []
    for part in s["htmlParts"] + s["textParts"]:
        for u in re.findall(r"https?://[^\s\"'<>)]+", part):
            u = html.unescape(u)
            if LINK.search(u) and not IMAGE.search(u) and u not in hrefs:
                hrefs.append(u)
    # Links holding a long number first: those are the ones that track.
    hrefs.sort(key=lambda u: not re.search(r"[=/]\w{0,4}\d{8,}", u))
    print(f"=== {name} | {s['subject'][:90]}")
    for l in kept[:8]:
        print("  ", l[:140])
    if len(kept) > 8:
        print(f"   … {len(kept) - 8} more lines")
    for u in hrefs[:3]:
        print("  @", u[:150])


def apply(path):
    n = 0
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, spec = [p.strip() for p in line.split("|", 1)]
        parcels = []
        if spec != "-":
            for item in spec.split(","):
                carrier, _, number = item.strip().partition(":")
                assert carrier in CARRIERS, f"{name}: bad carrier {carrier}"
                parcel = {"carrier": carrier}
                if number:
                    parcel["number"] = re.sub(r"[\s-]", "", number).upper()
                parcels.append(parcel)
        doc = expect(name)
        assert os.path.exists(path_of(name)), f"no sample {name}"
        doc["parcels"] = {"reviewed": True, "parcels": parcels}
        with open(f"{ROOT}/{name}.expect.json", "w") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
        n += 1
    print(f"applied {n} labels")


if __name__ == "__main__":
    cmd, args = sys.argv[1], [a for a in sys.argv[2:] if not a.startswith("--")]
    if cmd == "list":
        for n in names(args[0] if args else ""):
            if not expect(n).get("parcels", {}).get("reviewed"):
                print(n)
    elif cmd == "view":
        targets = []
        for a in args:
            targets += [l.strip() for l in open(a) if l.strip()] if os.path.isfile(a) else names(a)
        for n in targets:
            view(n, "--all" in sys.argv)
    elif cmd == "apply":
        apply(args[0])
