"""
Shared pytest fixtures for the document-service test suite.

All fixtures are deterministic and self-contained:
- PDFs are generated with PyMuPDF (no external files).
- Images are generated with Pillow (no external files).
- HTTP calls are mocked with respx (no network).
- OCR is provided by a mock provider (no Tesseract binary needed).
"""
import io
from typing import List
from unittest.mock import MagicMock

import fitz
import pytest
from PIL import Image, ImageDraw

from app.models.document import BoundingBox, OcrElement
from app.ocr.base import OcrProvider


# ─── Document fixtures ──────────────────────────────────────────────────────

@pytest.fixture
def single_page_pdf_bytes() -> bytes:
    """A4 PDF with two lines of selectable text."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Question 1: What is 2 + 2?", fontsize=12)
    page.insert_text((72, 130), "Question 2: Name the capital of France.", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def two_page_pdf_bytes() -> bytes:
    """A4 PDF with two pages, each carrying one line of text."""
    doc = fitz.open()
    p1 = doc.new_page(width=595, height=842)
    p1.insert_text((72, 100), "Page one content.", fontsize=12)
    p2 = doc.new_page(width=595, height=842)
    p2.insert_text((72, 100), "Page two content.", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def blank_page_pdf_bytes() -> bytes:
    """PDF with one completely blank page (no text)."""
    doc = fitz.open()
    doc.new_page(width=595, height=842)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def sample_png_bytes() -> bytes:
    """Simple white 400×200 PNG with black text (used with mock OCR)."""
    img = Image.new("RGB", (400, 200), color="white")
    draw = ImageDraw.Draw(img)
    draw.text((10, 10), "Answer: Paris", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ─── Mock OCR provider ──────────────────────────────────────────────────────

def make_mock_ocr(elements: List[OcrElement] | None = None) -> OcrProvider:
    """Return a mock OcrProvider that yields a fixed list of elements."""
    if elements is None:
        elements = [
            OcrElement(
                text="Answer: Paris",
                bbox=BoundingBox(x=10.0, y=10.0, width=120.0, height=18.0),
            )
        ]
    provider = MagicMock(spec=OcrProvider)
    provider.extract.return_value = elements
    return provider


@pytest.fixture
def mock_ocr() -> OcrProvider:
    return make_mock_ocr()
