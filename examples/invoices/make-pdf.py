#!/usr/bin/env python3
"""
Generate the sample invoice PDFs the AP inbox refers to.

The inbox in lib/ap-inbox.ts names an attachment per message and carries the text an
OCR step would return for it. These are those attachments — so the demo can show the
document the extracted fields actually came from.

    python3 examples/invoices/make-pdf.py            # all of them
    python3 examples/invoices/make-pdf.py NC-1043    # just one

Requires reportlab.
"""
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

OUT_DIR = Path(__file__).parent / "pdf"

INK = colors.HexColor("#202522")
MUTED = colors.HexColor("#6c746f")
LINE = colors.HexColor("#dde2de")
ACCENT = colors.HexColor("#13714a")

INVOICES = [
    {
        "number": "NC-1043",
        "vendor": "Northstar Cloud",
        "vendor_address": ["Northstar Cloud, Inc.", "1100 Harbor Street, Suite 400", "Seattle, WA 98104", "United States"],
        "vendor_email": "billing@northstarcloud.example",
        "issued": "1 October 2026",
        "due": "15 October 2026",
        "terms": "Net 14",
        "currency": "USD",
        "lines": [
            ("Cloud infrastructure subscription — September 2026", "1", "118.00", "118.00"),
            ("Additional egress (240 GB @ 0.05)", "1", "12.00", "12.00"),
            ("Support plan — Standard", "1", "12.00", "12.00"),
        ],
        "total": "142.00",
        "note": "Please quote invoice NC-1043 with your remittance.",
    },
    {
        "number": "PAY-1002",
        "vendor": "OB-1001 AU Payroll Bureau",
        "vendor_address": ["AU Payroll Bureau Pty Ltd", "1 Martin Place, Level 12", "Sydney NSW 2000", "Australia"],
        "vendor_email": "accounts@aupayrollbureau.example",
        "issued": "1 October 2026",
        "due": "20 October 2026",
        "terms": "Net 19",
        "currency": "AUD",
        "lines": [
            ("Monthly payroll processing — October 2026", "1", "100.00", "100.00"),
        ],
        "total": "100.00",
        "note": "Payable in AUD to the account on file.",
    },
    {
        "number": "BPL-2291",
        "vendor": "Brightpath Legal Partners",
        "vendor_address": ["Brightpath Legal Partners LLP", "22 Gresham Street", "London EC2V 7AD", "United Kingdom"],
        "vendor_email": "ap@brightpathlegal.example",
        "issued": "28 September 2026",
        "due": "30 October 2026",
        "terms": "Net 32",
        "currency": "USD",
        "lines": [
            ("Contract review — master services agreement", "8", "250.00", "2,000.00"),
            ("Advisory services — Q3 retainer", "1", "1,200.00", "1,200.00"),
        ],
        "total": "3,200.00",
        "note": "New supplier — remittance details to be confirmed by your AP team.",
    },
]


def build(invoice: dict) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{invoice['number']}.pdf"

    doc = SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=22 * mm, rightMargin=22 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
        title=f"Invoice {invoice['number']}", author=invoice["vendor"],
        subject=f"Invoice {invoice['number']} from {invoice['vendor']}",
    )

    base = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=base["Normal"], fontName="Helvetica-Bold",
                        fontSize=22, leading=25, textColor=INK)
    label = ParagraphStyle("label", parent=base["Normal"], fontName="Helvetica-Bold",
                           fontSize=7, leading=10, textColor=MUTED)
    body = ParagraphStyle("body", parent=base["Normal"], fontName="Helvetica",
                          fontSize=9, leading=13, textColor=INK)
    small = ParagraphStyle("small", parent=base["Normal"], fontName="Helvetica",
                           fontSize=8, leading=12, textColor=MUTED)
    right = ParagraphStyle("right", parent=body, alignment=TA_RIGHT)
    right_b = ParagraphStyle("right_b", parent=right, fontName="Helvetica-Bold")

    story = []

    header = Table(
        [[Paragraph(invoice["vendor"], h1),
          Paragraph("INVOICE", ParagraphStyle("tag", parent=base["Normal"],
                                              fontName="Helvetica-Bold", fontSize=13,
                                              textColor=ACCENT, alignment=TA_RIGHT))]],
        colWidths=[110 * mm, 56 * mm],
    )
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story += [header, Spacer(1, 3 * mm)]

    story.append(Table([[Paragraph("", body)]], colWidths=[166 * mm], rowHeights=[0.6],
                       style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), LINE)])))
    story.append(Spacer(1, 6 * mm))

    from_block = "<br/>".join(invoice["vendor_address"] + [invoice["vendor_email"]])
    meta = [
        [Paragraph("FROM", label), Paragraph("BILL TO", label), Paragraph("INVOICE NUMBER", label)],
        [Paragraph(from_block, small),
         Paragraph("Accounts Payable<br/>Your Company Ltd<br/>ap@yourcompany.example", small),
         Paragraph(f"<b>{invoice['number']}</b>", body)],
        [Paragraph("", label), Paragraph("", label), Paragraph("ISSUED", label)],
        [Paragraph("", small), Paragraph("", small), Paragraph(invoice["issued"], body)],
        [Paragraph("", label), Paragraph("", label), Paragraph("DUE DATE", label)],
        [Paragraph("", small), Paragraph("", small), Paragraph(f"<b>{invoice['due']}</b>", body)],
    ]
    meta_t = Table(meta, colWidths=[62 * mm, 56 * mm, 48 * mm])
    meta_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("SPAN", (0, 1), (0, 5)), ("SPAN", (1, 1), (1, 5)),
        ("TOPPADDING", (2, 2), (2, 2), 6),
        ("TOPPADDING", (2, 4), (2, 4), 6),
    ]))
    story += [meta_t, Spacer(1, 9 * mm)]

    rows = [[Paragraph("DESCRIPTION", label), Paragraph("QTY", label),
             Paragraph("UNIT PRICE", ParagraphStyle("l_r", parent=label, alignment=TA_RIGHT)),
             Paragraph("AMOUNT", ParagraphStyle("l_r2", parent=label, alignment=TA_RIGHT))]]
    for desc, qty, unit, amount in invoice["lines"]:
        rows.append([Paragraph(desc, body), Paragraph(qty, body),
                     Paragraph(f"{invoice['currency']} {unit}", right),
                     Paragraph(f"{invoice['currency']} {amount}", right)])

    table = Table(rows, colWidths=[92 * mm, 14 * mm, 30 * mm, 30 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, colors.HexColor("#eef1ef")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [table, Spacer(1, 5 * mm)]

    total = Table(
        [[Paragraph("TOTAL DUE", ParagraphStyle("tl", parent=label, alignment=TA_RIGHT)),
          Paragraph(f"{invoice['currency']} {invoice['total']}", right_b)]],
        colWidths=[106 * mm, 60 * mm],
    )
    total.setStyle(TableStyle([
        ("LINEABOVE", (1, 0), (1, 0), 0.8, INK),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story += [total, Spacer(1, 12 * mm)]

    story.append(Paragraph(f"Payment terms: {invoice['terms']}", small))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(invoice["note"], small))

    doc.build(story)
    return path


def main() -> None:
    wanted = {a.upper() for a in sys.argv[1:]}
    made = [build(inv) for inv in INVOICES if not wanted or inv["number"].upper() in wanted]
    if not made:
        print(f"No invoice matched {', '.join(sorted(wanted))}", file=sys.stderr)
        raise SystemExit(1)
    for path in made:
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
