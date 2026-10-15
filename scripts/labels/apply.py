"""Apply compact labels from a file. Line: NAME | SEGS | CODES | FLAGS
SEGS: '-' none, '=' keep draft segs, or ';'-joined: F date ORG-DST / T date Orig>Dest /
      L start..end / R start..end / D date / E date / O date
CODES: '=' keep draft codes, '-' none, or comma list.  FLAGS: '!' cancelled."""
import json, os, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../fixtures/real-mail/trips")
KIND = dict(F="flight", T="train", L="lodging", R="rental", D="dining", E="event", O="other")
n = 0
for line in open(sys.argv[1]):
    line = line.strip()
    if not line or line.startswith("#"): continue
    parts = [p.strip() for p in line.split("|")] + ["", "", ""]
    name, segs, codes, flags = parts[:4]
    path = f"{ROOT}/{name}.expect.json"
    doc = json.load(open(path)); r = doc["reservation"]
    if segs != "=":
        out = []
        if segs != "-":
            for spec in segs.split(";"):
                k, rest = spec.strip().split(" ", 1)
                bits = rest.split(" ", 1)
                seg = {"kind": KIND[k]}
                if ".." in bits[0]: seg["start"], seg["end"] = bits[0].split("..")
                else: seg["start"] = bits[0]
                if len(bits) > 1 and bits[1].strip():
                    sep = ">" if ">" in bits[1] else "-"
                    o, d = bits[1].split(sep, 1); seg["origin"], seg["destination"] = o.strip(), d.strip()
                out.append(seg)
        r["segments"] = out
    if codes != "=":
        r["codes"] = [] if codes in ("-", "") else [c.strip().upper() for c in codes.split(",")]
    r.pop("cancelled", None)
    if "!" in flags: r["cancelled"] = True
    r["reviewed"] = True
    json.dump(doc, open(path, "w"), indent=2, ensure_ascii=False); open(path, "a").write("\n")
    n += 1
print(f"applied {n} labels")
