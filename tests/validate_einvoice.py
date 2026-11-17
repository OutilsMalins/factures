"""Vérifie des factures électroniques avec les validateurs officiels.

- XML CII / UBL : schéma XSD + règles européennes EN 16931 + règles françaises BR-FR (réforme 2026-2027),
  fichiers fournis par la bibliothèque de référence « factur-x » (PyPI).
- Factur-X (PDF) : extraction du XML + mêmes contrôles + veraPDF (norme PDF/A-3b) si VERAPDF_CP est défini.

Usage : python validate_einvoice.py fichier1 [fichier2 ...]   → code de sortie 1 si une erreur est trouvée.
"""
import os, subprocess, sys
from lxml import etree
from saxonche import PySaxonProcessor
import facturx

BASE = os.path.join(os.path.dirname(facturx.__file__), "xsd_and_schematron")
CII = {"xsd": f"{BASE}/facturx-en16931/Factur-X_EN16931.xsd",
       "sch": [f"{BASE}/facturx-en16931/FACTUR-X_EN16931.xslt", f"{BASE}/cii-schematron-fr-ctc/BR-FR-Flux2-Schematron-CII.xslt"]}
UBL = {"xsd": {"Invoice": f"{BASE}/ubl-2.1/maindoc/UBL-Invoice-2.1.xsd", "CreditNote": f"{BASE}/ubl-2.1/maindoc/UBL-CreditNote-2.1.xsd"},
       "sch": [f"{BASE}/ubl-2.1/EN16931-UBL-validation.xslt", f"{BASE}/ubl-2.1/BR-FR-Flux2-Schematron-UBL.xslt"]}
SVRL = "{http://purl.oclc.org/dsdl/svrl}"
_proc = PySaxonProcessor(license=False); _xslt = _proc.new_xslt30_processor(); _cache = {}

def schematron(xslt, xml_path):
    if xslt not in _cache:
        _cache[xslt] = _xslt.compile_stylesheet(stylesheet_file=xslt)
    out = _cache[xslt].transform_to_string(source_file=xml_path)
    tree = etree.fromstring(out.encode())
    errs = []
    for fa in tree.iter(SVRL + "failed-assert", SVRL + "successful-report"):
        flag = (fa.get("flag") or fa.get("role") or "fatal").lower()
        if flag in ("warning", "information", "info"):
            continue
        txt = " ".join("".join(fa.itertext()).split())
        errs.append(f"[{fa.get('id') or ''}] {txt[:300]}")
    return errs

def check_xml(path):
    doc = etree.parse(path); root = etree.QName(doc.getroot()).localname
    if root == "CrossIndustryInvoice":
        xsd, sch = CII["xsd"], CII["sch"]
    else:
        xsd, sch = UBL["xsd"][root], UBL["sch"]
    errs = []
    schema = etree.XMLSchema(etree.parse(xsd))
    if not schema.validate(doc):
        errs += [f"[XSD] {e.message}" for e in schema.error_log]
    for s in sch:
        errs += [f"{os.path.basename(s).split('.')[0]} {e}" for e in schematron(s, path)]
    return root, errs

def check_pdf(path):
    errs = []
    with open(path, "rb") as f:
        name, xml = facturx.get_xml_from_pdf(f.read(), check_xsd=False)
    if name != "factur-x.xml":
        return [f"XML intégré introuvable (trouvé : {name})"]
    tmp = path + ".extrait.xml"
    open(tmp, "wb").write(xml)
    _, e = check_xml(tmp); errs += e
    cp = os.environ.get("VERAPDF_CP")
    if cp:
        r = subprocess.run(["java", "-cp", cp, "org.verapdf.apps.GreenfieldCliWrapper", "--flavour", "3b", "--format", "text", path],
                           capture_output=True, text=True)
        line = [l for l in r.stdout.splitlines() if path in l or "PASS" in l or "FAIL" in l]
        if not any(l.startswith("PASS") for l in line):
            r2 = subprocess.run(["java", "-cp", cp, "org.verapdf.apps.GreenfieldCliWrapper", "--flavour", "3b", "--format", "xml", path],
                                capture_output=True, text=True)
            rules = etree.fromstring(r2.stdout.encode()).iter("rule")
            errs += [f"[PDF/A-3b {r.get('clause')}-{r.get('testNumber')}] {' '.join((r.findtext('description') or '').split())[:200]}"
                     for r in rules if r.get("status") == "failed"]
    return errs

if __name__ == "__main__":
    bad = 0
    for p in sys.argv[1:]:
        errs = check_pdf(p) if p.endswith(".pdf") else check_xml(p)[1]
        print(("OK    " if not errs else "ERREUR ") + os.path.basename(p))
        for e in errs:
            print("       " + e)
        bad += bool(errs)
    sys.exit(1 if bad else 0)
